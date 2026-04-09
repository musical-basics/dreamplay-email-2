"use server"

import { createHash } from "crypto"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient } from "@supabase/supabase-js"
import * as cheerio from "cheerio"
import sharp from "sharp"
import { convertMailchimpToEmail, AssetMapping } from "@/lib/ai/email-generator"
import { parseMailchimpHtml, generateContentSummary } from "@/lib/parsers/mailchimp-parser"

const MAX_IMAGE_SIZE = 300 * 1024 // 300KB
const MAX_DIMENSION = 1200

/**
 * Download a remote image, compress it with sharp if >300KB,
 * and return a File object ready for uploadHashedAsset.
 */
async function downloadAndCompressRemoteImage(url: string, fallbackFilename: string): Promise<File | null> {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
        if (!response.ok) {
            console.warn(`[RemoteImg] Failed to fetch ${url}: ${response.status}`)
            return null
        }

        const contentType = response.headers.get("content-type") || "image/jpeg"
        if (!contentType.startsWith("image/")) {
            console.warn(`[RemoteImg] Not an image: ${contentType} for ${url}`)
            return null
        }

        let buffer: any = Buffer.from(await response.arrayBuffer())
        const originalSize = buffer.length
        let outputType = contentType

        // Compress if over 300KB
        if (buffer.length > MAX_IMAGE_SIZE) {
            console.log(`[RemoteImg] Compressing ${fallbackFilename}: ${(originalSize / 1024).toFixed(0)}KB → target <300KB`)

            try {
                // Get metadata to decide on resizing
                const metadata = await sharp(buffer).metadata()
                let pipeline = sharp(buffer)

                // Resize if dimensions are too large
                if (metadata.width && metadata.height) {
                    if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
                        pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
                    }
                }

                // Try progressively lower quality
                const qualities = [80, 60, 40, 20]
                for (const quality of qualities) {
                    const compressed = await pipeline.clone().jpeg({ quality, progressive: true }).toBuffer()
                    if (compressed.length <= MAX_IMAGE_SIZE) {
                        buffer = compressed
                        outputType = "image/jpeg"
                        break
                    }
                    // On last attempt, use whatever we got
                    if (quality === qualities[qualities.length - 1]) {
                        buffer = compressed
                        outputType = "image/jpeg"
                    }
                }

                console.log(`[RemoteImg] Compressed ${fallbackFilename}: ${(originalSize / 1024).toFixed(0)}KB → ${(buffer.length / 1024).toFixed(0)}KB`)
            } catch (compressErr) {
                console.warn(`[RemoteImg] Compression failed for ${fallbackFilename}, using original:`, compressErr)
            }
        }

        // Ensure the filename has the right extension
        const ext = outputType === "image/jpeg" ? ".jpg" : outputType === "image/png" ? ".png" : ".jpg"
        const baseName = fallbackFilename.replace(/\.[^.]+$/, "")
        const filename = `${baseName}${ext}`

        return new File([buffer], filename, { type: outputType, lastModified: Date.now() })
    } catch (err) {
        console.warn(`[RemoteImg] Error downloading ${url}:`, err)
        return null
    }
}

// Admin client that bypasses RLS for asset uploads
function getAdminClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_KEY!
    return createClient(url, serviceKey)
}

/**
 * Sanitize a filename: lowercase, replace spaces/special chars with underscores
 */
function sanitizeFilename(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "_")
        .replace(/_+/g, "_")
}

/**
 * Create a Mustache-safe variable name from a filename.
 * e.g., "my-logo.png" → "my_logo_png_src"
 */
