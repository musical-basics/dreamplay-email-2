import sharp from "sharp";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

const VIDEO_DOMAINS = ["youtube.com", "youtu.be", "vimeo.com"];

// Cache to avoid re-compositing the same thumbnail within one send batch
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
 * upload the result to Supabase, and return the public URL.
 */
export async function compositePlayButton(thumbnailUrl: string): Promise<string> {
    // Check cache first
    if (compositeCache.has(thumbnailUrl)) {
        return compositeCache.get(thumbnailUrl)!;
    }

    // 1. Fetch the thumbnail
    const response = await fetch(thumbnailUrl);
    if (!response.ok) {
        console.error(`Failed to fetch thumbnail: ${thumbnailUrl} (${response.status})`);
        return thumbnailUrl; // Return original on failure
    }
    const thumbnailBuffer = Buffer.from(await response.arrayBuffer());

    // 2. Load the play button PNG
    const playButtonPath = path.join(process.cwd(), "public", "YT Play Button copy Medium.png");
    const playButton = sharp(playButtonPath);

    // 3. Get thumbnail dimensions
    const thumbnailImage = sharp(thumbnailBuffer);
    const metadata = await thumbnailImage.metadata();
    const thumbWidth = metadata.width || 600;
    const thumbHeight = metadata.height || 338;

    // 4. Resize play button to ~20% of thumbnail width
    const playSize = Math.round(thumbWidth * 0.2);
    const resizedPlayButton = await playButton
        .resize(playSize, playSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer();

    // 5. Get actual play button dimensions after resize
    const playMeta = await sharp(resizedPlayButton).metadata();
    const playW = playMeta.width || playSize;
    const playH = playMeta.height || playSize;

    // 6. Composite: center the play button on the thumbnail
    const composited = await thumbnailImage
        .composite([
            {
                input: resizedPlayButton,
                left: Math.round((thumbWidth - playW) / 2),
                top: Math.round((thumbHeight - playH) / 2),
            },
        ])
        .png()
        .toBuffer();

    // 7. Upload to Supabase Storage
    const filename = `video-thumb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const storagePath = `video-thumbnails/${filename}`;

    const { error } = await supabase.storage
        .from("chat-assets")
        .upload(storagePath, composited, {
            contentType: "image/png",
            upsert: false,
        });

    if (error) {
        console.error("Failed to upload composited thumbnail:", error);
        return thumbnailUrl; // Return original on failure
    }

    const { data: publicUrlData } = supabase.storage
        .from("chat-assets")
        .getPublicUrl(storagePath);

    const resultUrl = publicUrlData.publicUrl;
    compositeCache.set(thumbnailUrl, resultUrl);
    return resultUrl;
}

/**
 * Process HTML to find images that link to video URLs,
 * composite play buttons onto them, and return the updated HTML.
 */
export async function addPlayButtonsToVideoThumbnails(html: string): Promise<string> {
    // Match: <a href="VIDEO_URL"...><img src="THUMB_URL"...</a>
    // This regex finds <a> tags containing <img> tags
    const linkImagePattern = /<a\s[^>]*href=["']([^"']+)["'][^>]*>(\s*(?:<[^>]*>\s*)*<img\s[^>]*src=["']([^"']+)["'][^>]*>(?:\s*<[^>]*>)*\s*)<\/a>/gi;

    const matches: Array<{ full: string; linkUrl: string; imgSrc: string }> = [];
    let match;

    while ((match = linkImagePattern.exec(html)) !== null) {
        const linkUrl = match[1];
        const imgSrc = match[3];
        if (isVideoUrl(linkUrl) && imgSrc && !imgSrc.includes("video-thumbnails/")) {
            matches.push({ full: match[0], linkUrl, imgSrc });
        }
    }

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
