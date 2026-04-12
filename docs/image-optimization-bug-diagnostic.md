# DreamPlay Email — Image Optimization Bug: Full Diagnostic

## Problem Statement

Email campaigns sent via the **scheduler** (Inngest scheduled send) arrive with unoptimized images:
- Image 1: expected ~100KB → arrived 1,000KB+ (and during debugging: 1,700KB)
- Image 2: expected ~100KB → arrived 2,400KB+ (and during debugging: 3,200KB)

**The same campaign sent via the regular "Send Broadcast" button works perfectly** — images are compressed to ~100KB.

This isolates the bug to the **scheduled send path specifically**, not the image optimization code itself.

---

## Architecture Overview

```
Regular send (browser):
  Browser → POST /api/send-stream → proxyEmailImages (Sharp) → Resend API

Scheduled campaign send:
  Browser → POST /api/send-stream { type: "schedule" }
    → Saves scheduledAt to DB
    → inngest.send("campaign.scheduled-send")
       → Inngest sleepUntil(scheduledAt)
       → step.run("check-campaign")
       → step.run("send-broadcast"):
            fetch(NEXT_PUBLIC_APP_URL + /api/send-stream)  ← HTTP call to self
              → proxyEmailImages (Sharp) ← may timeout here
            await response.text()         ← waits for full stream
       → step.run("update-status")

Scheduled rotation send:
  Browser → POST /api/schedule-rotation { type: "schedule" }
    → inngest.send("rotation.scheduled-send")
       → Inngest sleepUntil(scheduledAt)
       → step.run("check-rotation")
       → step.run("send-rotation"):
            fetch(NEXT_PUBLIC_APP_URL + /api/send-rotation)
              → round-robin assignment
              → for each batch: fetch(/api/send-stream)  ← proxyEmailImages runs here
            await response.text()
       → step.run("update-status")
```

---

## Key Files

### `app/api/send-stream/route.ts` (top of file, after fix)
```typescript
// Allow up to 5 minutes — needed for Sharp image optimization + Supabase uploads
// before the per-subscriber send loop. Without this, Vercel kills the function
// at 10s (Hobby) or 60s (Pro) mid-way through image processing.
export const maxDuration = 300;
export const dynamic = "force-dynamic";
```

**The image optimization pipeline:**
```typescript
const htmlWithFooter = htmlContent + unsubscribeFooter;
const htmlWithVideoOverlay = await addPlayButtonsToVideoThumbnails(htmlWithFooter);

// Runs AFTER video overlay so YouTube thumbnails are also optimized
sendLog(controller, encoder, "info", "Proxying & optimizing images...");
const htmlProxied = await proxyEmailImages(htmlWithVideoOverlay);
const proxiedCount = (htmlProxied.match(/\/email-images\/(optimized|hashed)\//g) || []).length;
sendLog(..., proxiedCount > 0 ? "✅ proxied" : "⚠️ no images proxied");
const htmlFinal = htmlProxied;

// Then per-subscriber send loop using htmlFinal...
```

---

### `lib/image-proxy.ts` — Core optimization logic

**Constants:**
```typescript
const WARN_BYTES     = 500 * 1024;   // 500 KB — log a warning
const OPTIMIZE_BYTES = 150 * 1024;   // 150 KB — run Sharp above this
const TARGET_WIDTH   = 1200;
const JPEG_QUALITY   = 82;
const BUCKET         = "email-images";
```

**`isAlreadyProxied(url)` — determines if an image should be skipped:**
```typescript
function isAlreadyProxied(url: string): boolean {
  const parsed = new URL(url);
  const isSupabaseDomain = parsed.hostname.includes(".supabase.co") ||
                           parsed.hostname.includes(".supabase.in");
  if (!isSupabaseDomain) return false;
  const path = parsed.pathname;
  return (
    path.includes(`/object/public/email-images/optimized/`) ||
    path.includes(`/object/public/email-images/hashed/`)
  );
}
```

⚠️ **Potential latent bug**: Both `optimized/` AND `hashed/` are treated as "already proxied".
- `optimized/` = definitely went through Sharp ✅
- `hashed/` = stored as-is (no Sharp) — could be a large unoptimized image if it was stored
  during a previous failed optimization run where Sharp timed out

