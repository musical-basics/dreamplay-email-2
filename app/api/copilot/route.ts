import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getAllContextForAudience, formatContextForPrompt } from "@/app/actions/settings";

// Allow up to 2 minutes for AI model response (prevents Vercel timeout → "Error: terminated")
export const maxDuration = 120;

// Initialize Admin Client (Service Key) to bypass RLS if needed
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

// Robust JSON extractor: finds the first '{' and last '}' to ignore chatty text
function extractJson(text: string) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
        return text.substring(start, end + 1);
    }
    return text; // Fallback
}

// Fallback: manually extract updatedHtml and explanation when JSON.parse fails
// This handles cases where the AI generates valid HTML but with characters that break JSON parsing
function manualExtractClassic(raw: string): { updatedHtml: string; explanation: string } | null {
    try {
        // Look for the HTML between "updatedHtml" key value markers
        // The AI typically outputs: "updatedHtml": "<!DOCTYPE html>..."  or  "updatedHtml": "<!doctype html>..."
        const htmlMatch = raw.match(/"updatedHtml"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"[a-zA-Z_]|\}$)/);

        // Also try to grab from <!DOCTYPE to </html> directly
        let html = '';
        if (htmlMatch) {
            html = htmlMatch[1]
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');
        } else {
            // Last resort: find raw HTML in the response
            const docMatch = raw.match(/(<!DOCTYPE html[\s\S]*?<\/html>)/i);
            if (docMatch) {
                html = docMatch[1];
            }
        }

        if (!html) return null;

        // Extract explanation
        const expMatch = raw.match(/"explanation"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
        const explanation = expMatch
            ? expMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
            : "Changes applied successfully.";

        return { updatedHtml: html, explanation };
    } catch {
        return null;
    }
}

// Helper: Download image from URL and convert to Base64
async function urlToBase64(url: string) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        const mediaType = response.headers.get('content-type') || 'image/jpeg';
        return { base64, mediaType };
    } catch (e) {
        console.error("Image fetch failed", e);
        return null;
    }
}

