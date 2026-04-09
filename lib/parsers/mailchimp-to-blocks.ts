import * as cheerio from "cheerio"
import type {
    EmailBlock,
    EmailDesign,
    HeadingProps,
    TextProps,
    ImageProps,
    ButtonProps,
    SpacerProps,
    SocialProps,
    SocialNetwork,
} from "@/lib/dnd-blocks/types"

// ============================================================
// Mailchimp HTML → DnD EmailBlock[] Converter
// Deterministically maps Mailchimp CSS classes to block types.
// No AI needed — pure DOM parsing.
// ============================================================

let blockCounter = 0

function makeId(): string {
    return `block-mc-${Date.now()}-${blockCounter++}-${Math.random().toString(36).slice(2, 6)}`
}

function extractStyle(style: string, prop: string): string {
    const regex = new RegExp(`${prop}\\s*:\\s*([^;]+)`, "i")
    const match = style?.match(regex)
    return match ? match[1].trim() : ""
}

function detectAlignment($el: any, $: any): "left" | "center" | "right" {
    const style = $el.attr("style") || ""
    const align = extractStyle(style, "text-align")
    if (align === "right") return "right"
    if (align === "left") return "left"
    if (align === "center") return "center"
    const tdAlign = $el.closest("td").attr("align")
    if (tdAlign === "right") return "right"
    if (tdAlign === "left") return "left"
    return "center"
}

function extractColor($el: any, $: any): string {
    const directStyle = $el.attr("style") || ""
    const directColor = extractStyle(directStyle, "color")
    if (directColor) return directColor
    const span = $el.find("span[style*='color']").first()
    if (span.length) {
        const spanColor = extractStyle(span.attr("style") || "", "color")
        if (spanColor) return spanColor
    }
    return "#000000"
}

