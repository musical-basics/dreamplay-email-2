/**
 * image-proxy.ts
 *
 * Scans email HTML for external <img src="..."> URLs, optimizes oversized
 * images using Sharp, and stores permanent copies in Supabase Storage.
 *
 * Pipeline per image:
 *   1. HEAD check → get size before downloading
 *   2. If ≤ OPTIMIZE_BYTES → download & store as-is (fast path)
 *   3. If > OPTIMIZE_BYTES → download → resize + compress with Sharp
 *      → convert PNG→JPEG → store optimized copy
 *   4. Cache key = SHA-256 of buf (original) or SHA-256(sourceUrl+config) (optimized)
 *
 * Bucket  : email-images   (public read, service-role write)
 * NOTE: bucket file_size_limit is 5MB — all OPTIMIZED outputs are always ≤5MB JPEG
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import sharp from "sharp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;
const BUCKET       = "email-images";

const WARN_BYTES     = 3 * 1024 * 1024;  // 3 MB
const OPTIMIZE_BYTES = 5 * 1024 * 1024;  // 5 MB
const TARGET_WIDTH   = 1200;
const JPEG_QUALITY   = 82;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg":    "jpg",
  "image/jpg":     "jpg",
  "image/png":     "png",
  "image/gif":     "gif",
  "image/webp":    "webp",
  "image/svg+xml": "svg",
  "image/avif":    "avif",
};

function tag(url: string) {
  try { return new URL(url).pathname.split("/").pop()?.slice(0, 40) ?? url } catch { return url }
}

function getSupabaseClient() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("[ImageProxy] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY is not set");
  }
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
// Core: proxy one image — always returns a URL (original on any failure)
// ─────────────────────────────────────────────────────────────────────────────

export async function proxyImage(imageUrl: string): Promise<string> {
  const label = tag(imageUrl);

  if (isAlreadyProxied(imageUrl)) {
    console.log(`[ImageProxy] ✅ Already proxied, skip: ${label}`);
    return imageUrl;
  }

  let supabase: ReturnType<typeof createClient>;
  try {
    supabase = getSupabaseClient();
  } catch (err: any) {
    console.error(`[ImageProxy] ❌ Cannot create Supabase client: ${err.message}`);
    return imageUrl;
  }

  try {
    // ── 1. HEAD check ──────────────────────────────────────────────────────
    let headSize: number | null = null;
    try {
      const head = await fetch(imageUrl, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
      const cl = head.headers.get("content-length");
      headSize = cl ? parseInt(cl, 10) : null;
      console.log(`[ImageProxy] HEAD ${label} → HTTP ${head.status}, content-length=${headSize ?? "unknown"}`);
      if (!head.ok) {
        console.warn(`[ImageProxy] ⚠️  HEAD failed HTTP ${head.status} for ${label} — proceeding to GET anyway`);
      }
    } catch (headErr: any) {
      console.warn(`[ImageProxy] ⚠️  HEAD request failed for ${label}: ${headErr.message} — proceeding to GET`);
    }

    // ── 2. Download ────────────────────────────────────────────────────────
    console.log(`[ImageProxy] GET ${imageUrl}`);
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      console.error(`[ImageProxy] ❌ GET failed HTTP ${res.status} for ${label} — keeping original URL`);
      return imageUrl;
    }

    const rawContentType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    const buf = Buffer.from(await res.arrayBuffer());
    const actualSizeKB = Math.round(buf.length / 1024);

    console.log(`[ImageProxy] Downloaded ${label}: ${actualSizeKB}KB, content-type=${rawContentType}`);

    if (buf.length > WARN_BYTES) {
      console.warn(`[ImageProxy] ⚠️  Large image: ${label} = ${actualSizeKB}KB (>${Math.round(WARN_BYTES/1024/1024)}MB threshold)`);
    }

    // ── 3. Route: optimize or store as-is ─────────────────────────────────
    if (buf.length > OPTIMIZE_BYTES) {
      console.log(`[ImageProxy] → Needs optimization (${actualSizeKB}KB > ${Math.round(OPTIMIZE_BYTES/1024/1024)}MB), running Sharp...`);
      return await optimizeAndStore(supabase, buf, imageUrl, rawContentType);
    } else {
      console.log(`[ImageProxy] → Within size limits, storing as-is...`);
      return await storeOriginal(supabase, buf, imageUrl, rawContentType);
    }

  } catch (err: any) {
    console.error(`[ImageProxy] ❌ Unexpected error for ${label}: ${err.message}`);
    console.error(err.stack);
    return imageUrl;
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
  const label = tag(sourceUrl);
  const ext   = MIME_TO_EXT[contentType] ?? "bin";
  const hash  = crypto.createHash("sha256").update(buf).digest("hex");
  const path  = `hashed/${hash}.${ext}`;

  console.log(`[ImageProxy] Checking dedup for ${label} → path=${path}`);

  const { data: existing, error: listErr } = await supabase.storage.from(BUCKET).list("hashed", {
    search: `${hash}.${ext}`,
    limit: 1,
  });

  if (listErr) {
    console.error(`[ImageProxy] ❌ Storage list error: ${listErr.message}`);
  }

  if (existing && existing.length > 0) {
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    console.log(`[ImageProxy] ✅ Cache hit (original): ${label} → ${urlData.publicUrl}`);
    return urlData.publicUrl;
  }

  console.log(`[ImageProxy] Uploading ${label} (${Math.round(buf.length/1024)}KB) to ${path}...`);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, { contentType, upsert: false });

  if (error) {
    if (error.message === "The resource already exists") {
      // Lost the race — that's fine, just return the URL
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      console.log(`[ImageProxy] ✅ Race-condition dedup: ${label} → ${urlData.publicUrl}`);
      return urlData.publicUrl;
    }
    console.error(`[ImageProxy] ❌ Upload failed for ${label}: ${error.message} (status: ${(error as any).statusCode ?? "?"})`);
    return sourceUrl;
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  console.log(`[ImageProxy] ✅ Stored original: ${label} → ${urlData.publicUrl}`);
  return urlData.publicUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimize + store (for images over the OPTIMIZE_BYTES threshold)
// NOTE: output is always JPEG ≤ TARGET_WIDTH px — well under bucket 5MB limit
// ─────────────────────────────────────────────────────────────────────────────

async function optimizeAndStore(
  supabase: ReturnType<typeof createClient>,
  buf: Buffer,
  sourceUrl: string,
  originalContentType: string
): Promise<string> {
  const label = tag(sourceUrl);
  const configSuffix = `w${TARGET_WIDTH}q${JPEG_QUALITY}`;
  const cacheKey = crypto.createHash("sha256").update(sourceUrl + configSuffix).digest("hex");
  const path = `optimized/${cacheKey}.jpg`;

  console.log(`[ImageProxy] Checking optimized cache for ${label} → ${path}`);

  const { data: existing, error: listErr } = await supabase.storage.from(BUCKET).list("optimized", {
    search: `${cacheKey}.jpg`,
    limit: 1,
  });

  if (listErr) {
    console.error(`[ImageProxy] ❌ Storage list error for optimized: ${listErr.message}`);
  }

  if (existing && existing.length > 0) {
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    console.log(`[ImageProxy] ✅ Cache hit (optimized): ${label} → ${urlData.publicUrl}`);
    return urlData.publicUrl;
  }

  // Run Sharp
  console.log(`[ImageProxy] Running Sharp on ${label} (${Math.round(buf.length/1024)}KB, ${originalContentType})...`);
  let meta: sharp.Metadata;
  let optimizedBuf: Buffer;

  try {
    const image = sharp(buf);
    meta = await image.metadata();
    console.log(`[ImageProxy] Sharp metadata: ${meta.width}×${meta.height}, format=${meta.format}`);

    optimizedBuf = await image
      .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    const outMeta = await sharp(optimizedBuf).metadata();
    console.log(
      `[ImageProxy] Sharp output: ${outMeta.width}×${outMeta.height} JPEG, ` +
      `${Math.round(buf.length/1024)}KB → ${Math.round(optimizedBuf.length/1024)}KB ` +
      `(${Math.round((1 - optimizedBuf.length/buf.length)*100)}% savings)`
    );
  } catch (sharpErr: any) {
    console.error(`[ImageProxy] ❌ Sharp failed for ${label}: ${sharpErr.message}`);
    console.log(`[ImageProxy] Falling back to storeOriginal for ${label}`);
    return await storeOriginal(supabase, buf, sourceUrl, originalContentType);
  }

  console.log(`[ImageProxy] Uploading optimized ${label} (${Math.round(optimizedBuf.length/1024)}KB) to ${path}...`);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, optimizedBuf, { contentType: "image/jpeg", upsert: false });

  if (error) {
    if (error.message === "The resource already exists") {
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      console.log(`[ImageProxy] ✅ Race-condition dedup (optimized): ${label} → ${urlData.publicUrl}`);
      return urlData.publicUrl;
    }
    console.error(`[ImageProxy] ❌ Optimized upload failed for ${label}: ${error.message} (status: ${(error as any).statusCode ?? "?"})`);
    // Fall back to storing the original if the optimized upload fails
    console.log(`[ImageProxy] ⚠️  Attempting to store original as fallback...`);
    return await storeOriginal(supabase, buf, sourceUrl, originalContentType);
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  console.log(`[ImageProxy] ✅ Stored optimized: ${label} → ${urlData.publicUrl}`);
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
    console.log("[ImageProxy] No external images found — all images already on Supabase or no images present.");
    return html;
  }

  console.log(`[ImageProxy] ═══ Starting proxy for ${externalUrls.size} unique external URL(s) ═══`);
  Array.from(externalUrls).forEach((u, i) => console.log(`[ImageProxy]   [${i+1}] ${u}`));

  // Proxy all unique URLs in parallel
  const urlMap = new Map<string, string>();
  await Promise.all(
    Array.from(externalUrls).map(async (url) => {
      const proxied = await proxyImage(url);
      urlMap.set(url, proxied);
    })
  );

  // Summary
  console.log(`[ImageProxy] ═══ Proxy results ═══`);
  for (const [original, proxied] of urlMap) {
    const changed = original !== proxied;
    console.log(`[ImageProxy]   ${changed ? "✅ PROXIED" : "⚠️  UNCHANGED"}: ${tag(original)} → ${changed ? proxied : "(original URL kept)"}`);
  }

  // Replace all occurrences in the HTML
  let rewritten = html;
  for (const [original, proxied] of urlMap) {
    if (original !== proxied) {
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      rewritten = rewritten.replace(new RegExp(escaped, "g"), proxied);
    }
  }

  const proxiedCount = Array.from(urlMap.entries()).filter(([o, p]) => o !== p).length;
  console.log(`[ImageProxy] ═══ Done: ${proxiedCount}/${externalUrls.size} proxied ═══`);

  return rewritten;
}
