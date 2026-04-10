# Email Image Proxy & Optimization Pipeline

## Why this exists

Email clients (especially Gmail mobile) are extremely strict about images:
- **Raw R2/Cloudflare CDN URLs can be blocked** — Gmail's image fetcher gets rate-limited or rejected by Cloudflare bot protection
- **Images >5MB silently fail to render** in Gmail mobile without any error shown to the recipient
- **If an image URL goes dead** (asset renamed, CDN changes), old sent emails break

The solution: at send time, every external image gets downloaded, optionally optimized, and stored permanently in our own Supabase Storage bucket (`email-images`). The email HTML is rewritten to use those permanent Supabase URLs before it's sent.

---

## What does the actual compression

**Sharp** — an open-source Node.js image processing library (no AI involved, no Claude). It uses libvips under the hood, the same library used by most image CDNs. It runs directly on Vercel's Node.js runtime. Zero API cost.

---

## The pipeline (`lib/image-proxy.ts`)

For each `<img src="...">` found in the campaign HTML:

```
External URL found
       │
       ▼
Already on Supabase? ──YES──► Skip (already permanent)
       │
       NO
       ▼
HEAD request (get file size without downloading)
       │
       ▼
GET request (download the image)
       │
       ├─── ≤ 5MB ──► Store as-is in Supabase
       │               path: hashed/{sha256}.{ext}
       │
       └─── > 5MB ──► Run Sharp:
                       - Resize to max 1200px wide
                       - Convert PNG → JPEG  
                       - Compress at quality 82 (mozjpeg)
                       Store optimized copy in Supabase
                       path: optimized/{cache_key}.jpg
                       (cache key = SHA-256 of sourceURL + config)
       │
       ▼
Return permanent Supabase public URL
```

**Deduplication:** The SHA-256 hash means the same source image is never stored twice. If 100 campaigns use the same hero image, it's stored exactly once.

**Fail-open:** If anything fails (network timeout, Supabase upload error, Sharp crash), the original URL is kept and the send continues. The email may have a broken image, but it will still be delivered.

---

## Thresholds

| Threshold | Bytes | Action |
|---|---|---|
| Warning | > 3MB | Logged in Vercel |
| Optimize | > 5MB | Sharp resize + JPEG conversion |
| Bucket limit | 5MB | Supabase bucket max file size |

> Note: Optimized outputs (Sharp JPEG) are always well under 5MB, so they always fit within the bucket limit.

---

## Storage layout (`email-images` bucket)

```
email-images/
  hashed/
    {sha256}.jpg        ← originals under 5MB, stored by content hash
    {sha256}.png
    ...
  optimized/
    {cache_key}.jpg     ← Sharp-optimized copies, always JPEG
```

---

## Where the proxy is called

| Send path | File | Status |
|---|---|---|
| Dashboard "Send Now" button | `app/api/send-stream/route.ts` | ✅ Called |
| Inngest background send | `inngest/functions/send-campaign.ts` | ✅ Called |
| Rotation send | `app/api/send-rotation/route.ts` | ✅ Called |
| Welcome / subscribe webhook | `app/api/webhooks/subscribe/route.ts` | ✅ Called |
| Chain/drip sender | `lib/chains/sender.ts` | ✅ Called |

---

## Why images were initially slow to load after the fix

The first time a campaign is sent after this change, the proxy:
1. Downloads each image from R2 (~1–8MB each)
2. Runs Sharp (CPU work on Vercel)
3. Uploads to Supabase

This happens **synchronously during the send**, so the send is slightly slower on first run. On subsequent sends of the same template, all images hit the cache (dedup check finds them in Supabase), so there's zero download/upload overhead.

**Solution for slow loads in inbox:** This is a one-time cost. The next send of this campaign will reuse the already-stored Supabase URLs. Supabase's CDN (backed by Cloudflare) is globally distributed and fast for email clients.

---

## Dashboard: Image Health Card

Located in the campaign dashboard left column, below Pre-Flight Check.

Does a browser-side HEAD request for every image in the campaign HTML and classifies each:

| Status | Meaning |
|---|---|
| ✅ Proxied (Supabase) | Already on permanent CDN — no action needed |
| ✅ OK | Under 3MB — will be proxied at send time |
| ⚠️ Large | 3–5MB — will be proxied as-is |
| 🟠 Oversized | > 5MB — will be auto-optimized with Sharp at send time |

If any oversized images are found, a banner appears:
> *"1 image is over 5MB and will be automatically resized to 1200px JPEG when this campaign is sent."*

---

## Send Console logging

During a send, the console now shows:
```
✅ 3 image(s) proxied to Supabase CDN
```
or if something went wrong:
```
⚠️ No images were proxied — check Vercel logs for proxy errors
```

Full verbose logs are available in **Vercel → Functions → Logs** under `[ImageProxy]` prefix, showing:
- HEAD status and file size for each image
- Download size and content type
- Sharp before/after dimensions and file size savings
- Supabase upload result (success or error code)
- Per-image PROXIED / UNCHANGED summary

---

## Known limitations

1. **The proxy rewrites HTML in memory at send time** — the campaign's `html_content` in the database still contains the original R2 URLs. This is intentional (preserves editability). Only the emails actually delivered have Supabase URLs.

2. **Vercel function timeout** — for campaigns with many large images, Sharp + upload can take time. If Vercel times out (max 60s on Pro), some images may fall back to original URLs. Consider pre-optimizing extremely large source assets before using them in campaigns.

3. **Supabase bucket file size limit is 5MB** — this is fine for optimized JPEG outputs but means it's not possible to store >5MB originals directly. The optimizer always produces JPEG output under this limit.

---

## How to debug a broken image

1. Open **Vercel → Functions → Logs**
2. Search for `[ImageProxy]`
3. Look for the image filename (e.g. `Gold DS 6.0 full.png`)
4. Check for:
   - `HEAD` → HTTP 403/404 = R2 access issue
   - `GET` → HTTP error = download failed
   - `Upload failed` → Supabase error code (likely file size limit)
   - `UNCHANGED` in the summary = proxy failed, original URL was kept

5. Check **Supabase → Storage → email-images** to confirm files are being stored
