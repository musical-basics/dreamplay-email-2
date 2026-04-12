import sharp from "sharp";
import path from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

const VIDEO_DOMAINS = ["youtube.com", "youtu.be", "vimeo.com"];

// Bucket for video thumbnails — same as image-proxy so isAlreadyProxied recognizes them
const BUCKET = "email-images";
const PREFIX = "video-thumbnails";

// In-process cache stores the Promise (not the resolved value) so that
// parallel calls for the same URL share the same in-flight request —
// preventing duplicate downloads/composites if the same image appears twice.
const compositeCache = new Map<string, Promise<string>>();

/**
 * Check if a URL points to a video site.
 */
export function isVideoUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return VIDEO_DOMAINS.some(
            (d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`)
        );
    } catch {
        return false;
    }
}

/**
 * Fetch a thumbnail image, composite the play button on top,
 * and store the result as a content-addressed JPEG in Supabase.
 *
 * Cache key = SHA-256(thumbnailUrl) so the same image URL
 * always maps to the same Supabase path — no re-processing on repeat sends.
 *
 * Caches the Promise (not the result) so parallel callers share the same
 * in-flight request rather than starting duplicate downloads.
 */
export function compositePlayButton(thumbnailUrl: string): Promise<string> {
    // Return existing Promise immediately — prevents parallel race conditions
    if (compositeCache.has(thumbnailUrl)) {
        console.log(`[VideoOverlay] In-process cache hit: ${thumbnailUrl}`);
        return compositeCache.get(thumbnailUrl)!;
    }

    const promise = (async () => {
        // 1. Content-addressed storage key (SHA-256 of the image URL)
        const hash = crypto.createHash("sha256").update(thumbnailUrl).digest("hex");
        const storagePath = `${PREFIX}/${hash}.jpg`;

        // 2. Check if already processed and stored in Supabase
        const { data: existing } = await supabase.storage
            .from(BUCKET)
            .list(PREFIX, { search: `${hash}.jpg`, limit: 1 });

        if (existing && existing.length > 0) {
            const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
            console.log(`[VideoOverlay] Supabase cache hit: ${thumbnailUrl} → ${urlData.publicUrl}`);
            return urlData.publicUrl;
        }

        // 3. Fetch the image
        console.log(`[VideoOverlay] Fetching image: ${thumbnailUrl}`);
        const response = await fetch(thumbnailUrl, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) {
            console.error(`[VideoOverlay] Failed to fetch image: ${thumbnailUrl} (HTTP ${response.status})`);
            return thumbnailUrl;
        }
        const thumbnailBuffer = Buffer.from(await response.arrayBuffer());

        // 4. Load the play button PNG asset
        const playButtonPath = path.join(process.cwd(), "public", "YT Play Button copy Medium.png");

        // 5. Get image dimensions
        const thumbnailImage = sharp(thumbnailBuffer);
        const metadata = await thumbnailImage.metadata();
        const thumbWidth = metadata.width || 600;
        const thumbHeight = metadata.height || 338;

        // 6. Resize play button to ~20% of thumbnail width
        const playSize = Math.round(thumbWidth * 0.2);
        const resizedPlayButton = await sharp(playButtonPath)
            .resize(playSize, playSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .toBuffer();

        const playMeta = await sharp(resizedPlayButton).metadata();
        const playW = playMeta.width || playSize;
        const playH = playMeta.height || playSize;

        // 7. Composite + output as JPEG (not PNG — ~10x smaller)
        const composited = await thumbnailImage
            .composite([{
                input: resizedPlayButton,
                left: Math.round((thumbWidth - playW) / 2),
                top: Math.round((thumbHeight - playH) / 2),
            }])
            .jpeg({ quality: 82, mozjpeg: true })
            .toBuffer();

        const outputKB = Math.round(composited.length / 1024);
        console.log(`[VideoOverlay] Composited JPEG: ${thumbWidth}×${thumbHeight}, ${outputKB}KB → uploading to ${storagePath}`);

        // 8. Upload to email-images bucket (same as image-proxy — isAlreadyProxied recognizes it)
        const { error } = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, composited, { contentType: "image/jpeg", upsert: false });

        if (error && error.message !== "The resource already exists") {
            console.error("[VideoOverlay] Failed to upload composited thumbnail:", error);
            return thumbnailUrl;
        }

        const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
        console.log(`[VideoOverlay] ✅ Stored: ${publicUrlData.publicUrl} (${outputKB}KB JPEG)`);
        return publicUrlData.publicUrl;
    })();

    // Store the Promise immediately so parallel callers share it
    compositeCache.set(thumbnailUrl, promise);
    // Evict on failure so future sends can safely retry
    promise.catch(() => compositeCache.delete(thumbnailUrl));

    return promise;
}


/**
 * Process HTML to find images that link to video URLs,
 * composite play buttons onto them, and return the updated HTML.
 */
export async function addPlayButtonsToVideoThumbnails(html: string): Promise<string> {
    // Match: <a href="VIDEO_URL"...><img src="THUMB_URL"...</a>
    const linkImagePattern = /<a\s[^>]*href=["']([^"']+)["'][^>]*>(\s*(?:<[^>]*>\s*)*<img\s[^>]*src=["']([^"']+)["'][^>]*>(?:\s*<[^>]*>)*\s*)<\/a>/gi;

    const matches: Array<{ full: string; linkUrl: string; imgSrc: string }> = [];
    let match;

    while ((match = linkImagePattern.exec(html)) !== null) {
        const linkUrl = match[1];
        const imgSrc = match[3];
        // Skip if already processed (stored in our email-images/video-thumbnails/ path)
        if (isVideoUrl(linkUrl) && imgSrc && !imgSrc.includes(`${BUCKET}/${PREFIX}/`)) {
            matches.push({ full: match[0], linkUrl, imgSrc });
        }
    }

    if (matches.length === 0) return html;

    console.log(`[VideoOverlay] Found ${matches.length} video thumbnail(s) to composite`);

    // Process all video thumbnails in parallel
    const replacements = await Promise.all(
        matches.map(async (m) => {
            const newSrc = await compositePlayButton(m.imgSrc);
            return { original: m.imgSrc, replacement: newSrc };
        })
    );

    // Apply replacements
    let result = html;
    for (const { original, replacement } of replacements) {
        if (original !== replacement) {
            result = result.split(original).join(replacement);
        }
    }

    return result;
}
