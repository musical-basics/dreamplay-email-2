# DreamPlay Email App — Automatic Image Optimization Spec

## Goal
Prevent broken or silently dropped images in email clients (especially Gmail mobile) by automatically optimizing large source images before they are used in campaign HTML.

## Why
Some source assets are valid public Cloudflare/R2 files but are too large for reliable email rendering.
Example: large PNGs around ~5MB+ may technically download successfully yet fail to render in Gmail mobile.

This is an email-delivery constraint, not just an asset-hosting issue.

---

## Recommended architecture
Handle this in the **email application layer**, not only upstream in asset storage.

Reason:
- the same source asset may be fine for web but not email
- email clients have stricter rendering constraints
- the email app should be responsible for producing email-safe image variants

---

## Required behavior

### 1. Intercept/normalize image URLs used in campaigns
Whenever a campaign is created, updated, rendered, or proxied for sending:
- inspect each `<img src="...">`
- fetch metadata for the source image
- decide whether optimization is required

### 2. Enforce email-safe constraints
Recommended defaults:
- max width: **1920px**
- target width for most email images: **1200–1600px**
- preferred format: **JPEG** for photographic/product images
- keep PNG only when true transparency is necessary
- target filesize: **< 2MB**
- warning threshold: **> 3MB**
- hard action threshold: **> 5MB**

### 3. Auto-optimize oversized assets
If the source image exceeds thresholds:
- download image
- resize to email-safe width
- recompress aggressively enough for reliable email delivery
- convert PNG → JPEG when transparency is not required
- store optimized copy in a dedicated email-assets bucket/path
- rewrite campaign HTML to use the optimized image URL instead of the original

### 4. Cache optimized variants
Do not recompute on every send if the exact same source image has already been optimized.
Use a deterministic cache key based on:
- source URL
- transformation config
- possibly source ETag/hash if available

### 5. Log clearly
When optimization occurs, log:
- source URL
- original dimensions
- original filesize
- optimized dimensions
- optimized filesize
- output URL

When a source asset is above threshold, log a clear warning such as:
- `⚠️ ACTION REQUIRED: source image exceeded email-safe threshold; optimized variant generated`

---

## Recommended implementation points

### Option A — optimize during image proxying
If the system already uses an image proxy for email sends:
- add HEAD/metadata check first
- if image is too large, transform before returning/storing

This is likely the fastest path.

### Option B — optimize during campaign save/render
When campaign HTML is saved or prepared for send:
- scan all images
- pre-generate optimized email variants
- rewrite HTML before the send job starts

This may be cleaner than doing it live during send.

---

## Suggested data model / storage
Store optimized variants in a dedicated path such as:
- `email-assets/optimized/...`
- `email-assets/cache/...`

Optional metadata table:
- `email_image_variants`

Suggested fields:
- `id`
- `source_url`
- `source_size_bytes`
- `source_width`
- `source_height`
- `optimized_url`
- `optimized_size_bytes`
- `optimized_width`
- `optimized_height`
- `format`
- `created_at`
- `etag` or `source_hash`

This makes debugging and reuse easier.

---

## Fallback rules

### If optimization succeeds
- rewrite campaign HTML to the optimized URL
- continue send normally

### If optimization fails
- log error clearly
- either:
  1. block the send for that campaign with a readable error, or
  2. mark the campaign as needing attention

Do **not** silently proceed with a known-bad oversized image.

---

## MIME / format recommendations

### Use JPEG when:
- product photography
- hero images
- lifestyle images
- rendered/studio shots

### Keep PNG only when:
- transparency is essential
- graphic artifacts from JPEG would be unacceptable

In most DreamPlay email cases, JPEG is the better default.

---

## UX / product recommendations

### In campaign editor/dashboard
Show a warning badge if any image is risky:
- `Image too large for reliable email delivery`
- `Optimized automatically`
- `Original 7.9MB → optimized 1.2MB JPEG`

### Nice-to-have
Add a small image health panel per campaign:
- number of images
- oversized images found
- optimized images generated

---

## Recommended order of implementation

1. add HEAD/metadata check for all image URLs
2. add threshold-based warning logs
3. add automatic resize/recompress pipeline
4. store optimized variants
5. rewrite HTML to optimized URLs
6. add dashboard warnings
7. optionally add metadata table for audit/debugging

---

## Bottom-line recommendation
Implement the primary fix in the **email application**.

Then optionally clean up upstream asset workflows later by creating email-ready asset variants in Cloudflare/R2.

But the email app should be resilient even when a user or agent chooses a source asset that is too large.
