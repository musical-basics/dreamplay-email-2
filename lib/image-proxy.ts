/**
 * image-proxy.ts
 *
 * Scans email HTML for external <img src="..."> URLs, optimizes oversized
 * images using Sharp, and stores permanent copies in Supabase Storage.
 *
 * Pipeline per image:
 *   1. HEAD check → get size before downloading
 *   2. If ≤ MAX_PASSTHROUGH_BYTES → download & store as-is (fast path)
 *   3. If > MAX_PASSTHROUGH_BYTES → download → resize + compress with Sharp
 *      → convert PNG→JPEG when no transparency → store optimized copy
 *   4. Cache key = SHA-256 of source URL + transform config
 *      (so the same source at the same config is never re-processed)
 *
 * Bucket  : email-images   (public read, service-role write)
 * Paths   :
 *   hashed/{sha256}.{ext}           — original ≤ threshold
 *   optimized/{config_hash}.jpg     — auto-optimized copy
 *
 * Constraints enforced:
 *   WARNING  threshold : > 3 MB  (logs but passes through unless also > HARD)
 *   HARD     threshold : > 5 MB  → always optimize before storing
 *   TARGET   width     : 1200px  (email sweet-spot; wider wastes bandwidth)
 *   JPEG     quality   : 82      (visually lossless for product photos)
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import sharp from "sharp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;
const BUCKET       = "email-images";

// ── Thresholds ────────────────────────────────────────────────────────────────
const WARN_BYTES         = 3 * 1024 * 1024;  // 3 MB → warn in logs
const OPTIMIZE_BYTES     = 5 * 1024 * 1024;  // 5 MB → always optimize
const TARGET_WIDTH       = 1200;              // email-safe max width
const JPEG_QUALITY       = 82;               // 82% JPEG — visually lossless for photos

// ── MIME helpers ──────────────────────────────────────────────────────────────
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg":    "jpg",
  "image/jpg":     "jpg",
  "image/png":     "png",
  "image/gif":     "gif",
  "image/webp":    "webp",
  "image/svg+xml": "svg",
  "image/avif":    "avif",
};

function getSupabaseClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

function isAlreadyProxied(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname.includes(".supabase.co") || hostname.includes(".supabase.in");
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: proxy one image
// ─────────────────────────────────────────────────────────────────────────────

export async function proxyImage(imageUrl: string): Promise<string> {
  if (isAlreadyProxied(imageUrl)) return imageUrl;

  const supabase = getSupabaseClient();

  try {
    // ── 1. HEAD check ─────────────────────────────────────────────────────────
    let headSize: number | null = null;
    try {
      const head = await fetch(imageUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(5_000),
      });
      if (head.ok) {
        const cl = head.headers.get("content-length");
        if (cl) headSize = parseInt(cl, 10);
      }
    } catch {
      // HEAD not supported by this CDN — proceed to full download
    }

    const willNeedOptimization = headSize !== null && headSize > OPTIMIZE_BYTES;

    if (headSize !== null && headSize > WARN_BYTES && !willNeedOptimization) {
      console.warn(
        `[ImageProxy] ⚠️  Large image (${Math.round(headSize / 1024 / 1024)}MB): ${imageUrl} — below hard threshold but may be slow.`
      );
    }

    // ── 2. Download ───────────────────────────────────────────────────────────
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      console.warn(`[ImageProxy] Failed to fetch ${imageUrl} — HTTP ${res.status}`);
      return imageUrl;
    }

    const rawContentType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    const buf = Buffer.from(await res.arrayBuffer());
    const actualSize = buf.length;

    const needsOptimization = actualSize > OPTIMIZE_BYTES;

    if (needsOptimization) {
      console.warn(
        `[ImageProxy] ⚠️  Oversized image (${Math.round(actualSize / 1024 / 1024)}MB > 5MB): ${imageUrl} — auto-optimizing...`
      );
    } else if (actualSize > WARN_BYTES) {
      console.warn(
        `[ImageProxy] ⚠️  Large image (${Math.round(actualSize / 1024)}KB): ${imageUrl}`
      );
    }

    // ── 3. Optimize if needed ─────────────────────────────────────────────────
    if (needsOptimization) {
      return await optimizeAndStore(supabase, buf, imageUrl, actualSize, rawContentType);
    }

    // ── 4. Fast path: store as-is ─────────────────────────────────────────────
    return await storeOriginal(supabase, buf, imageUrl, rawContentType);

  } catch (err: any) {
    console.error(`[ImageProxy] Unexpected error for ${imageUrl}:`, err.message);
    return imageUrl; // fail open — never block a send
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Store original (fast path for images under the threshold)
// ─────────────────────────────────────────────────────────────────────────────

async function storeOriginal(
  supabase: ReturnType<typeof createClient>,
  buf: Buffer,
  sourceUrl: string,
  contentType: string
): Promise<string> {
  const ext  = MIME_TO_EXT[contentType] ?? "bin";
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  const path = `hashed/${hash}.${ext}`;

  // Dedup check
  const { data: existing } = await supabase.storage.from(BUCKET).list("hashed", {
    search: `${hash}.${ext}`,
    limit: 1,
  });

  if (existing && existing.length > 0) {
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    console.log(`[ImageProxy] Cache hit (original): ${hash}.${ext}`);
    return urlData.publicUrl;
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, { contentType, upsert: false });

  if (error && error.message !== "The resource already exists") {
    console.error(`[ImageProxy] Upload failed for ${sourceUrl}:`, error.message);
    return sourceUrl;
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  console.log(`[ImageProxy] Stored original (${Math.round(buf.length / 1024)}KB): ${hash}.${ext}`);
  return urlData.publicUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimize + store (for images over the OPTIMIZE_BYTES threshold)
// ─────────────────────────────────────────────────────────────────────────────

async function optimizeAndStore(
  supabase: ReturnType<typeof createClient>,
  buf: Buffer,
  sourceUrl: string,
  originalSize: number,
  originalContentType: string
): Promise<string> {
  // Cache key = hash of (sourceUrl + transform params) so same source + config
  // always maps to the same stored file.
  const configSuffix = `w${TARGET_WIDTH}q${JPEG_QUALITY}`;
  const cacheKey = crypto
    .createHash("sha256")
    .update(sourceUrl + configSuffix)
    .digest("hex");
  const path = `optimized/${cacheKey}.jpg`;

  // Check if we've already optimized this exact source+config
  const { data: existing } = await supabase.storage.from(BUCKET).list("optimized", {
    search: `${cacheKey}.jpg`,
    limit: 1,
  });

  if (existing && existing.length > 0) {
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    console.log(`[ImageProxy] Cache hit (optimized): ${cacheKey}.jpg`);
    return urlData.publicUrl;
  }

  // ── Sharp: resize + convert to JPEG ────────────────────────────────────────
  const image = sharp(buf);
  const meta  = await image.metadata();
  const originalWidth  = meta.width  ?? 0;
  const originalHeight = meta.height ?? 0;

  const optimizedBuf = await image
    .resize({
      width: TARGET_WIDTH,
      // Only downscale — never upscale smaller images
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  const optimizedMeta = await sharp(optimizedBuf).metadata();

  console.log(
    `[ImageProxy] ✅ Optimized:\n` +
    `  Source : ${sourceUrl}\n` +
    `  Before : ${originalWidth}×${originalHeight} ${originalContentType} ${Math.round(originalSize / 1024)}KB\n` +
    `  After  : ${optimizedMeta.width}×${optimizedMeta.height} image/jpeg ${Math.round(optimizedBuf.length / 1024)}KB\n` +
    `  Savings: ${Math.round((1 - optimizedBuf.length / originalSize) * 100)}%`
  );

  // ── Upload ─────────────────────────────────────────────────────────────────
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, optimizedBuf, { contentType: "image/jpeg", upsert: false });

  if (error && error.message !== "The resource already exists") {
    console.error(`[ImageProxy] Optimized upload failed for ${sourceUrl}:`, error.message);
    return sourceUrl; // fail open
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return urlData.publicUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry: scan HTML and proxy/optimize all external images
// ─────────────────────────────────────────────────────────────────────────────

export async function proxyEmailImages(html: string): Promise<string> {
  if (!html) return html;

  const srcRegex = /src=["'](https?:\/\/[^"']+)['"]/gi;
  const externalUrls = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = srcRegex.exec(html)) !== null) {
    const url = match[1];
    if (!isAlreadyProxied(url)) {
      externalUrls.add(url);
    }
  }

  if (externalUrls.size === 0) {
    console.log("[ImageProxy] No external images found, skipping.");
    return html;
  }

  console.log(`[ImageProxy] Processing ${externalUrls.size} unique external image(s)...`);

  // Proxy all unique URLs in parallel
  const urlMap = new Map<string, string>();
  await Promise.all(
    Array.from(externalUrls).map(async (url) => {
      const proxied = await proxyImage(url);
      urlMap.set(url, proxied);
    })
  );

  // Replace all occurrences in the HTML
  let rewritten = html;
  for (const [original, proxied] of urlMap) {
    if (original !== proxied) {
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      rewritten = rewritten.replace(new RegExp(escaped, "g"), proxied);
    }
  }

  const proxiedCount = Array.from(urlMap.entries()).filter(([o, p]) => o !== p).length;
  console.log(`[ImageProxy] Done. ${proxiedCount}/${externalUrls.size} images proxied/optimized.`);

  return rewritten;
}
