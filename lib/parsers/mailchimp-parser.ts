import * as cheerio from "cheerio"

export interface ParsedBlock {
    type: "text" | "image" | "button" | "divider" | "social" | "footer" | "logo"
    content?: string
    src?: string
    href?: string
    alt?: string
    style?: string
    width?: string
    children?: ParsedBlock[]
}

export interface ParsedEmail {
    title: string
    previewText: string
    blocks: ParsedBlock[]
    images: { filename: string; originalSrc: string; alt: string }[]
    links: { text: string; href: string }[]
    socialLinks: { platform: string; href: string; icon: string }[]
    footerHtml: string
    rawHtml: string
}

/**
 * Parses Mailchimp HTML exports into structured content blocks.
 * Strips Mailchimp-specific markup (MSO conditionals, archive bar, tracking)
 * and extracts meaningful content sections.
 */
export function parseMailchimpHtml(html: string): ParsedEmail {
    const $ = cheerio.load(html)

    // Extract metadata
    const title =
        $("title").text() || $('meta[property="og:title"]').attr("content") || "Untitled Email"
    const previewText = $(".mcnPreviewText").text().trim()

    // Remove Mailchimp archive elements
    $("#awesomewrap").remove()
    $(".mcnPreviewText").remove()
    $("script").remove()
    $("link[rel=stylesheet]").remove()

    // Remove MSO conditional comments
    const cleanedHtml = html.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/gi, "")

    const blocks: ParsedBlock[] = []
    const images: ParsedEmail["images"] = []
    const links: ParsedEmail["links"] = []
    const socialLinks: ParsedEmail["socialLinks"] = []

    // Walk DOM in document order to preserve interleaved layout
    // Each Mailchimp block sits inside a mceRow; we process child blocks
    // (images, text, buttons) in the order they appear in the HTML.
    $("[data-block-id]").each((_, el) => {
        const $el = $(el)

        // Check if this block is an image
        const isImage = $el.is("img.mceImage, img.mceLogo, img.imageDropZone")
        // Or contains an image directly (e.g. a link wrapping an image table)
        const $img = isImage ? $el : $el.find("img.mceImage, img.mceLogo, img.imageDropZone").first()

        if ($img.length) {
            const src = $img.attr("src") || ""
            const alt = $img.attr("alt") || ""
            const width = $img.attr("width") || ""
            const parentLink = $img.closest("a").attr("href") || ""
            const filename = src.split("/").pop()?.split("?")[0] || src

            images.push({ filename, originalSrc: src, alt })

            const isLogo = $img.hasClass("mceLogo")
            blocks.push({
                type: isLogo ? "logo" : "image",
                src,
                alt: alt || filename, // Use filename as fallback when alt is empty
                href: parentLink,
                width,
            })
            return // done with this block
        }

        // Check if this block is text
        if ($el.hasClass("mceText")) {
            const innerHtml = $el.html()?.trim()
            if (innerHtml && innerHtml.length > 10) {
                blocks.push({
                    type: "text",
                    content: innerHtml,
                })
            }
            return
        }

        // Check if this block is a button
        const $btn = $el.find(".mceButtonLink").first()
        if ($btn.length) {
            const href = $btn.attr("href") || ""
            const text = $btn.text().trim()
            const style = $btn.attr("style") || ""
            if (text) {
                blocks.push({
                    type: "button",
                    content: text,
                    href,
                    style,
                })
                links.push({ text, href })
            }
            return
        }
    })

    // Extract social follow icons
    $(".mceSocialFollowIcon a").each((_, el) => {
        const $el = $(el)
        const href = $el.attr("href") || ""
        const img = $el.find("img")
        const alt = img.attr("alt") || ""
        const icon = img.attr("src") || ""

        const platform = alt.replace(" icon", "").toLowerCase()
        socialLinks.push({ platform, href, icon })
    })

    // Extract footer
    const footerSection = $(".mceFooterSection")
    const footerHtml = footerSection.html()?.trim() || ""

    return {
        title,
        previewText,
        blocks,
        images,
        links,
        socialLinks,
        footerHtml,
        rawHtml: cleanedHtml,
    }
}

/**
 * Generates a content summary for the AI model, describing the structure
 * of the parsed email in plain language.
 */
export function generateContentSummary(parsed: ParsedEmail): string {
    const sections: string[] = []

    sections.push(`# Email: "${parsed.title}"`)
    if (parsed.previewText) {
        sections.push(`Preview text: "${parsed.previewText}"`)
    }
    sections.push("")

    sections.push(`## Content Structure (${parsed.blocks.length} blocks):`)
    parsed.blocks.forEach((block, i) => {
        switch (block.type) {
            case "image": {
                const label = block.alt || block.src?.split("/").pop()?.split("?")[0] || "unknown"
                sections.push(
                    `${i + 1}. IMAGE: "${label}" (${block.width}px wide) ${block.href ? `→ links to: ${block.href}` : ""}`
                )
                break
            }
            case "logo":
                sections.push(`${i + 1}. LOGO IMAGE: ${block.src}`)
                break
            case "text":
                const preview = (block.content || "").replace(/<[^>]+>/g, "")
                sections.push(`${i + 1}. TEXT BLOCK: "${preview}"`)
                break
            case "button":
                sections.push(`${i + 1}. CTA BUTTON: "${block.content}" → ${block.href}`)
                break
        }
    })

    sections.push("")
    sections.push(`## Images (${parsed.images.length} total):`)
    parsed.images.forEach((img, i) => {
        sections.push(`  ${i + 1}. ${img.filename} (alt: "${img.alt}")`)
    })

    sections.push("")
    sections.push(`## Social Links: ${parsed.socialLinks.map((s) => s.platform).join(", ")}`)

    return sections.join("\n")
}
