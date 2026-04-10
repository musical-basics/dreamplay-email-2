/**
 * image-proxy.ts
 *
 * Scans email HTML for external <img src="..."> URLs and replaces them with
 * permanent Supabase-hosted copies. Uses SHA-256 content hashing so the same
 * image is never stored twice regardless of how many campaigns reference it.
 *
 * Bucket : email-images   (public read, service-role write)
 * Path   : hashed/{sha256}.{ext}
 *
 * Safe to call multiple times — idempotent by design:
 *   - Already-proxied Supabase URLs are left untouched.
 *   - Images >MAX_BYTES are skipped (too large to embed safely in email).
 *   - Unknown content-types fall back to ".bin".
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;
const BUCKET       = "email-images";

/**
 * Max image size we'll store. Gmail clips messages over ~102KB and email
 * clients generally refuse to render images >5MB. We skip anything over
 * 5MB and log a warning so the team knows to resize the source asset.
 */
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Extension lookup for common MIME types
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

/**
 * Returns true for URLs that are already hosted in our Supabase project.
 * These never need proxying.
 */
function isAlreadyProxied(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    // Supabase storage URLs always contain the project ref subdomain
    return hostname.includes(".supabase.co") || hostname.includes(".supabase.in");
  } catch {
    return false;
  }
}

/**
 * Download, hash, and store one image.
 * Returns the permanent Supabase public URL, or the original URL on failure
 * (so sends are never blocked by a proxy error).
 */
export async function proxyImage(imageUrl: string): Promise<string> {
  if (isAlreadyProxied(imageUrl)) return imageUrl;

  const supabase = getSupabaseClient();

  try {
    // ── Step 1: HEAD check to detect oversized images before downloading ──
    // This avoids wasting bandwidth downloading a 7MB PNG only to reject it.
    try {
      const head = await fetch(imageUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(5_000),
      });
      if (head.ok) {
        const contentLength = head.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > MAX_BYTES) {
          console.warn(
            `[ImageProxy] SKIPPED (${Math.round(parseInt(contentLength) / 1024 / 1024)}MB > 5MB limit): ${imageUrl}`
          );
          console.warn(
            `[ImageProxy] ⚠️  ACTION REQUIRED: The source asset at ${imageUrl} is too large for email. Please re-export at ≤1920px width and <2MB.`
          );
          return imageUrl; // fall back to original — image will only load if R2 is public
        }
      }
    } catch {
      // HEAD failed (CORS, etc.) — proceed to full download anyway
    }

    // ── Step 2: Download ──
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.warn(`[ImageProxy] Failed to fetch ${imageUrl} — ${res.status}, keeping original`);
      return imageUrl;
    }

    const contentType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    const ext  = MIME_TO_EXT[contentType] ?? "bin";
    const buf  = Buffer.from(await res.arrayBuffer());

    // ── Step 3: Size gate (in case HEAD wasn't available) ──
    if (buf.length > MAX_BYTES) {
      console.warn(
        `[ImageProxy] SKIPPED after download (${Math.round(buf.length / 1024 / 1024)}MB > 5MB): ${imageUrl}`
      );
      console.warn(
        `[ImageProxy] ⚠️  ACTION REQUIRED: ${imageUrl} — re-export at ≤1920px width and <2MB before next send.`
      );
      return imageUrl;
    }

    // ── Step 4: Hash (deduplication key) ──
    const hash     = crypto.createHash("sha256").update(buf).digest("hex");
    const path     = `hashed/${hash}.${ext}`;

    // ── Step 5: Check if already stored ──
    const { data: existing } = await supabase.storage.from(BUCKET).list("hashed", {
      search: `${hash}.${ext}`,
      limit: 1,
    });

    if (existing && existing.length > 0) {
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      console.log(`[ImageProxy] Cache hit: ${hash}.${ext}`);
      return urlData.publicUrl;
    }

    // ── Step 6: Upload ──
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buf, { contentType, upsert: false });

    if (uploadErr && uploadErr.message !== "The resource already exists") {
      console.error(`[ImageProxy] Upload failed for ${imageUrl}:`, uploadErr.message);
      return imageUrl;
    }

    // ── Step 7: Return permanent public URL ──
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    console.log(`[ImageProxy] Stored ${Math.round(buf.length / 1024)}KB: ${hash}.${ext} (was: ${imageUrl})`);
    return urlData.publicUrl;

  } catch (err: any) {
    console.error(`[ImageProxy] Unexpected error for ${imageUrl}:`, err.message);
    return imageUrl; // fail open — never block a send
  }
}

/**
 * Scan an email HTML string, find all external <img src="..."> URLs,
 * proxy each one, and return the rewritten HTML.
 *
 * - Skips data: URIs and already-proxied Supabase URLs.
 * - Deduplicates: if the same URL appears multiple times, only one fetch/upload happens.
 * - Never throws: returns original HTML on any unexpected error.
 */
export async function proxyEmailImages(html: string): Promise<string> {
  if (!html) return html;

  // Extract all unique external image src values
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

  console.log(`[ImageProxy] Proxying ${externalUrls.size} unique external image(s)...`);

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
      // Escape special regex chars in the original URL
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      rewritten = rewritten.replace(new RegExp(escaped, "g"), proxied);
    }
  }

  const replacedCount = Array.from(urlMap.values()).filter((v, i) => v !== Array.from(urlMap.keys())[i]).length;
  console.log(`[ImageProxy] Done. ${replacedCount}/${externalUrls.size} images proxied.`);

  return rewritten;
}
