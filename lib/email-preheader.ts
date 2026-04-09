/**
 * Inject a hidden preheader (preview text) into HTML email content.
 * The preheader is a hidden span placed right after <body> that email clients
 * display as preview text in the inbox list. Followed by invisible whitespace
 * padding to prevent body text from bleeding into the preview.
 */
export function injectPreheader(html: string, previewText: string | undefined | null): string {
    if (!previewText || !previewText.trim()) return html

    const preheaderHtml = `<!--[preheader]--><div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${previewText.trim()}</div><!--[/preheader]-->`

    // Insert right after <body...>
    const bodyMatch = html.match(/<body[^>]*>/i)
    if (bodyMatch) {
        const insertPos = html.indexOf(bodyMatch[0]) + bodyMatch[0].length
        return html.slice(0, insertPos) + preheaderHtml + html.slice(insertPos)
    }

    // No <body> tag — prepend to HTML
    return preheaderHtml + html
}
