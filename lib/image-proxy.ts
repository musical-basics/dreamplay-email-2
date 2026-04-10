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
 *   - Unknown content-types fall back to ".bin".
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;
const BUCKET       = "email-images";

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
    // 1. Download
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[ImageProxy] Failed to fetch ${imageUrl} — ${res.status}, keeping original`);
      return imageUrl;
    }

    const contentType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    const ext  = MIME_TO_EXT[contentType] ?? "bin";
    const buf  = Buffer.from(await res.arrayBuffer());

    // 2. Hash
    const hash     = crypto.createHash("sha256").update(buf).digest("hex");
    const path     = `hashed/${hash}.${ext}`;

    // 3. Check if already stored (deduplication)
    const { data: existing } = await supabase.storage.from(BUCKET).list("hashed", {
      search: `${hash}.${ext}`,
      limit: 1,
    });

    if (existing && existing.length > 0) {
      // Already exists — just return the public URL
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      console.log(`[ImageProxy] Cache hit: ${hash}.${ext}`);
      return urlData.publicUrl;
    }

    // 4. Upload (upsert: false — hash guarantees content identity)
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buf, { contentType, upsert: false });

    if (uploadErr && uploadErr.message !== "The resource already exists") {
      console.error(`[ImageProxy] Upload failed for ${imageUrl}:`, uploadErr.message);
      return imageUrl;
    }

    // 5. Return permanent public URL
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    console.log(`[ImageProxy] Stored new image: ${hash}.${ext} (was: ${imageUrl})`);
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
  const srcRegex = /src=["'](https?:\/\/[^"']+)["']/gi;
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