function toVariableName(filename: string): string {
    return filename
        .replace(/[^a-zA-Z0-9]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase() + "_src"
}

/**
 * Upload an image to Supabase with SHA-256 hash deduplication.
 * If the file already exists (same hash+name), it silently skips the upload.
 */
export async function uploadHashedAsset(file: File): Promise<AssetMapping> {
    const admin = getAdminClient()

    // Read file as ArrayBuffer and compute SHA-256 hash
    const buffer = await file.arrayBuffer()
    const hash = createHash("sha256")
        .update(Buffer.from(buffer))
        .digest("hex")
        .substring(0, 16) // First 16 chars for uniqueness

    const cleanName = sanitizeFilename(file.name)
    const storagePath = `${hash}-${cleanName}`

    // Try to upload with upsert: false (will error if file exists = dedup)
    const { error } = await admin.storage
        .from("email-assets")
        .upload(storagePath, Buffer.from(buffer), {
            contentType: file.type,
            upsert: false,
        })

    if (error && !error.message.includes("Duplicate") && !error.message.includes("already exists")) {
        // Real error, not a dedup collision
        console.error(`Upload error for ${file.name}:`, error.message)
    }

    // Get the public URL regardless of whether upload succeeded or file already existed
    const { data: urlData } = admin.storage
        .from("email-assets")
        .getPublicUrl(storagePath)

    const variableName = toVariableName(file.name)

    return {
        originalName: file.name,
        url: urlData.publicUrl,
        variableName,
    }
}

/**
 * Main migration pipeline:
 * 1. Upload all images with hash dedup
 * 2. Run AI conversion with asset mappings
 * 3. Insert as Master Template in campaigns table
 */
export async function processMigration(formData: FormData): Promise<{
    success: boolean
    campaignId?: string
    error?: string
}> {
    try {
        console.log("[Migration] Starting processMigration...")
        const htmlFile = formData.get("htmlFile") as File
        const templateName = (formData.get("templateName") as string) || "Untitled Migration"
        const aiMode = (formData.get("aiMode") as string) || "both"
        const geminiModel = (formData.get("geminiModel") as string) || ""
        const claudeModel = (formData.get("claudeModel") as string) || ""

        if (!htmlFile) {
            return { success: false, error: "No HTML file provided" }
        }

        console.log(`[Migration] File: ${htmlFile.name} (${htmlFile.size} bytes), mode: ${aiMode}`)

        // Collect image files from the form
        const imageFiles: File[] = []
        for (const [key, value] of formData.entries()) {
            if (key.startsWith("asset_") && value instanceof File) {
                imageFiles.push(value)
            }
        }
        console.log(`[Migration] ${imageFiles.length} asset files found`)

        // Step 1: Upload all images concurrently with hash dedup
        console.log("[Migration] Step 1: Uploading assets...")
        const t1 = Date.now()
        const assetMappings = await Promise.all(
            imageFiles.map((file) => uploadHashedAsset(file))
        )
        console.log(`[Migration] Step 1 done in ${Date.now() - t1}ms — ${assetMappings.length} assets uploaded`)

        // Step 2: Parse HTML for analysis info
        console.log("[Migration] Step 2: Parsing HTML...")
        const htmlContent = await htmlFile.text()
        const parsed = parseMailchimpHtml(htmlContent)
        console.log(`[Migration] Step 2 done — title: "${parsed.title}", ${parsed.blocks.length} blocks`)

        // Step 3: Run AI conversion with selected model(s)
        console.log(`[Migration] Step 3: Running AI conversion (mode: ${aiMode}, gemini: ${geminiModel}, claude: ${claudeModel})...`)
        const t3 = Date.now()
        const { generatedHtml } = await convertMailchimpToEmail(
            htmlContent,
            assetMappings,
            aiMode as "both" | "gemini" | "claude",
            geminiModel,
            claudeModel
        )
        console.log(`[Migration] Step 3 done in ${Date.now() - t3}ms — generated ${generatedHtml.length} chars`)

        // Step 4: Build variable_values map (variableName → Supabase public URL)
        const variableValues: Record<string, string> = {}
        for (const mapping of assetMappings) {
            variableValues[mapping.variableName] = mapping.url
        }

        // Step 5: Insert as Master Template using admin client for reliability
        console.log("[Migration] Step 5: Inserting campaign...")
        const admin = getAdminClient()
        const { data, error } = await admin
            .from("campaigns")
            .insert([{
                name: templateName,
                status: "draft",
                is_template: true,
                subject_line: parsed.title || templateName,
                html_content: generatedHtml,
                variable_values: variableValues,
            }])
            .select()
            .single()

        if (error) {
            console.error("[Migration] Insert campaign error:", error)
            return { success: false, error: error.message }
        }

        console.log(`[Migration] Success! Campaign ID: ${data.id}`)
        return { success: true, campaignId: data.id }
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown migration error"
        console.error("[Migration] Error:", message)
        if (err instanceof Error && err.stack) {
            console.error("[Migration] Stack:", err.stack)
        }
        return { success: false, error: message }
    }
}

/**
 * Quick analysis action (no AI, just parser) for the upload preview panel
 */
export async function analyzeMailchimpFile(htmlContent: string): Promise<{
    title: string
    previewText: string
    imageCount: number
    blockCount: number
    linkCount: number
    summary: string
}> {
    const parsed = parseMailchimpHtml(htmlContent)
    const summary = generateContentSummary(parsed)

    return {
        title: parsed.title,
        previewText: parsed.previewText,
        imageCount: parsed.images.length,
        blockCount: parsed.blocks.length,
        linkCount: parsed.links.length,
        summary,
    }
}

/**
 * Direct HTML import — faithful "carbon copy" of the Mailchimp email:
 * 1. Upload local image assets to Supabase with hash dedup
 * 2. Download & compress remote images (mcusercontent, etc.) server-side
 * 3. Clean up Mailchimp boilerplate (MSO, archive bar, tracking)
 * 4. Replace image src with {{mustache_src}} variables for the Asset Loader
 * 5. Replace wrapping <a href> with {{mustache_link_url}} variables
 * 6. Auto-fill variable_values so all images/links are pre-populated
 */
export async function processMigrationToDnd(formData: FormData): Promise<{
    success: boolean
    campaignId?: string
    error?: string
}> {
    try {
        const htmlFile = formData.get("htmlFile") as File
        const templateName = (formData.get("templateName") as string) || "Untitled Migration"

        if (!htmlFile) {
            return { success: false, error: "No HTML file provided" }
        }

        // Collect local image files from the form
        const imageFiles: File[] = []
        for (const [key, value] of formData.entries()) {
            if (key.startsWith("asset_") && value instanceof File) {
                imageFiles.push(value)
            }
        }

        console.log(`[DirectImport] File: ${htmlFile.name}, ${imageFiles.length} local assets`)

        // Step 1: Upload local images concurrently with hash dedup
        const localAssetMappings = await Promise.all(
            imageFiles.map((file) => uploadHashedAsset(file))
        )
        console.log(`[DirectImport] Uploaded ${localAssetMappings.length} local assets`)

        // Build filename → Supabase URL map from local uploads
        const filenameToUrl: Record<string, string> = {}
        for (const mapping of localAssetMappings) {
            filenameToUrl[mapping.originalName.toLowerCase()] = mapping.url
            const nameNoExt = mapping.originalName.replace(/\.[^.]+$/, "").toLowerCase()
            filenameToUrl[nameNoExt] = mapping.url
        }

        // Step 2: Read the HTML and clean Mailchimp boilerplate
        const rawHtml = await htmlFile.text()
        const $ = cheerio.load(rawHtml)

        // Remove Mailchimp-specific elements
        $("#awesomewrap").remove()
        $(".mcnPreviewText").remove()
        $("script").remove()

        // Step 3: Process ALL images — download remotes, match locals, build variables
        const variableValues: Record<string, string> = {}
        const usedVarNames = new Set<string>()
        let imgIndex = 0

        // Helper: generate a unique variable name from a filename
        const makeUniqueVarName = (filename: string): string => {
            let base = toVariableName(filename)
            // Ensure uniqueness
            if (usedVarNames.has(base)) {
                let counter = 2
                while (usedVarNames.has(`${base.replace(/_src$/, "")}_${counter}_src`)) {
                    counter++
                }
                base = `${base.replace(/_src$/, "")}_${counter}_src`
            }
            usedVarNames.add(base)
            return base
        }

        // Collect all img elements with their data for processing
        const imgElements: { el: any; src: string; index: number }[] = []
        $("img").each((_: number, el: any) => {
            const src = $(el).attr("src") || ""
            if (!src) return
            imgElements.push({ el, src, index: imgIndex++ })
        })

        console.log(`[DirectImport] Found ${imgElements.length} images to process`)

        // Process images: download remotes, match locals
        for (const { el, src, index } of imgElements) {
            const $img = $(el)
            const srcFilename = src.split("/").pop()?.split("?")[0]?.toLowerCase() || `image_${index}`
            let supabaseUrl: string | null = null

            // Try matching against locally uploaded files first
            supabaseUrl = filenameToUrl[srcFilename]
            if (!supabaseUrl) {
                const srcNoExt = srcFilename.replace(/\.[^.]+$/, "")
                supabaseUrl = filenameToUrl[srcNoExt]
            }
            if (!supabaseUrl) {
                for (const [uploadedName, url] of Object.entries(filenameToUrl)) {
                    if (srcFilename.includes(uploadedName) || uploadedName.includes(srcFilename)) {
                        supabaseUrl = url
                        break
                    }
                }
            }

            // If no local match and it's a remote URL, download + compress + upload
            if (!supabaseUrl && (src.startsWith("http://") || src.startsWith("https://"))) {
                console.log(`[DirectImport] Downloading remote image: ${srcFilename}`)
                const file = await downloadAndCompressRemoteImage(src, srcFilename)
                if (file) {
                    const mapping = await uploadHashedAsset(file)
                    supabaseUrl = mapping.url
                    // Also add to local map for dedup if same image appears again
                    filenameToUrl[srcFilename] = supabaseUrl
                }
            }

            if (supabaseUrl) {
                // Generate mustache variable name
                const varName = makeUniqueVarName(srcFilename)
                const linkVarName = varName.replace(/_src$/, "_link_url")

                // Replace src with mustache variable
                $img.attr("src", `{{${varName}}}`)

                // Store the Supabase URL in variable_values (auto-fills the Asset Loader)
                variableValues[varName] = supabaseUrl

                // Handle wrapping <a> link — replace href with mustache variable
                const $parentLink = $img.closest("a")
                if ($parentLink.length) {
                    const originalHref = $parentLink.attr("href") || ""
                    $parentLink.attr("href", `{{${linkVarName}}}`)
                    // Auto-fill the link value
                    if (originalHref && !originalHref.startsWith("{{")) {
                        variableValues[linkVarName] = originalHref
                    }
                }

                console.log(`[DirectImport] ${srcFilename} → {{${varName}}}`)
            } else {
                // Leave as-is for relative/local paths that couldn't be resolved
                console.warn(`[DirectImport] Could not resolve image: ${src}`)
            }
        }

        // Step 4: Get the cleaned HTML
        let cleanedHtml = $.html()

        // Remove MSO conditional comments at the string level
        cleanedHtml = cleanedHtml.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/gi, "")
        cleanedHtml = cleanedHtml.replace(/<!--\[if !mso\]><!-->/gi, "")
        cleanedHtml = cleanedHtml.replace(/<!--<!\[endif\]-->/gi, "")

        // Extract title for the campaign
        const title = $("title").text() || $('meta[property="og:title"]').attr("content") || templateName

        console.log(`[DirectImport] Processed ${Object.keys(variableValues).length} variables`)

        // Step 5: Insert campaign with mustache-templated HTML
        const admin = getAdminClient()
        const { data, error } = await admin
            .from("campaigns")
            .insert([{
                name: templateName,
                status: "draft",
                is_template: true,
                subject_line: title,
                html_content: cleanedHtml,
                variable_values: variableValues,
            }])
            .select()
            .single()

        if (error) {
            console.error("[DirectImport] Insert error:", error)
            return { success: false, error: error.message }
        }

        console.log(`[DirectImport] Success! Campaign ID: ${data.id}`)
        return { success: true, campaignId: data.id }
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown migration error"
        console.error("[DirectImport] Error:", message)
        return { success: false, error: message }
    }
}
