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

// In-process cache to avoid re-compositing within one send batch (keyed by YouTube URL)
const compositeCache = new Map<string, string>();

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
 * Cache key = SHA-256(thumbnailUrl) so the same YouTube thumbnail
 * always maps to the same Supabase path — no re-processing on repeat sends.
 */
export async function compositePlayButton(thumbnailUrl: string): Promise<string> {
    // 1. In-process cache (within this server invocation)
    if (compositeCache.has(thumbnailUrl)) {
        console.log(`[VideoOverlay] In-process cache hit: ${thumbnailUrl}`);
        return compositeCache.get(thumbnailUrl)!;
    }

    // 2. Content-addressed storage key (SHA-256 of the YouTube URL)
    const hash = crypto.createHash("sha256").update(thumbnailUrl).digest("hex");
    const storagePath = `${PREFIX}/${hash}.jpg`;

    // 3. Check if already processed and stored in Supabase
    const { data: existing } = await supabase.storage
        .from(BUCKET)
        .list(PREFIX, { search: `${hash}.jpg`, limit: 1 });

    if (existing && existing.length > 0) {
        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
        console.log(`[VideoOverlay] Supabase cache hit: ${thumbnailUrl} → ${urlData.publicUrl}`);
        compositeCache.set(thumbnailUrl, urlData.publicUrl);
        return urlData.publicUrl;
    }

    // 4. Fetch the thumbnail from YouTube (or wherever)
    console.log(`[VideoOverlay] Fetching thumbnail: ${thumbnailUrl}`);
    const response = await fetch(thumbnailUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
        console.error(`[VideoOverlay] Failed to fetch thumbnail: ${thumbnailUrl} (HTTP ${response.status})`);
        return thumbnailUrl; // Return original on failure
    }
    const thumbnailBuffer = Buffer.from(await response.arrayBuffer());

    // 5. Load the play button PNG asset
    const playButtonPath = path.join(process.cwd(), "public", "YT Play Button copy Medium.png");
    const playButton = sharp(playButtonPath);

    // 6. Get thumbnail dimensions
    const thumbnailImage = sharp(thumbnailBuffer);
    const metadata = await thumbnailImage.metadata();
    const thumbWidth = metadata.width || 600;
    const thumbHeight = metadata.height || 338;

    // 7. Resize play button to ~20% of thumbnail width
    const playSize = Math.round(thumbWidth * 0.2);
    const resizedPlayButton = await playButton
        .resize(playSize, playSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer();

    // 8. Get actual play button dimensions after resize
    const playMeta = await sharp(resizedPlayButton).metadata();
    const playW = playMeta.width || playSize;
    const playH = playMeta.height || playSize;

    // 9. Composite + output as JPEG (was PNG — much smaller, email-safe)
    const composited = await thumbnailImage
        .composite([
            {
                input: resizedPlayButton,
                left: Math.round((thumbWidth - playW) / 2),
                top: Math.round((thumbHeight - playH) / 2),
            },
        ])
        .jpeg({ quality: 85, mozjpeg: true })  // JPEG not PNG — ~10x smaller
        .toBuffer();

    const outputKB = Math.round(composited.length / 1024);
    console.log(`[VideoOverlay] Composited JPEG: ${thumbWidth}×${thumbHeight}, ${outputKB}KB → uploading to ${storagePath}`);

    // 10. Upload to email-images bucket (same as image-proxy — recognized by isAlreadyProxied)
    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, composited, {
            contentType: "image/jpeg",
            upsert: false,
        });

    if (error && error.message !== "The resource already exists") {
        console.error("[VideoOverlay] Failed to upload composited thumbnail:", error);
        return thumbnailUrl; // Return original on failure
    }

    const { data: publicUrlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(storagePath);

    const resultUrl = publicUrlData.publicUrl;
    console.log(`[VideoOverlay] ✅ Stored: ${resultUrl} (${outputKB}KB JPEG)`);
    compositeCache.set(thumbnailUrl, resultUrl);
    return resultUrl;
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
