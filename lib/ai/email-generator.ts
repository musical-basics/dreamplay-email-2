import { GoogleGenAI } from "@google/genai"
import Anthropic from "@anthropic-ai/sdk"
import { parseMailchimpHtml, generateContentSummary, ParsedEmail } from "../parsers/mailchimp-parser"

// Lazy-initialized to avoid build-time errors when env vars aren't set
function getGemini() {
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })
}

function getAnthropic() {
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
}

export interface AssetMapping {
    originalName: string
    url: string
    variableName: string
}

/**
 * Step 1: Use Gemini to analyze Mailchimp HTML and create a semantic content map
 */
async function analyzeWithGemini(
    parsed: ParsedEmail,
    assetMappings: AssetMapping[],
    modelId: string = "gemini-2.5-pro"
): Promise<string> {
    const contentSummary = generateContentSummary(parsed)
    const assetList = assetMappings.map((a, i) =>
        `${i + 1}. Original: "${a.originalName}" → Mustache variable: {{${a.variableName}}}`
    ).join("\n")

    const response = await getGemini().models.generateContent({
        model: modelId,
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text: `You are an email template migration expert. Analyze the following Mailchimp email export and create a detailed content map for converting it into a clean HTML email.

## Source Email Content:
${contentSummary}

## Image Asset Mappings (original name → Mustache variable):
${assetList}

## Original HTML (first 3000 chars for structure reference):
\`\`\`html
${parsed.rawHtml.substring(0, 3000)}
\`\`\`

## Instructions:
Create a JSON content map with this exact structure:
{
  "subject": "email subject line",
  "previewText": "preview text",
  "sections": [
    {
      "type": "hero_image" | "text" | "image_with_link" | "cta_button" | "social_icons" | "footer" | "divider" | "logo",
      "content": "text content or description",
      "image": "matching Mustache variable (e.g., {{logo_png_src}}) or null",
      "link": "URL or null",
      "style": { "backgroundColor": "#hex", "textColor": "#hex", "alignment": "center|left|right" }
    }
  ],
  "globalStyle": {
    "backgroundColor": "#hex",
    "contentWidth": 660,
    "fontFamily": "font name",
    "primaryColor": "#hex"
  }
}

IMPORTANT: For images, use the Mustache variable names from the asset mappings above. Map each original filename to its corresponding variable.`,
                    },
                ],
            },
        ],
    })

    return response?.text ?? ""
}

/**
 * Step 2: Use Claude to generate clean, portable HTML email code with Mustache variables
 */
async function generateWithClaude(
    contentMap: string,
    originalHtml: string,
    assetMappings: AssetMapping[],
    modelId: string = "claude-sonnet-4-20250514"
): Promise<string> {
    const assetList = assetMappings.map((a) =>
        `- Original: "${a.originalName}" → Use: src="{{${a.variableName}}}"`
    ).join("\n")

    const response = await getAnthropic().messages.create({
        model: modelId,
        max_tokens: 8192,
        messages: [
            {
                role: "user",
                content: `You are an expert HTML email developer. Generate a clean, portable HTML email based on the content map and original source below.

## Content Map (from analysis):
${contentMap}

## Image Asset Mappings:
${assetList}

## Original HTML (for style reference, first 4000 chars):
\`\`\`html
${originalHtml.substring(0, 4000)}
\`\`\`

## REQUIREMENTS:
1. Use TABLE-based layout (for email client compatibility)
2. ALL styles must be INLINE (no <style> tags in body)
3. Max content width: 660px, centered
4. For EVERY image, you MUST replace the src attribute with the corresponding Mustache variable from the mappings above. Example: src="{{logo_png_src}}"
5. Include proper email DOCTYPE and meta tags
6. Support dark mode with meta color-scheme
7. Include MSO conditionals for Outlook compatibility
8. Buttons should use VML for Outlook + standard for others
9. Preserve ALL original links and CTAs exactly
10. Match the original layout as closely as possible
11. Include an unsubscribe link placeholder: {{unsubscribe_url}}
12. Include a view-in-browser placeholder: {{view_in_browser_url}}

## CRITICAL: Every image src MUST use a Mustache variable (e.g., src="{{filename_png_src}}"). Do NOT use direct URLs for images.

## OUTPUT:
Return ONLY the complete HTML email code. No markdown, no explanations, just the HTML starting with <!DOCTYPE html>.`,
            },
        ],
    })

    const textBlock = response.content.find((b: { type: string }) => b.type === "text") as { type: string; text: string } | undefined
    return textBlock?.text ?? ""
}

/**
 * Full generation with Gemini only
 */
