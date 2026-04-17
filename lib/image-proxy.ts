/**
 * image-proxy.ts
 *
 * Scans email HTML for external <img src="..."> URLs (and CSS url() patterns),
 * optimizes oversized images using Sharp, and stores permanent copies in
 * Supabase Storage.
 *
 * Pipeline per image:
 *   1. HEAD check → get size/type before downloading
 *   2. Download the image buffer
 *   3. If content-type is generic (octet-stream), infer from URL extension
 *   4. If > OPTIMIZE_BYTES & compressible format → Sharp resize+compress → store optimized
 *   5. Otherwise → store as-is
 *   6. Cache key = SHA-256 of buf (original) or SHA-256(sourceUrl+config) (optimized)
 *
 * Bucket  : email-images   (public read, service-role write)
 * NOTE: bucket file_size_limit is 5MB — all OPTIMIZED outputs are always ≤5MB JPEG
 *
 * Logger: callers can pass a `logger` function (see ProxyLogger). All stages
 * emit through it so failures land in durable logs (e.g. send_logs.image_logs)
 * instead of only Vercel function logs. Default logger mirrors the original
 * console.log/warn/error behavior for backwards compatibility.
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import sharp from "sharp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;
const BUCKET       = "email-images";

const WARN_BYTES        = 500 * 1024;   // 500 KB — log a warning
const OPTIMIZE_BYTES    = 150 * 1024;   // 150 KB — run Sharp (compress anything above this)
const TARGET_WIDTH      = 1200;
const JPEG_QUALITY      = 82;           // good quality/size balance for email
const JPEG_QUALITY_FALLBACK = 90;       // retry quality if first pass is too small
const MIN_OUTPUT_BYTES  = 40 * 1024;    // 40 KB — anything smaller is likely over-compressed

// Formats that benefit from Sharp recompression (photographic content).
// SVG and GIF are passed through as-is.
const COMPRESS_FORMATS = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"]);

// Content-type inference from URL path extension
// Used as fallback when server returns generic application/octet-stream
const EXT_TO_MIME: Record<string, string> = {
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  png:  "image/png",
  webp: "image/webp",
  gif:  "image/gif",
  avif: "image/avif",
  svg:  "image/svg+xml",
};

// ─────────────────────────────────────────────────────────────────────────────
// Logger — threaded through all stages so callers can capture proxy events
// into durable storage (e.g. send_logs table) instead of only Vercel logs.
// ─────────────────────────────────────────────────────────────────────────────

export type ProxyLogLevel = "info" | "success" | "warn" | "error";
export type ProxyLogger = (
  level: ProxyLogLevel,
  message: string,
  meta?: Record<string, any>
) => void;

const defaultLogger: ProxyLogger = (level, message) => {
  if (level === "error") console.error(message);
  else if (level === "warn") console.warn(message);
  else console.log(message);
};

export interface ProxyStats {
  scanned: number;
  alreadyProxied: number;
  proxied: number;
  unchanged: number;  // attempted but returned original URL (failure indicator)
  failures: Array<{ url: string; stage: string; reason: string }>;
}

function inferMimeFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const ext = pathname.split(".").pop()?.replace(/[?#].*$/, "") ?? "";
    return EXT_TO_MIME[ext] ?? null;
  } catch {
    return null;
  }
}

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
    const parsed = new URL(url);
    const isSupabaseDomain = parsed.hostname.includes(".supabase.co") || parsed.hostname.includes(".supabase.in");
    if (!isSupabaseDomain) return false;
    // Only treat as "already proxied" if it's in one of our email-images output paths.
    // - optimized/        : went through Sharp compression
    // - hashed/           : stored as-is (small images under threshold)
    // - video-thumbnails/ : composited + JPEG by video-overlay.ts
    const path = parsed.pathname;
    return (
      path.includes(`/object/public/${BUCKET}/optimized/`) ||
      path.includes(`/object/public/${BUCKET}/hashed/`) ||
      path.includes(`/object/public/${BUCKET}/video-thumbnails/`)
    );
  } catch {
    return false;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Core: proxy one image — always returns a URL (original on any failure).
// `outcome` is populated with stage + reason when the original URL is returned
// so callers can surface the failure to durable storage.
// ─────────────────────────────────────────────────────────────────────────────

interface ProxyOutcome {
  stage?: string;
  reason?: string;
}

async function proxyImage(
  imageUrl: string,
  log: ProxyLogger,
  outcome: ProxyOutcome
): Promise<string> {
  const label = tag(imageUrl);

  if (isAlreadyProxied(imageUrl)) {
    log("info", `[ImageProxy] ✅ Already proxied, skip: ${label}`);
    return imageUrl;
  }

  let supabase: ReturnType<typeof createClient>;
  try {
    supabase = getSupabaseClient();
  } catch (err: any) {
    log("error", `[ImageProxy] ❌ Cannot create Supabase client: ${err.message}`);
    outcome.stage = "init";
    outcome.reason = err.message;
    return imageUrl;
  }

  try {
    // ── 1. HEAD check ──────────────────────────────────────────────────────
    let headSize: number | null = null;
    try {
      const head = await fetch(imageUrl, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
      const cl = head.headers.get("content-length");
      headSize = cl ? parseInt(cl, 10) : null;
      const headType = head.headers.get("content-type") || "unknown";
      log("info", `[ImageProxy] HEAD ${label} → HTTP ${head.status}, content-length=${headSize ?? "unknown"} bytes, content-type=${headType}`);
      if (!head.ok) {
        log("warn", `[ImageProxy] ⚠️  HEAD failed HTTP ${head.status} for ${label} — proceeding to GET anyway`);
      }
    } catch (headErr: any) {
      log("warn", `[ImageProxy] ⚠️  HEAD request failed for ${label}: ${headErr.message} — proceeding to GET`);
    }

    // ── 2. Download ────────────────────────────────────────────────────────
    log("info", `[ImageProxy] GET ${imageUrl}`);
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      log("error", `[ImageProxy] ❌ GET failed HTTP ${res.status} for ${label} — keeping original URL`);
      outcome.stage = "get";
      outcome.reason = `HTTP ${res.status}`;
      return imageUrl;
    }

    const serverContentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    const actualSizeKB = Math.round(buf.length / 1024);

    // If server returns a generic/missing type, infer from URL extension
    const urlInferredMime = inferMimeFromUrl(imageUrl);
    const rawContentType = (
      serverContentType &&
      serverContentType !== "application/octet-stream" &&
      serverContentType !== "binary/octet-stream"
    )
      ? serverContentType
      : (urlInferredMime ?? serverContentType ?? "application/octet-stream");

    log("info",
      `[ImageProxy] Downloaded ${label}: ${actualSizeKB}KB (${buf.length} bytes), ` +
      `server-content-type=${serverContentType || "none"}, resolved-type=${rawContentType}`
    );

    if (buf.length > WARN_BYTES) {
      log("warn", `[ImageProxy] ⚠️  Large image: ${label} = ${actualSizeKB}KB (${buf.length} bytes) — threshold is ${WARN_BYTES} bytes`);
    }

    // ── 3. Route: optimize or store as-is ─────────────────────────────────
    const inCompressFormats = COMPRESS_FORMATS.has(rawContentType);
    const exceedsThreshold  = buf.length > OPTIMIZE_BYTES;
    const shouldOptimize    = exceedsThreshold && inCompressFormats;

    log("info",
      `[ImageProxy] Decision for ${label}: ` +
      `size=${actualSizeKB}KB, threshold=${Math.round(OPTIMIZE_BYTES / 1024)}KB, ` +
      `exceedsThreshold=${exceedsThreshold}, inCompressFormats=${inCompressFormats}, ` +
      `shouldOptimize=${shouldOptimize}`
    );

    if (shouldOptimize) {
      log("info", `[ImageProxy] → Running Sharp optimization on ${label} (${actualSizeKB}KB, ${rawContentType})...`);
      return await optimizeAndStore(supabase, buf, imageUrl, rawContentType, log, outcome);
    } else {
      const reason = !inCompressFormats
        ? `non-compressible format (${rawContentType}) — URL-inferred=${urlInferredMime ?? "none"}`
        : `within size limit (${actualSizeKB}KB ≤ ${Math.round(OPTIMIZE_BYTES / 1024)}KB)`;
      log("info", `[ImageProxy] → Storing as-is: ${reason}`);
      return await storeOriginal(supabase, buf, imageUrl, rawContentType, log, outcome);
    }

  } catch (err: any) {
    log("error", `[ImageProxy] ❌ Unexpected error for ${label}: ${err.message}`);
    if (err.stack) log("error", `[ImageProxy] stack: ${err.stack}`);
    outcome.stage = "unexpected";
    outcome.reason = err.message;
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
  contentType: string,
  log: ProxyLogger,
  outcome: ProxyOutcome
): Promise<string> {
  const label = tag(sourceUrl);
  const ext   = MIME_TO_EXT[contentType] ?? "bin";
  const hash  = crypto.createHash("sha256").update(buf).digest("hex");
  const path  = `hashed/${hash}.${ext}`;

  log("info", `[ImageProxy] Checking dedup for ${label} → path=${path}`);

  const { data: existing, error: listErr } = await supabase.storage.from(BUCKET).list("hashed", {
    search: `${hash}.${ext}`,
    limit: 1,
  });

  if (listErr) {
    log("error", `[ImageProxy] ❌ Storage list error: ${listErr.message}`);
  }

  if (existing && existing.length > 0) {
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    log("success", `[ImageProxy] ✅ Cache hit (original): ${label} → ${urlData.publicUrl}`);
    return urlData.publicUrl;
  }

  log("info", `[ImageProxy] Uploading ${label} (${Math.round(buf.length / 1024)}KB) to ${path}...`);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, { contentType, upsert: false });

  if (error) {
    if (error.message === "The resource already exists") {
      // Lost the race — that's fine, just return the URL
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      log("success", `[ImageProxy] ✅ Race-condition dedup: ${label} → ${urlData.publicUrl}`);
      return urlData.publicUrl;
    }
    log("error", `[ImageProxy] ❌ Upload failed for ${label}: ${error.message} (status: ${(error as any).statusCode ?? "?"})`);
    outcome.stage = "upload-original";
    outcome.reason = `${error.message} (status: ${(error as any).statusCode ?? "?"})`;
    return sourceUrl;
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  log("success", `[ImageProxy] ✅ Stored original: ${label} → ${urlData.publicUrl}`);
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
  originalContentType: string,
  log: ProxyLogger,
  outcome: ProxyOutcome
): Promise<string> {
  const label = tag(sourceUrl);
  const configSuffix = `w${TARGET_WIDTH}q${JPEG_QUALITY}`;
  const cacheKey = crypto.createHash("sha256").update(sourceUrl + configSuffix).digest("hex");
  const path = `optimized/${cacheKey}.jpg`;

  log("info", `[ImageProxy] Checking optimized cache for ${label} → ${path}`);

  const { data: existing, error: listErr } = await supabase.storage.from(BUCKET).list("optimized", {
    search: `${cacheKey}.jpg`,
    limit: 1,
  });

  if (listErr) {
    log("error", `[ImageProxy] ❌ Storage list error for optimized: ${listErr.message}`);
  }

  if (existing && existing.length > 0) {
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    log("success", `[ImageProxy] ✅ Cache hit (optimized): ${label} → ${urlData.publicUrl}`);
    return urlData.publicUrl;
  }

  // Run Sharp
  log("info", `[ImageProxy] Running Sharp on ${label} (${Math.round(buf.length / 1024)}KB, ${originalContentType})...`);
  let meta: sharp.Metadata;
  let optimizedBuf: Buffer;

  try {
    const image = sharp(buf);
    meta = await image.metadata();
    log("info", `[ImageProxy] Sharp metadata: ${meta.width}×${meta.height}, format=${meta.format}`);

    optimizedBuf = await image
      .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    // Sanity check: if the output is suspiciously small, retry at higher quality
    if (optimizedBuf.length < MIN_OUTPUT_BYTES) {
      log("warn",
        `[ImageProxy] ⚠️  Output suspiciously small: ${Math.round(optimizedBuf.length / 1024)}KB ` +
        `(< ${Math.round(MIN_OUTPUT_BYTES / 1024)}KB threshold). ` +
        `Retrying at quality=${JPEG_QUALITY_FALLBACK}...`
      );
      optimizedBuf = await sharp(buf)
        .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY_FALLBACK, mozjpeg: true })
        .toBuffer();
      log("info", `[ImageProxy] Retry output: ${Math.round(optimizedBuf.length / 1024)}KB`);
    }

    const outMeta = await sharp(optimizedBuf).metadata();
    log("info",
      `[ImageProxy] Sharp output: ${outMeta.width}×${outMeta.height} JPEG, ` +
      `${Math.round(buf.length / 1024)}KB → ${Math.round(optimizedBuf.length / 1024)}KB ` +
      `(${Math.round((1 - optimizedBuf.length / buf.length) * 100)}% savings)`
    );
  } catch (sharpErr: any) {
    log("error", `[ImageProxy] ❌ Sharp failed for ${label}: ${sharpErr.message}`);
    if (sharpErr.stack) log("error", `[ImageProxy] Sharp stack: ${sharpErr.stack}`);
    // Return original URL — do NOT fall back to storeOriginal().
    // Storing in hashed/ would poison the cache: isAlreadyProxied would
    // permanently skip this image on all future sends.
    log("warn", `[ImageProxy] ⚠️  Returning original URL to allow retry on next send.`);
    outcome.stage = "sharp";
    outcome.reason = sharpErr.message;
    return sourceUrl;
  }

  log("info", `[ImageProxy] Uploading optimized ${label} (${Math.round(optimizedBuf.length / 1024)}KB) to ${path}...`);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, optimizedBuf, { contentType: "image/jpeg", upsert: false });

  if (error) {
    if (error.message === "The resource already exists") {
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      log("success", `[ImageProxy] ✅ Race-condition dedup (optimized): ${label} → ${urlData.publicUrl}`);
      return urlData.publicUrl;
    }
    log("error", `[ImageProxy] ❌ Optimized upload failed for ${label}: ${error.message} (status: ${(error as any).statusCode ?? "?"})`);
    // Return original URL — do NOT fall back to storeOriginal().
    // A failed upload must not be cached into hashed/ or it poisons future sends.
    log("warn", `[ImageProxy] ⚠️  Returning original URL to allow retry on next send.`);
    outcome.stage = "upload-optimized";
    outcome.reason = `${error.message} (status: ${(error as any).statusCode ?? "?"})`;
    return sourceUrl;
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  log("success", `[ImageProxy] ✅ Stored optimized: ${label} → ${urlData.publicUrl}`);
  return urlData.publicUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry: scan HTML and proxy/optimize all external images
// ─────────────────────────────────────────────────────────────────────────────

export async function proxyEmailImages(
  html: string,
  logger?: ProxyLogger
): Promise<{ html: string; stats: ProxyStats }> {
  const log = logger ?? defaultLogger;
  const stats: ProxyStats = {
    scanned: 0,
    alreadyProxied: 0,
    proxied: 0,
    unchanged: 0,
    failures: [],
  };

  if (!html) return { html, stats };

  // Collect all external HTTP image URLs from:
  //   1. src="..." attributes  (standard <img> tags)
  //   2. url(...)  in inline style attributes (background-image, etc.)
  const allUrls      = new Set<string>();
  const alreadyProxied = new Set<string>();

  // Pattern 1: src attributes (with or without quotes)
  const srcRegex = /src=["']?(https?:\/\/[^"'\s>]+)["']?/gi;
  let m: RegExpExecArray | null;
  while ((m = srcRegex.exec(html)) !== null) {
    // strip any trailing quote/whitespace/> that got captured
    const url = m[1].replace(/["'>\s].*$/, "");
    if (!url.startsWith("http")) continue;
    if (isAlreadyProxied(url)) {
      alreadyProxied.add(url);
    } else {
      allUrls.add(url);
    }
  }

  // Pattern 2: url() in style attributes (background-image, etc.)
  const urlFnRegex = /url\(["']?(https?:\/\/[^"'\s)]+)["']?\)/gi;
  while ((m = urlFnRegex.exec(html)) !== null) {
    const url = m[1].replace(/["')\s].*$/, "");
    if (!url.startsWith("http")) continue;
    if (isAlreadyProxied(url)) {
      alreadyProxied.add(url);
    } else {
      allUrls.add(url);
    }
  }

  stats.scanned = allUrls.size + alreadyProxied.size;
  stats.alreadyProxied = alreadyProxied.size;

  log("info",
    `[ImageProxy] Scan complete: ${allUrls.size} to-proxy, ` +
    `${alreadyProxied.size} already-proxied/hashed (skipped). ` +
    `Total unique found: ${stats.scanned}`
  );

  if (alreadyProxied.size > 0) {
    Array.from(alreadyProxied).forEach((u, i) =>
      log("info", `[ImageProxy]   [SKIP ${i + 1}] Already proxied: ${tag(u)}`)
    );
  }

  if (allUrls.size === 0) {
    log("info", "[ImageProxy] Nothing to proxy — all images already optimized or none present.");
    return { html, stats };
  }

  log("info", `[ImageProxy] ═══ Starting proxy for ${allUrls.size} unique external URL(s) ═══`);
  Array.from(allUrls).forEach((u, i) => log("info", `[ImageProxy]   [${i + 1}] ${u}`));

  // Proxy all unique URLs in parallel
  const urlMap = new Map<string, string>();
  const outcomeMap = new Map<string, ProxyOutcome>();
  await Promise.all(
    Array.from(allUrls).map(async (url) => {
      const outcome: ProxyOutcome = {};
      outcomeMap.set(url, outcome);
      const proxied = await proxyImage(url, log, outcome);
      urlMap.set(url, proxied);
    })
  );

  // Summary
  log("info", `[ImageProxy] ═══ Proxy results ═══`);
  for (const [original, proxied] of urlMap) {
    const changed = original !== proxied;
    if (changed) {
      stats.proxied++;
      log("success", `[ImageProxy]   ✅ PROXIED: ${tag(original)} → ${proxied}`);
    } else {
      stats.unchanged++;
      const outcome = outcomeMap.get(original);
      const reason = outcome?.reason ?? "unknown";
      const stage = outcome?.stage ?? "unknown";
      stats.failures.push({ url: original, stage, reason });
      log("warn", `[ImageProxy]   ⚠️  UNCHANGED (original URL kept): ${tag(original)} — stage=${stage}, reason=${reason}`);
    }
  }

  // Replace all occurrences in the HTML
  let rewritten = html;
  for (const [original, proxied] of urlMap) {
    if (original !== proxied) {
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      rewritten = rewritten.replace(new RegExp(escaped, "g"), proxied);
    }
  }

  log("info", `[ImageProxy] ═══ Done: ${stats.proxied}/${allUrls.size} proxied, ${stats.unchanged} failed ═══`);

  return { html: rewritten, stats };
}