export async function POST(req: Request) {
    try {
        const { currentHtml, messages, model, audienceContext = "dreamplay", aiDossier = "", modelLow, modelMedium } = await req.json();

        // User-designated tier models (fallback to defaults)
        const tierLow = modelLow || "claude-haiku-4-5-20251001";
        const tierMedium = modelMedium || "claude-sonnet-4-6";

        // --- SMART ROUTER LOGIC ---
        let actualModel = model;
        let routingReason = "";

        if (model === "auto") {
            const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop();
            const hasImages = lastUserMessage?.imageUrls?.length > 0;
            const isEmpty = !currentHtml || currentHtml.trim() === "";

            if (isEmpty) {
                // Empty canvas always needs the stronger model (building from scratch)
                actualModel = tierMedium;
                routingReason = `New template from scratch → Medium (${tierMedium}).`;
            } else if (hasImages) {
                // Images present — vision tasks need the stronger model
                actualModel = tierMedium;
                routingReason = `Vision task (screenshot reference) → Medium (${tierMedium}).`;
            } else {
                // Text-only: fast classification using Gemini Flash
                try {
                    const { GoogleGenerativeAI } = await import("@google/generative-ai");
                    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
                    const flash = genAI.getGenerativeModel({
                        model: "gemini-2.0-flash",
                        generationConfig: { maxOutputTokens: 10, temperature: 0 }
                    });

                    const routerPrompt = `You are a routing agent for an email editor.
User request: "${lastUserMessage?.content}"
Is this a simple edit (changing text, fixing a typo, updating a color, swapping a link) or a complex edit (creating new layouts, adding new sections, structural redesign)?
Reply ONLY with the exact word "SIMPLE" or "COMPLEX".`;

                    const routerResult = await flash.generateContent(routerPrompt);
                    const intent = routerResult.response.text().trim().toUpperCase();

                    if (intent.includes("COMPLEX")) {
                        actualModel = tierMedium;
                        routingReason = `Complex structural edit → Medium (${tierMedium}).`;
                    } else {
                        actualModel = tierLow;
                        routingReason = `Simple text/style edit → Low (${tierLow}).`;
                    }
                } catch (e) {
                    actualModel = tierMedium;
                    routingReason = `Router fallback → Medium (${tierMedium}).`;
                }
            }
            console.log(`[Smart Router] ${routingReason} (model: ${actualModel})`);
        }
        // ------------------------------

        // 1. FETCH AUDIENCE-DRIVEN CONTEXT ⚡️
        const payload = await getAllContextForAudience(audienceContext);
        const { contextBlock: dynamicContext, linksBlock: defaultLinksBlock } = await formatContextForPrompt(payload, audienceContext);

        // 2. Process History: Convert ALL image URLs to Base64
        // We do this server-side so we don't hit the 4MB payload limit from the client.
        // We only keep the last 3 messages' images to save tokens/money, but we keep ALL text.
        const processedMessages = await Promise.all(messages.map(async (msg: any, index: number) => {
            const isRecent = index >= messages.length - 3; // Only keep images from last 3 messages

            let processedImages: any[] = [];

            if (isRecent && msg.imageUrls && msg.imageUrls.length > 0) {
                // Parallel download
                const downloads = await Promise.all(msg.imageUrls.map((url: string) => urlToBase64(url)));
                processedImages = downloads.filter(img => img !== null);
            }

            return {
                role: msg.role,
                content: msg.content,
                images: processedImages // Now contains { base64, mediaType }
            };
        }));

        const systemInstruction = `
    You are an expert Email HTML Developer.
    The user will give you HTML and a request.
    
    ### 🛑 CRITICAL INTEGRITY RULES:
    1. **NEVER DELETE CONTENT:** Unless explicitly asked to remove something, you must PRESERVE ALL existing sections, text, images, and structure. The user's screenshot may show only ONE section, but you MUST return the ENTIRE email.
    2. **ALWAYS RETURN THE COMPLETE HTML DOCUMENT** starting with <!DOCTYPE html> and ending with </html>. Include EVERY section from the original HTML, even if the user's edit only affects one small part. If you return partial HTML, the entire email will be overwritten and the user will lose their work.
    3. **EDITING TEXT = FULL HTML:** Even for small text changes, return the full HTML document with only the requested text modified and everything else preserved exactly.
    
    ### CODING STANDARDS:
    1. **LAYOUT:** Use HTML <table>, <tr>, <td> for structure. No Flexbox/Grid.
    2. **WIDTHS:** Explicitly set width="100%" or specific pixels.
    3. **VARIABLES:** Preserve {{mustache_vars}}.
    4. **IMAGE VARIABLES:** When adding images with {{mustache}} variables, the variable name MUST end with one of these suffixes: _src, _bg, _logo, _icon, _img — or contain the word "image" or "url". For example: {{hero_src}}, {{product_bg}}, {{banner_img}}. This ensures the Asset Loader recognizes them as images and shows the upload button. Additionally, ALWAYS wrap the image in a clickable link using a corresponding _link_url variable. For example: <a href="{{hero_link_url}}"><img src="{{hero_src}}" /></a>. This lets the user set the link destination in the Asset Loader.
    5. **NO EM-DASHES:** Never use em-dashes (—) in any copy or text you write. Use commas, periods, or semicolons instead.
    6. **READABLE COPY FORMATTING:** When writing or editing paragraph text/copy, add sparse inline formatting to improve scannability. Use \`<strong>\` to bold 1-2 key value propositions or outcomes per paragraph (the phrases you want the reader to remember). Use \`<u>\` to underline one supporting detail or benefit phrase per paragraph. Don't overdo it: most sentences should remain unformatted. The goal is to let a skimming reader grasp the main points from the bold text alone.
    
    ### TEMPLATE CREATION DEFAULTS:
    When asked to create a NEW email template from scratch or from a reference image:
    - All text/copy MUST be hardcoded directly in the HTML (not mustache variables). Write the actual words into the template.
    - All image sources (src) MUST use {{mustache_variable}} names (e.g. {{hero_src}}, {{product_img}}).
    - All links (href on <a> tags) MUST use {{mustache_variable}} names (e.g. {{main_cta_url}}, {{hero_link_url}}).
    - **IMPORTANT CTA URL NAMING:** The PRIMARY call-to-action link MUST always use {{main_cta_url}}. If there is only one CTA button, use {{main_cta_url}}. If there are multiple CTA buttons pointing to the SAME destination, they should ALL use {{main_cta_url}}. Only create additional URL variables (e.g. {{secondary_cta_url}}) when different buttons genuinely link to DIFFERENT pages. This ensures discount codes auto-attach correctly.
    - This means the user only needs to load assets (images + links) via the Asset Loader, while the text is baked into the HTML.
    
    ### RESPONSE FORMAT (STRICT JSON ONLY):
    You MUST return ONLY a valid JSON object. Do not include any conversational text before or after the JSON.
    {
      "_thoughts": "Think step-by-step about what needs to be changed. Explain your math or logic here before writing the code.",
      "explanation": "A brief, friendly summary of changes for the user interface",
      "updatedHtml": "<!DOCTYPE html>\n<html>...</html>"
    }
    
    ### CRITICAL: QUESTION vs EDIT DETECTION:
    If the user is asking a QUESTION, requesting SUGGESTIONS, brainstorming ideas, or anything that does NOT require modifying the HTML:
    - Set "updatedHtml" to the EXACT ORIGINAL HTML unchanged (copy it character-for-character)
    - Put your full answer/suggestions in the "explanation" field
    - Do NOT replace the HTML with text responses, lists, or suggestions
    Examples of questions (DO NOT modify HTML): "suggest subject lines", "what do you think of this copy", "come up with alternatives", "how can I improve", "give me ideas"
    Examples of edits (DO modify HTML): "change the title to X", "make the button red", "add a new section"
    
    ### REFERENCE TEMPLATE / STYLE-ONLY EDITS:
    When the user's message contains "[STYLE REFERENCE ATTACHED — CONTENT PRESERVATION MODE]", they want to RE-STYLE the existing email using a different template's visual design while keeping content identical. In this mode:
    - **Preserve ALL original text VERBATIM** — do not rewrite, rephrase, add, or remove any text/copy
    - **Preserve ALL original image src URLs exactly** — do not change, rename, or generate new image paths
    - **Preserve ALL original link href URLs** — do not modify any link destinations
    - **ONLY change:** CSS styles, table layout structure, background colors, font families/sizes/weights, padding, spacing, border styles, button styling, section ordering/layout
    - Think of it as "pouring the existing content into a new visual container"
    
    ### REFERENCE TEMPLATE / ADJUST MODE:
    When the user's message contains "[STYLE REFERENCE ATTACHED — ADJUST MODE]", they want to apply the reference style AND modify content according to their instructions. In this mode:
    - Apply the reference template's visual style (layout, colors, fonts, spacing, backgrounds, button styling)
    - Keep existing image src URLs wherever possible — do not invent new image paths
    - You MAY rewrite, add, remove, or rephrase text content as the user's instruction requires
    - You MAY add or remove sections if requested
    - Balance the reference style with the content changes the user asks for
    
    ### COMPANY CONTEXT:
    ${dynamicContext}
    ${defaultLinksBlock}
${aiDossier ? `
    ### AUDIENCE INTELLIGENCE:
    ${aiDossier}
` : ""}
    `;

        let rawResponse = "";
        let usageMeta = { model: actualModel, inputTokens: 0, outputTokens: 0, cost: 0 };

        // Pricing per million tokens
        const PRICING: Record<string, { input: number; output: number }> = {
            "claude-3-5-haiku-latest": { input: 0.80, output: 4.00 },
            "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
            "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
            "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
        };

        // --- A. CLAUDE (Anthropic) ---
        if (actualModel.includes("claude")) {
            const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

            const anthropicMessages = processedMessages.map((msg: any) => {
                const role = (msg.role === 'result' ? 'assistant' : 'user') as "assistant" | "user";
                let content: any[] = [];

                // Add Images & Documents (PDFs)
                if (msg.images) {
                    msg.images.forEach((img: any) => {
                        const isPdf = img.mediaType === 'application/pdf';
                        content.push({
                            type: isPdf ? "document" : "image",
                            source: {
                                type: "base64",
                                media_type: img.mediaType,
                                data: img.base64
                            }
                        });
                    });
                }

                // Add Text
                if (msg.content) content.push({ type: "text", text: msg.content });

                return { role, content };
            });

            // Append Context to Last Message
            const lastMsg = anthropicMessages[anthropicMessages.length - 1];
            if (lastMsg.role === 'user') {
                lastMsg.content.push({ type: "text", text: `\n\n### CURRENT HTML:\n${currentHtml}` });
            }

            const stream = anthropic.messages.stream({
                model: actualModel,
                max_tokens: 32768,
                temperature: 0,
                system: systemInstruction,
                messages: anthropicMessages
            });

            const msg = await stream.finalMessage();

            const textBlock = msg.content[0];
            if (textBlock.type === 'text') rawResponse = textBlock.text;

            // Track usage
            if (msg.usage) {
                usageMeta.inputTokens = msg.usage.input_tokens;
                usageMeta.outputTokens = msg.usage.output_tokens;
                const pricing = PRICING[actualModel] || { input: 3, output: 15 };
                usageMeta.cost = (msg.usage.input_tokens / 1_000_000 * pricing.input) + (msg.usage.output_tokens / 1_000_000 * pricing.output);
            }
        }

        // --- B. GEMINI (Google) ---
        else {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
            const geminiModel = genAI.getGenerativeModel({
                model: "gemini-1.5-pro",
                generationConfig: { responseMimeType: "application/json" }
            });

            const geminiHistory = processedMessages.map((msg: any) => {
                const role = msg.role === 'result' ? 'model' : 'user';
                const parts = [];

                if (msg.images) {
                    msg.images.forEach((img: any) => {
                        parts.push({
                            inlineData: {
                                mimeType: img.mediaType,
                                data: img.base64
                            }
                        });
                    });
                }

                if (msg.content) parts.push({ text: msg.content });
                return { role, parts };
            });

            const lastMsg = geminiHistory[geminiHistory.length - 1];
            lastMsg.parts.push({ text: `\n\n### CURRENT HTML:\n${currentHtml}` });

            // Inject system instruction into first message
            if (geminiHistory.length > 0) {
                const firstPart = geminiHistory[0].parts[0];
                if (firstPart.text) {
                    firstPart.text = `${systemInstruction}\n\n${firstPart.text}`;
                } else {
                    geminiHistory[0].parts.unshift({ text: systemInstruction });
                }
            }

            const result = await geminiModel.generateContent({ contents: geminiHistory });
            rawResponse = result.response.text();
        }

        // --- PARSE ---
        try {
            const cleaned = extractJson(rawResponse);
            const parsed = JSON.parse(cleaned);

            parsed.meta = usageMeta;

            if (routingReason) {
                parsed.explanation = `*(⚡️ ${routingReason})*\n\n` + (parsed.explanation || "");
            }

            return NextResponse.json(parsed);
        } catch (e: any) {
            console.error("JSON Parse Error:", e.message);
            console.error("Raw response preview (first 500 chars):", rawResponse.substring(0, 500));
            // Fallback: try to manually extract HTML and explanation
            const fallback = manualExtractClassic(rawResponse);
            if (fallback) {
                console.log("Recovered via manual extraction fallback");
                return NextResponse.json(fallback);
            }
            return NextResponse.json({
                updatedHtml: currentHtml,
                explanation: "I successfully generated the code, but my output formatting broke. Please try asking me again!"
            });
        }

    } catch (error: any) {
        console.error("API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