function stripHtml(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

function parseTextBlock($el: any, $: any): EmailBlock[] {
    const blocks: EmailBlock[] = []
    const children = $el.children()

    let pendingText: string[] = []
    let pendingColor = "#444444"
    let pendingAlignment: "left" | "center" | "right" = "center"

    const flushText = () => {
        const joined = pendingText.join("\n").trim()
        if (joined && joined.length > 1) {
            blocks.push({
                id: makeId(),
                type: "text",
                props: {
                    text: joined,
                    alignment: pendingAlignment,
                    color: pendingColor,
                    fontSize: 16,
                    lineHeight: 1.5,
                } as TextProps,
            })
        }
        pendingText = []
    }

    children.each((_: number, child: any) => {
        const $child = $(child)
        const tag = child.type === "tag" ? child.tagName?.toLowerCase() : ""

        if (tag === "h1" || tag === "h2" || tag === "h3") {
            flushText()
            const text = stripHtml($child.html() || "")
            if (text && text.length > 1) {
                const color = extractColor($child, $)
                const alignment = detectAlignment($child, $)
                blocks.push({
                    id: makeId(),
                    type: "heading",
                    props: {
                        text,
                        level: tag as "h1" | "h2" | "h3",
                        alignment,
                        color,
                        fontFamily: "Arial, Helvetica, sans-serif",
                    } as HeadingProps,
                })
            }
        } else if (tag === "p" || tag === "div" || tag === "span") {
            const text = stripHtml($child.html() || "")
            if (text && text.length > 0) {
                pendingColor = extractColor($child, $)
                pendingAlignment = detectAlignment($child, $)
                pendingText.push(text)
            }
        }
    })

    flushText()
    return blocks
}

function imageVarName(src: string, index: number): string {
    const filename = src.split("/").pop() || `image_${index}`
    return filename
        .replace(/[^a-zA-Z0-9]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase() + "_src"
}

export interface MailchimpToBlocksResult {
    blocks: EmailDesign
    assets: Record<string, string>
    title: string
    previewText: string
}

/**
 * Convert Mailchimp HTML export into DnD EmailBlock[] array.
 * Walks the DOM looking for Mailchimp CSS classes and maps them
 * to the appropriate block types deterministically.
 */
export function convertMailchimpToBlocks(html: string): MailchimpToBlocksResult {
    blockCounter = 0
    const $ = cheerio.load(html)

    const title =
        $("title").text() || $('meta[property="og:title"]').attr("content") || "Untitled Email"
    const previewText = $(".mcnPreviewText").text().trim()

    const assets: Record<string, string> = {}
    let imageIndex = 0
    const blocks: EmailBlock[] = []

    // Remove archive bar and preview text
    $("#awesomewrap").remove()
    $(".mcnPreviewText").remove()
    $("script").remove()

    // Track processed elements to avoid duplicates
    const processedTextIds = new Set<string>()
    const processedImageIds = new Set<string>()
    const processedButtonIds = new Set<string>()

    // Collect all content elements with position info for document-order sorting
    const contentElements: Array<{
        $el: any
        type: "text" | "image" | "button" | "social" | "footer"
        position: number
    }> = []

    // Find .mceText blocks (headings and text)
    $(".mceText").each((_: number, el: any) => {
        const $el = $(el)
        // Skip if inside footer
        if ($el.closest(".mceFooterSection").length > 0) return
        const id = $el.attr("id") || $el.data("block-id")?.toString() || `text-${_}`
        if (!processedTextIds.has(id)) {
            processedTextIds.add(id)
            const pos = getElPosition($el, $)
            contentElements.push({ $el, type: "text", position: pos })
        }
    })

    // Find images (not inside footer or MSO conditionals)
    $("img.mceImage, img.imageDropZone").each((_: number, el: any) => {
        const $el = $(el)
        if ($el.closest(".mceFooterSection").length > 0) return
        // Skip duplicates from MSO conditionals
        const src = $el.attr("src") || ""
        if (src.includes("mcusercontent.com")) return

        const testId = $el.closest("[data-testid]").attr("data-testid") || ""
        const blockId = $el.data("block-id")?.toString() || testId || `img-${_}`
        if (!processedImageIds.has(blockId)) {
            processedImageIds.add(blockId)
            const pos = getElPosition($el, $)
            contentElements.push({ $el, type: "image", position: pos })
        }
    })

    // Find buttons
    $(".mceButtonLink").each((_: number, el: any) => {
        const $el = $(el)
        if ($el.closest(".mceFooterSection").length > 0) return
        const blockId = $el.closest("[data-block-id]").data("block-id")?.toString() || `btn-${_}`
        if (!processedButtonIds.has(blockId)) {
            processedButtonIds.add(blockId)
            const pos = getElPosition($el, $)
            contentElements.push({ $el, type: "button", position: pos })
        }
    })

    // Find social follow blocks
    const socialProcessed = false
    $(".mceSocialFollowIcon").each((_: number, el: any) => {
        const pos = getElPosition($(el), $)
        contentElements.push({ $el: $(el), type: "social", position: pos })
    })

    // Find footer
    $(".mceFooterSection").each((_: number, el: any) => {
        const pos = getElPosition($(el), $)
        contentElements.push({ $el: $(el), type: "footer", position: pos })
    })

    // Sort by document position
    contentElements.sort((a, b) => a.position - b.position)

    // Process each element in order
    for (const item of contentElements) {
        switch (item.type) {
            case "text": {
                const textBlocks = parseTextBlock(item.$el, $)
                blocks.push(...textBlocks)
                break
            }

            case "image": {
                const $el = item.$el
                const src = $el.attr("src") || ""
                const alt = $el.attr("alt") || ""
                const widthAttr = $el.attr("width")
                const width = widthAttr ? parseInt(widthAttr, 10) : 600
                const parentLink = $el.closest("a").attr("href") || ""

                const varName = imageVarName(src, imageIndex++)
                assets[varName] = src.startsWith("http") ? src : ""

                const linkVarName = parentLink ? varName.replace("_src", "_link_url") : ""
                if (parentLink) {
                    assets[linkVarName] = parentLink
                }

                blocks.push({
                    id: makeId(),
                    type: "image",
                    props: {
                        src: `{{${varName}}}`,
                        alt,
                        width: Math.min(width || 600, 600),
                        height: "auto",
                        linkUrl: linkVarName ? `{{${linkVarName}}}` : "",
                        alignment: "center",
                    } as ImageProps,
                })
                break
            }

            case "button": {
                const $el = item.$el
                const text = $el.text().trim()
                const href = $el.attr("href") || ""
                const style = $el.attr("style") || ""

                const bgColor = extractStyle(style, "background-color") || "#000000"
                const textColor = extractStyle(style, "color") || "#ffffff"
                const borderRadiusStr = extractStyle(style, "border-radius")
                const borderRadius = borderRadiusStr ? parseInt(borderRadiusStr, 10) : 6

                if (text) {
                    blocks.push({
                        id: makeId(),
                        type: "button",
                        props: {
                            text,
                            url: href,
                            bgColor,
                            textColor,
                            borderRadius: isNaN(borderRadius) ? 6 : borderRadius,
                            alignment: "center",
                            fullWidth: false,
                            fontSize: 16,
                            paddingX: 28,
                            paddingY: 16,
                        } as ButtonProps,
                    })
                }
                break
            }

            case "social": {
                const $el = item.$el
                const networks: SocialNetwork[] = []
                $el.find("a").each((_: number, a: any) => {
                    const $a = $(a)
                    const href = $a.attr("href") || ""
                    const img = $a.find("img")
                    const alt = img.attr("alt") || ""
                    const platform = alt.replace(" icon", "").toLowerCase()
                    const validPlatforms = ["facebook", "instagram", "twitter", "youtube", "linkedin", "tiktok"]
                    if (validPlatforms.includes(platform)) {
                        networks.push({ platform: platform as SocialNetwork["platform"], url: href })
                    }
                })
                if (networks.length > 0) {
                    blocks.push({
                        id: makeId(),
                        type: "social",
                        props: { networks, alignment: "center", iconSize: 32 } as SocialProps,
                    })
                }
                break
            }

            case "footer": {
                const $el = item.$el
                const footerText = $el.find(".mceText").first()
                if (footerText.length) {
                    const text = stripHtml(footerText.html() || "")
                    if (text && text.length > 5) {
                        blocks.push({
                            id: makeId(),
                            type: "text",
                            props: {
                                text,
                                alignment: "center",
                                color: "#999999",
                                fontSize: 11,
                                lineHeight: 1.5,
                            } as TextProps,
                        })
                    }
                }
                break
            }
        }
    }

    // Add spacers between different block types for visual breathing room
    const spacedBlocks: EmailBlock[] = []
    for (let i = 0; i < blocks.length; i++) {
        spacedBlocks.push(blocks[i])
        if (i < blocks.length - 1) {
            const current = blocks[i].type
            const next = blocks[i + 1].type
            if (current !== next && !(current === "heading" && next === "text")) {
                spacedBlocks.push({
                    id: makeId(),
                    type: "spacer",
                    props: { height: 16 } as SpacerProps,
                })
            }
        }
    }

    return {
        blocks: spacedBlocks,
        assets,
        title,
        previewText,
    }
}

/**
 * Get approximate position of an element in the HTML document for sorting.
 */
function getElPosition($el: any, $: any): number {
    const blockId = $el.closest("[data-block-id]").data("block-id")
    if (blockId !== undefined) {
        const numId = typeof blockId === "number" ? blockId : parseInt(String(blockId), 10)
        if (!isNaN(numId)) return numId
    }
    const id = $el.attr("id") || $el.attr("data-block-id") || ""
    if (id) {
        const html = $.html()
        const pos = html.indexOf(`id="${id}"`)
        if (pos >= 0) return pos
    }
    return 999999
}