**`proxyImage(imageUrl)` — per-image pipeline:**
```typescript
// 1. HEAD check (5s timeout) — get size hint
// 2. GET download (20s timeout)
// 3. Resolve content-type:
//      server type OR inferred from URL extension (new: handles octet-stream)
// 4. Decision:
//    - If buf.length > 150KB AND type in COMPRESS_FORMATS → Sharp → store in optimized/
//    - Else → store as-is → store in hashed/
// 5. On ANY error → silently return original URL (never throws)
```

**`proxyEmailImages(html)` — scans HTML for images to proxy:**
```typescript
// Pattern 1: src="https://..." attributes
const srcRegex = /src=["']?(https?:\/\/[^"'\s>]+)["']?/gi;

// Pattern 2: url(https://...) in style attributes (background-image etc)
const urlFnRegex = /url\(["']?(https?:\/\/[^"'\s)]+)["']?\)/gi;

// Skips images where isAlreadyProxied() returns true
// Proxies remaining images in parallel
// Replaces all occurrences in HTML
```

---

### `lib/video-overlay.ts` — YouTube thumbnail compositing

**Known issue (separate from the scheduler bug):**
```typescript
const composited = await thumbnailImage
  .composite([...])
  .png()         // ← OUTPUTS PNG, not JPEG — much larger file
  .toBuffer();

// Uploads to "chat-assets" bucket (NOT "email-images")
// Filename is timestamp-based — no deduplication:
const filename = `video-thumb-${Date.now()}-${Math.random()...}.png`;
await supabase.storage.from("chat-assets").upload(storagePath, composited, ...)
```

**Consequences:**
1. Video thumbnails are stored as PNG in `chat-assets` (~1-2MB each, timestamped, no dedup)
2. `isAlreadyProxied` does NOT recognize `chat-assets/` URLs → treated as external
3. `proxyEmailImages` will re-download and re-process these PNG composites on every send
4. A PNG → JPEG recompression via Sharp should reduce size, but requires Sharp to complete

**Guard that prevents double-compositing:**
```typescript
if (isVideoUrl(linkUrl) && imgSrc && !imgSrc.includes("video-thumbnails/")) {
  // only composite if src doesn't already have "video-thumbnails/" in it
}
```

---

### `inngest/functions/scheduled-send.ts` — Scheduled campaign trigger

```typescript
export const scheduledCampaignSend = inngest.createFunction(
  { id: "scheduled-campaign-send" },
  { event: "campaign.scheduled-send" },
  async ({ event, step }) => {
    await step.sleepUntil("wait-for-schedule", new Date(scheduledAt));

    const campaign = await step.run("check-campaign", async () => { ... });

    // This step calls send-stream via HTTP and waits for the entire stream:
    const result = await step.run("send-broadcast", async () => {
      const response = await fetch(`${baseUrl}/api/send-stream`, {
        method: "POST",
        body: JSON.stringify({ campaignId, ... }),
      });

      // Consumes the full NDJSON streaming response, which includes:
      //   - addPlayButtonsToVideoThumbnails (~2-5s per video)
      //   - proxyEmailImages per large image (~5-15s each: download + Sharp + upload)
      //   - Email send loop (~600ms per subscriber)
      // Total could easily exceed 60 seconds for multi-image, multi-subscriber sends
      const text = await response.text();
    });

    await step.run("update-status", async () => { ... });
  }
);
```

---

## Root Cause Analysis

### Primary theory: Vercel function timeout killing `proxyEmailImages`

| Layer | Default Timeout | After Fix |
|-------|----------------|-----------|
| `send-stream` (Vercel function) | 10s (Hobby) / 60s (Pro) | **300s** (added `maxDuration=300`) |
| `send-rotation` (Vercel function) | 10s (Hobby) / 60s (Pro) | **300s** (added `maxDuration=300`) |
| Inngest `step.run()` | Inherits Vercel timeout | No change |

