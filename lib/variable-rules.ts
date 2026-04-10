/**
 * lib/variable-rules.ts
 *
 * Single source of truth for all {{mustache_variable}} naming rules.
 *
 * These rules govern:
 *  - How the Asset Loader sidebar classifies and renders variable inputs
 *  - How AI prompts (Copilot, DnD Copilot, email-generator) instruct models
 *  - How send-time merge-tag resolution identifies subscriber-owned variables
 *
 * If you add or change a rule here, it automatically propagates everywhere.
 */

// ---------------------------------------------------------------------------
// 1. STANDARD TAGS — auto-resolved from subscriber data at send time
//    Never shown in the Asset Loader; AI agents should use them freely.
// ---------------------------------------------------------------------------
export const STANDARD_TAGS: string[] = [
    "first_name",
    "last_name",
    "email",
    "subscriber_id",
    "location_city",
    "location_country",
    "discount_code",
    "unsubscribe_url",
    "unsubscribe_link",
    "unsubscribe_link_url",
]

// ---------------------------------------------------------------------------
// 2. IMAGE VARIABLE SUFFIXES / KEYWORDS
//    A variable is treated as an image uploader when its name (lowercased):
//    - ends with one of IMAGE_SUFFIXES, OR
//    - contains one of IMAGE_KEYWORDS
// ---------------------------------------------------------------------------
export const IMAGE_SUFFIXES: string[] = ["_src", "_bg", "_logo", "_icon", "_img"]
export const IMAGE_KEYWORDS: string[] = ["image", "url"]

// URL variables that look like image vars but are really page/action links.
// These are excluded from image classification and fall through to plain text.
export const EXCLUDED_URL_VARS: string[] = [
    "unsubscribe_url",
    "privacy_url",
    "contact_url",
    "about_url",
    "homepage_url",
    "shipping_url",
    "main_cta_url",
    "crowdfunding_cta_url",
]

// Suffixes stripped when looking for the "base name" to pair image ↔ link/fit
export const IMAGE_PAIR_STRIP_SUFFIXES: string[] = [
    "_img", "_src", "_bg", "_logo", "_icon", "_image", "_thumbnail_src", "_thumbnail",
]

// ---------------------------------------------------------------------------
// 3. CLASSIFICATION FUNCTIONS
// ---------------------------------------------------------------------------

/** Returns true if the variable should render as an image uploader. */
export function isImageVariable(variable: string): boolean {
    const lower = variable.toLowerCase()
    if (lower.endsWith("_fit")) return false
    if (lower.endsWith("_link_url") || lower.includes("link_url")) return false
    if (EXCLUDED_URL_VARS.includes(lower)) return false
    return (
        IMAGE_SUFFIXES.some(s => lower.endsWith(s)) ||
        IMAGE_KEYWORDS.some(k => lower.includes(k))
    )
}

/** Returns true if the variable should render as a link URL input with saved-links dropdown. */
export function isLinkVariable(variable: string): boolean {
    const lower = variable.toLowerCase()
    return lower.endsWith("_link_url") || lower.includes("link_url")
}

/** Returns true if the variable should render as a multi-line textarea. */
export function isTextAreaVariable(variable: string): boolean {
    const lower = variable.toLowerCase()
    return lower.includes("text") || lower.includes("paragraph")
}

/** Returns true if the variable should render as an object-fit dropdown. */
export function isFitVariable(variable: string): boolean {
    return variable.toLowerCase().endsWith("_fit")
}

// ---------------------------------------------------------------------------
// 4. PAIRING HELPERS
// ---------------------------------------------------------------------------

/**
 * Given an image variable name, returns its paired _link_url variable
 * from the provided list (or null if none found).
 *
 * Example: "lifestyle_img" → looks for "lifestyle_link_url"
 */
export function findPairedLinkVar(imageVar: string, variables: string[]): string | null {
    const prefix = imageVar.replace(
        new RegExp(`(${IMAGE_PAIR_STRIP_SUFFIXES.map(s => s.replace(/[_]/g, "_")).join("|")})$`, "i"),
        ""
    )
    if (!prefix || prefix === imageVar) return null

    const exactMatch = variables.find(v => {
        const lower = v.toLowerCase()
        return lower === `${prefix.toLowerCase()}_link_url` || lower === `${prefix.toLowerCase()}link_url`
    })
    if (exactMatch) return exactMatch

    return variables.find(v => {
        if (!isLinkVariable(v)) return false
        const linkPrefix = v.replace(/_?link_url$/i, "").toLowerCase()
        return linkPrefix && prefix.toLowerCase().startsWith(linkPrefix)
    }) || null
}

/**
 * Given a _link_url variable name, returns its paired image variable
 * from the provided list (or null if none found).
 *
 * Example: "lifestyle_link_url" → looks for "lifestyle_img", "lifestyle_src", etc.
 */
export function findPairedImageVar(linkVar: string, variables: string[]): string | null {
    const prefix = linkVar.replace(/_?link_url$/i, "")
    if (!prefix) return null
    return variables.find(v => {
        const lower = v.toLowerCase()
        return lower.startsWith(prefix.toLowerCase()) && isImageVariable(v)
    }) || null
}

// ---------------------------------------------------------------------------
// 5. AI PROMPT SNIPPET
//    Use this wherever an AI model needs to know the naming conventions.
//    Keeps all prompts in sync automatically.
// ---------------------------------------------------------------------------
export const VARIABLE_RULES_PROMPT = `
## MUSTACHE VARIABLE NAMING RULES

The email editor's Asset Loader classifies {{mustache_variables}} by name:

### Auto-resolved (subscriber data — use freely, no asset needed):
${STANDARD_TAGS.map(t => `- {{${t}}}`).join("\n")}

### Image variables → image uploader + file picker:
A variable is an IMAGE when its name ends with: ${IMAGE_SUFFIXES.join(", ")}
OR contains the words: ${IMAGE_KEYWORDS.join(", ")}
Exceptions (treated as plain text even if they contain "url"):
${EXCLUDED_URL_VARS.map(t => `- {{${t}}}`).join("\n")}

### Link variables → URL input with saved-links dropdown:
A variable is a LINK when its name ends with "_link_url" or contains "link_url".
Examples: {{hero_link_url}}, {{product_link_url}}, {{main_cta_url}}

### Fit variables → object-fit dropdown (cover / contain / fill / scale-down):
A variable is a FIT control when its name ends with "_fit".
Example: {{hero_img_fit}} pairs with {{hero_img}}

### Text/paragraph variables → multi-line textarea:
A variable is a TEXTAREA when its name contains "text" or "paragraph".
Examples: {{body_text}}, {{paragraph_one}}

### Everything else → single-line text input.

### PAIRING RULE (renders as one grouped card in the Asset Loader):
If an image variable and a _link_url variable share the same prefix, they pair together:
- {{hero_img}} + {{hero_link_url}} → one card with image uploader + link input
- {{hero_img}} + {{hero_img_fit}} → fit dropdown rendered inside the same card

### REQUIRED NAMING CONVENTIONS FOR AI-GENERATED TEMPLATES:
- Primary CTA button URL: ALWAYS use {{main_cta_url}}
- Hero image: {{hero_img}} or {{hero_src}}
- Hero click destination: {{hero_link_url}}
- Product image: {{product_img}}
- Background image: {{section_bg}}
- Long body copy: {{body_text}}
- Always wrap images in clickable links: <a href="{{hero_link_url}}"><img src="{{hero_img}}" /></a>
`.trim()
