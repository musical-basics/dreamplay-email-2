/**
 * Renders a template by replacing all {{key}} placeholders with actual values from the assets object.
 * @param html - The raw HTML template string containing {{variable}} placeholders
 * @param assets - An object mapping variable names to their replacement values
 * @returns The processed HTML string with all placeholders replaced
 */
export function renderTemplate(html: string, assets: Record<string, string>, subscriberTags: string[] = []): string {
    let result = html

    // Pass 0: Smart Blocks — Conditional Tag Content
    // Syntax: {{#if tag_Europe}} content {{/endif}}
    // Keeps content if subscriberTags includes the tag name, strips it otherwise.
    result = result.replace(
        /\{\{#if\s+tag_(\w+)\}\}([\s\S]*?)\{\{\/?endif\}\}/gi,
        (_match, tagName: string, content: string) => {
            // Check manual tags (case-insensitive)
            const hasTag = subscriberTags.some(
                t => t.toLowerCase() === tagName.toLowerCase()
            );
            return hasTag ? content.trim() : "";
        }
    );

    // 1. (Removed premature replacement)

    // NEW APPROACH: Two-Pass
    // Pass 1: Handle "Fit" injection for Image Variables
    for (const [key, value] of Object.entries(assets)) {
        const fitKey = `${key}_fit`
        const fitValue = assets[fitKey]

        if (fitValue) {
            // Look for <img ... src="{{key}}" ... >
            // We want to inject/replace object-fit in the style attribute.
            // Regex explanation:
            // <img[^>]*       Start of img tag
            // src=["']\{\{key\}\}["']  src attribute with variable
            // [^>]*           Other attributes
            // >               End of tag

            // This is too complex to reliably parse/replace in one go due to attribute order.
            // However, we can handle the common case: `style="..."` exists.

            // Strategy: Find strings that look like `<img ... src="{{key}}"` 
            // and then look for `style="` nearby?

            // Actually, let's keep it simple.
            // If the user hasn't put `{{key_fit}}` in their style, we try to force it.
            // BUT, if we just blindly modify `renderTemplate`, we might break things.

            // Let's try a safer regex that targets the specific structure user has?
            // User: `style="width: 100%; height: 300px; object-fit: cover;"`
            // We can look for `object-fit: \w+` inside a style attribute that is inside a tag with `src="{{key}}"`.

            // We will match the whole IMG tag containing the src variable.
            const imgTagRegex = new RegExp(`(<img[^>]*src=["']\\{\\{${key}\\}\\}["'][^>]*>)`, 'gi')

            result = result.replace(imgTagRegex, (match) => {
                // 'match' is the full <img> tag (assuming no > inside attributes, which is standard HTML)

                // Check if style exists
                if (match.match(/style=["'][^"']*["']/i)) {
                    // Update existing style
                    return match.replace(/(style=["'][^"']*)object-fit:\s*[\w-]+;?([^"']*["'])/i, `$1object-fit: ${fitValue};$2`)
                        .replace(/(style=["'])(?!.*object-fit)([^"']*["'])/i, `$1object-fit: ${fitValue}; $2`)
                    // The second replace is for when object-fit is NOT present but style IS.
                    // However, the first replace might have already handled it. 
                    // Let's be careful.

                    // Actually, simpler: Parse the style attribute value.
                    return match.replace(/style=(["'])(.*?)\1/i, (styleMatch, quote, styleContent) => {
                        let newStyle = styleContent
                        // 1. Handle object-fit
                        if (newStyle.includes('object-fit:')) {
                            newStyle = newStyle.replace(/object-fit:\s*[\w-]+/i, `object-fit: ${fitValue}`)
                        } else {
                            newStyle = `${newStyle}; object-fit: ${fitValue}`
                        }

                        // 2. Handle dimensions for robustness (Email clients often strip classes)
                        // This ensures the image doesn't overflow its container
                        if (!newStyle.includes('max-width:')) {
                            newStyle = `${newStyle}; max-width: 100%`
                        }
                        if (!newStyle.includes('height:')) {
                            newStyle = `${newStyle}; height: auto` // Prevent stretching if width is constrained
                        }

                        return `style=${quote}${newStyle}${quote}`
                    })
                } else {
                    // No style attribute, add one
                    // Insert before the closing /> or >
                    if (match.endsWith('/>')) {
                        return match.slice(0, -2) + ` style="object-fit: ${fitValue}; max-width: 100%; height: auto;" />`
                    } else {
                        return match.slice(0, -1) + ` style="object-fit: ${fitValue}; max-width: 100%; height: auto;">`
                    }
                }
            })
        }
    }

    // Pass 2: Standard Replacement (Existing Logic)
    for (const [key, value] of Object.entries(assets)) {
        const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g")
        result = result.replace(pattern, value || "")
    }

    return result
}