**What was happening:**
1. Inngest fires "send-broadcast" step → calls `fetch(/api/send-stream)`
2. `send-stream` starts: renders HTML, adds video overlay, begins `proxyEmailImages`
3. `proxyEmailImages` fetches a 1MB image → Sharp processes it → tries Supabase upload
4. Vercel kills `send-stream` at 60s — mid-way through image upload
5. `fetch()` in the Inngest step catches a network error or gets a truncated response
6. `proxyImage` catches the error and **silently returns the original URL** (the fallback)
7. The send loop runs... but wait — if `send-stream` was killed, how did emails still send?

**Possible resolution:** The send loop runs AFTER `proxyEmailImages`. If `send-stream` was killed DURING `proxyEmailImages`, the send loop never ran. But the user DID receive the emails. This means either:
- (a) The timeout happened DURING the per-subscriber send loop (after image proxy returned original URLs due to a different error)
- (b) `proxyEmailImages` itself isn't timing out — it's erroring for a different reason (content-type mismatch, regex miss, etc.)

### Alternative theory: Silent content-type mismatch (pre-existing)

Before our `inferMimeFromUrl` fix, if Supabase returned `application/octet-stream` for a JPEG:
```typescript
const rawContentType = (res.headers.get("content-type") || "image/jpeg")  // ← old code
```
The old code defaulted to `"image/jpeg"` if no content-type was set — so this wasn't the issue.

BUT: Some image hosts return `application/octet-stream`. In that case, `COMPRESS_FORMATS.has("application/octet-stream")` = `false` → routes to `storeOriginal` → stores 1MB+ image **as-is** in `hashed/`. Once it's in `hashed/`, `isAlreadyProxied` = `true` on all future sends → never optimized again.

---

## Timeline of All Changes

| Commit | Change | Result |
|--------|--------|--------|
| Before session | Original: images 1MB, 2.4MB on scheduled sends | Bug |
| `fe80edc` | Fixed `isAlreadyProxied` to only skip `optimized/` and `hashed/` (not all Supabase) | Partial fix |
| `65977f6` | Reordered: `proxyEmailImages` runs AFTER `addPlayButtonsToVideoThumbnails` | Correct order |
| `a42e0e8` | Expanded URL scanner (added `url()` pattern), `inferMimeFromUrl` fallback, verbose logging | More correct |
| `9f26a9a` | **BAD**: Added Inngest pre-process-images step that ran `addPlayButtonsToVideoThumbnails` + `proxyEmailImages` + saved to template DB | Images got BIGGER (1MB→1.7MB, 2.4MB→3.2MB) |
| `81f408b` | Reverted pre-process step + added `maxDuration=300` to `send-stream` and `send-rotation` | **Current state** |

### Why the pre-process step made things worse

1. Pre-process step called `addPlayButtonsToVideoThumbnails` on the template campaign's `html_content`
2. `compositePlayButton` downloaded YouTube JPEG → composited play button → **output PNG** (1.7MB+ vs 100KB JPEG)
3. PNG stored in `chat-assets/video-thumbnails/` with timestamp filename (no dedup)
4. `proxyEmailImages` ran: tried to optimize the PNG from `chat-assets` — likely timed out or stored unoptimized in `hashed/`
5. **Wrote this broken HTML back to the campaign template in the DB permanently**
6. `send-stream` then ran on the pre-mutated campaign: found `chat-assets/` URL, `isAlreadyProxied` = false, re-entered `proxyImage`... but the PNG was now cached in `hashed/` → treated as proxied → sent 1.7MB PNG

---

## Open Questions for DeepThink

1. **Does `maxDuration=300` actually survive the nested timeout?**
   The Inngest step function (`scheduled-send.ts`) is ALSO a Vercel function. When it calls `fetch(send-stream)` and does `await response.text()`, the OUTER step function must also stay alive for 300 seconds. Does the outer function inherit the inner function's `maxDuration`? Or does it have its own default timeout that kills the `await response.text()` call?

