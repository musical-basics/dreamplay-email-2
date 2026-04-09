/**
 * Client-side image compression using Canvas API.
 * Compresses images that exceed a target size by reducing quality and dimensions.
 * No external dependencies — pure browser Canvas + Blob API.
 */

const MAX_DIMENSION = 1200 // Max width/height in pixels
const INITIAL_QUALITY = 0.8
const QUALITY_STEP = 0.1
const MIN_QUALITY = 0.1

/**
 * Compress a single image file if it exceeds the target size.
 * @param file - The image File to compress
 * @param maxSizeBytes - Maximum file size in bytes (default: 300KB)
 * @returns A compressed File (or the original if already under the limit)
 */
export async function compressImage(
    file: File,
    maxSizeBytes: number = 300 * 1024
): Promise<{ file: File; wasCompressed: boolean; originalSize: number }> {
    const originalSize = file.size

    // Skip if already under the limit
    if (file.size <= maxSizeBytes) {
        return { file, wasCompressed: false, originalSize }
    }

    // Skip non-image files or SVGs (can't canvas-compress SVGs)
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
        return { file, wasCompressed: false, originalSize }
    }

    // Load image into an HTMLImageElement
    const img = await loadImage(file)

    // Calculate scaled dimensions (maintain aspect ratio)
    let { width, height } = img
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
    }

    // Try progressively lower quality until under target size
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(img, 0, 0, width, height)

    // Determine output format — use JPEG for best compression (unless PNG with transparency needed)
    const outputType = file.type === "image/png" ? "image/png" : "image/jpeg"

    let quality = INITIAL_QUALITY
    let blob: Blob | null = null

    while (quality >= MIN_QUALITY) {
        blob = await canvasToBlob(canvas, outputType, quality)
        if (blob && blob.size <= maxSizeBytes) {
            break
        }
        quality -= QUALITY_STEP
    }

    // If PNG is still too large, try converting to JPEG (lossy but much smaller)
    if (blob && blob.size > maxSizeBytes && outputType === "image/png") {
        quality = INITIAL_QUALITY
        while (quality >= MIN_QUALITY) {
            blob = await canvasToBlob(canvas, "image/jpeg", quality)
            if (blob && blob.size <= maxSizeBytes) {
                break
            }
            quality -= QUALITY_STEP
        }
    }

    // If still too large after all attempts, use the smallest we got
    if (!blob) {
        return { file, wasCompressed: false, originalSize }
    }

    // Determine the output filename extension
    const ext = blob.type === "image/jpeg" ? ".jpg" : ".png"
    const baseName = file.name.replace(/\.[^.]+$/, "")
    const outputName = file.name.endsWith(ext) ? file.name : `${baseName}${ext}`

    const compressedFile = new File([blob], outputName, {
        type: blob.type,
        lastModified: Date.now(),
    })

    return {
        file: compressedFile,
        wasCompressed: true,
        originalSize,
    }
}

/**
 * Compress multiple image files, returning compressed versions.
 * @param files - Array of File objects
 * @param maxSizeBytes - Maximum file size in bytes (default: 300KB)
 * @param onProgress - Optional callback for progress updates (index, total, filename)
 */
export async function compressImages(
    files: File[],
    maxSizeBytes: number = 300 * 1024,
    onProgress?: (index: number, total: number, filename: string) => void
): Promise<{ files: File[]; stats: CompressionStats }> {
    const results: File[] = []
    const stats: CompressionStats = {
        totalFiles: files.length,
        compressedCount: 0,
        originalTotalBytes: 0,
        compressedTotalBytes: 0,
    }

    for (let i = 0; i < files.length; i++) {
        const file = files[i]
        onProgress?.(i, files.length, file.name)

        const result = await compressImage(file, maxSizeBytes)
        results.push(result.file)
        stats.originalTotalBytes += result.originalSize
        stats.compressedTotalBytes += result.file.size

        if (result.wasCompressed) {
            stats.compressedCount++
        }
    }

    return { files: results, stats }
}

export interface CompressionStats {
    totalFiles: number
    compressedCount: number
    originalTotalBytes: number
    compressedTotalBytes: number
}

// ─── Helpers ────────────────────────────────────────────────

function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
            URL.revokeObjectURL(img.src)
            resolve(img)
        }
        img.onerror = () => {
            URL.revokeObjectURL(img.src)
            reject(new Error(`Failed to load image: ${file.name}`))
        }
        img.src = URL.createObjectURL(file)
    })
}

function canvasToBlob(
    canvas: HTMLCanvasElement,
    type: string,
    quality: number
): Promise<Blob | null> {
    return new Promise((resolve) => {
        canvas.toBlob(
            (blob) => resolve(blob),
            type,
            quality
        )
    })
}