async function generateFullWithGemini(
    parsed: ParsedEmail,
    assetMappings: AssetMapping[],
    modelId: string = "gemini-2.5-pro"
): Promise<string> {
    const contentSummary = generateContentSummary(parsed)
    const assetList = assetMappings.map((a) =>
        `- Original: "${a.originalName}" → Use: src="{{${a.variableName}}}"`
    ).join("\n")

    const response = await getGemini().models.generateContent({
        model: modelId,
        contents: [{
            role: "user",
            parts: [{
                text: `You are an expert HTML email developer. Convert this Mailchimp email into a clean, portable HTML email.

## Source Email Content:
${contentSummary}

## Image Asset Mappings:
${assetList}

## Original HTML (first 4000 chars):
\`\`\`html
${parsed.rawHtml.substring(0, 4000)}
\`\`\`

## REQUIREMENTS:
1. Use TABLE-based layout for email client compatibility
2. ALL styles must be INLINE
3. Max content width: 660px, centered
4. For EVERY image, REPLACE the src with the corresponding Mustache variable: src="{{variable_name}}"
5. Include proper email DOCTYPE and meta tags
6. Support dark mode with meta color-scheme
7. Include MSO conditionals for Outlook
8. Buttons use VML for Outlook + standard for others
9. Preserve ALL original links and CTAs
10. Match the original layout closely
11. Include {{unsubscribe_url}} and {{view_in_browser_url}} placeholders

CRITICAL: Every image src MUST use a Mustache variable. Do NOT use direct URLs.

Return ONLY the complete HTML email code starting with <!DOCTYPE html>.`,
            }],
        }],
    })
    return response?.text ?? ""
}

/**
 * Full generation with Claude only
 */
async function generateFullWithClaude(
    parsed: ParsedEmail,
    assetMappings: AssetMapping[],
    modelId: string = "claude-sonnet-4-20250514"
): Promise<string> {
    const contentSummary = generateContentSummary(parsed)
    const assetList = assetMappings.map((a) =>
        `- Original: "${a.originalName}" → Use: src="{{${a.variableName}}}"`
    ).join("\n")

    const response = await getAnthropic().messages.create({
        model: modelId,
        max_tokens: 8192,
        messages: [{
            role: "user",
            content: `You are an expert HTML email developer. Convert this Mailchimp email into a clean, portable HTML email.

## Source Email Content:
${contentSummary}

## Image Asset Mappings:
${assetList}

## Original HTML (first 4000 chars):
\`\`\`html
${parsed.rawHtml.substring(0, 4000)}
\`\`\`

## REQUIREMENTS:
1. Use TABLE-based layout for email client compatibility
2. ALL styles must be INLINE
3. Max content width: 660px, centered
4. For EVERY image, REPLACE the src with the corresponding Mustache variable: src="{{variable_name}}"
5. Include proper email DOCTYPE and meta tags
6. Support dark mode with meta color-scheme
7. Include MSO conditionals for Outlook
8. Buttons use VML for Outlook + standard for others
9. Preserve ALL original links and CTAs
10. Match the original layout closely
11. Include {{unsubscribe_url}} and {{view_in_browser_url}} placeholders

CRITICAL: Every image src MUST use a Mustache variable. Do NOT use direct URLs.

Return ONLY the complete HTML email code starting with <!DOCTYPE html>.`,
        }],
    })
    const textBlock = response.content.find((b: { type: string }) => b.type === "text") as { type: string; text: string } | undefined
    return textBlock?.text ?? ""
}

/**
 * Main pipeline: Parse → Generate with selected model(s)
 * Uses Mustache variables for images so the main app's AssetLoader sidebar works.
 */
export async function convertMailchimpToEmail(
    html: string,
    assetMappings: AssetMapping[],
    mode: "both" | "gemini" | "claude" = "both",
    geminiModel: string = "gemini-2.5-pro",
    claudeModel: string = "claude-sonnet-4-20250514"
): Promise<{ generatedHtml: string; contentMap: string }> {
    const parsed = parseMailchimpHtml(html)

    let rawOutput: string
    let contentMap = ""

    if (mode === "gemini") {
        rawOutput = await generateFullWithGemini(parsed, assetMappings, geminiModel)
    } else if (mode === "claude") {
        rawOutput = await generateFullWithClaude(parsed, assetMappings, claudeModel)
    } else {
        const contentMapRaw = await analyzeWithGemini(parsed, assetMappings, geminiModel)
        contentMap = contentMapRaw
        const jsonMatch = contentMapRaw.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (jsonMatch) {
            contentMap = jsonMatch[1].trim()
        }
        rawOutput = await generateWithClaude(contentMap, html, assetMappings, claudeModel)
    }

    // Clean up markdown wrapping
    let cleanHtml = rawOutput
    const htmlMatch = rawOutput.match(/```(?:html)?\s*([\s\S]*?)```/)
    if (htmlMatch) {
        cleanHtml = htmlMatch[1].trim()
    }

    return { generatedHtml: cleanHtml, contentMap }
}