2. **Is `hashed/` still a valid "already proxied" signal?**
   Images stored in `hashed/` via `storeOriginal` are stored **without compression**. If a 1MB JPEG was stored un-optimized in `hashed/` (e.g., due to a content-type mismatch sending it down the `storeOriginal` path), all future sends will skip it because `isAlreadyProxied` returns `true`. Should `hashed/` be removed from the "already proxied" check? This would cause re-processing on every send but would never serve stale unoptimized images.

3. **Should video thumbnails be JPEG and stored in `email-images`?**
   `compositePlayButton` outputs PNG (large) and stores in `chat-assets` with no deduplication. If it output JPEG and stored in `email-images/video-thumbnails/` with a SHA-256 hash of the YouTube URL, it would:
   - Output much smaller files (JPEG vs PNG)
   - Be recognized by `isAlreadyProxied` (if we add `video-thumbnails/` to the check)
   - Skip re-downloading and re-compositing on every send (content-addressed cache)

4. **Is there a race condition in `send-stream` for scheduled sends?**
   When the Inngest `step.run("send-broadcast")` calls `fetch(send-stream)`, two Vercel functions are running simultaneously. Both have their own Vercel timeout clocks. Is there any documented behavior for what happens to the inner function when the outer step times out first?

---

## Proposed Architectural Fixes (for evaluation)

### Option A: `maxDuration=300` (deployed — current approach)
- ✅ Minimal code change
- ❓ Requires Vercel Pro plan (300s not available on Hobby)
- ❓ Nested timeout issue may remain (outer step function timeout)

### Option B: Process images at SCHEDULE time, not SEND time
- When user clicks "Schedule", immediately run `proxyEmailImages` on the campaign HTML
- Store the optimized HTML in a new DB column: `pre_optimized_html`
- At send time, `send-stream` uses `pre_optimized_html` if present (skips image proxy)
- After send, clear `pre_optimized_html`
- ✅ Image optimization happens when user is still watching (immediate feedback)
- ✅ Completely avoids timeout issues at send time
- ⚠️ Requires new DB column + schema migration

### Option C: Fix `video-overlay.ts` — JPEG output + `email-images` bucket + dedup
```typescript
// Change:
.png()
// To:
.jpeg({ quality: 82, mozjpeg: true })

// Change bucket:
supabase.storage.from("email-images").upload(`video-thumbnails/${hash}.jpg`, ...)

// Use SHA-256 of YouTube URL as cache key (not timestamp):
const hash = crypto.createHash("sha256").update(thumbnailUrl).digest("hex");
const filename = `${hash}.jpg`;
```
And update `isAlreadyProxied` to also recognize `email-images/video-thumbnails/`:
```typescript
return (
  path.includes(`/object/public/email-images/optimized/`) ||
  path.includes(`/object/public/email-images/hashed/`) ||
  path.includes(`/object/public/email-images/video-thumbnails/`)
);
```
- ✅ Fastest fix: reduces processing time by ~50%
- ✅ Video thumbnails properly deduplicated (same YouTube URL → same Supabase path)
- ✅ JPEG instead of PNG: ~5-10x smaller output
- ✅ No schema changes needed

### Option D: Move to Inngest Cloud execution (long-running steps)
- Configure Inngest to run steps on its own infrastructure (not Vercel)
- Steps can run for hours, not 60 seconds
- ✅ Eliminates timeout issues entirely
- ⚠️ Requires Inngest Cloud plan configuration changes

---

## What To Test After Each Fix

### Testing `maxDuration=300` (current deploy)
1. Wait for Vercel deploy of commit `81f408b` (~2-3 min)
2. Schedule a campaign 5-10 minutes out
3. Check Vercel function logs after it sends for `[ImageProxy]` lines:
   - `shouldOptimize=true` → Sharp was triggered
   - `✅ Stored optimized` → Supabase upload succeeded
   - `✅ N image(s) optimized & proxied` → end-to-end success
4. Check received email — images should be ~100KB

### Testing Option C (video overlay JPEG fix)
1. Create a campaign with a YouTube video link
2. Send immediately (not scheduled)
3. Check email — video thumbnail should be ~100-200KB (was ~1-2MB PNG)
4. Send again — should use cached version from `email-images/video-thumbnails/`
