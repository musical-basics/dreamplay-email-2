import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getAllContextForAudience, formatContextForPrompt } from "@/app/actions/settings";
import { VARIABLE_RULES_PROMPT } from "@/lib/variable-rules";

// Allow up to 2 minutes for AI model response (prevents Vercel timeout → "Error: terminated")
export const maxDuration = 120;

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

// Block type schema for the AI prompt
const BLOCK_SCHEMA = `
You MUST return blocks as a JSON array. Each block has this shape:
{ "id": "<unique-string>", "type": "<block_type>", "props": { ... } }

VALID BLOCK TYPES AND THEIR PROPS:

1. "heading" — { text: string, level: "h1"|"h2"|"h3", alignment: "left"|"center"|"right", color: "#hex", fontFamily: "Arial, Helvetica, sans-serif" }
2. "text" — { text: string, alignment: "left"|"center"|"right", color: "#hex", fontSize: number(px), lineHeight: number }
3. "image" — { src: "{{mustache_var}}", alt: string, width: number(px, max 600), height: "auto"|number, linkUrl: "{{mustache_var}}", alignment: "left"|"center"|"right" }
4. "button" — { text: string, url: "{{mustache_var}}", bgColor: "#hex", textColor: "#hex", borderRadius: number, alignment: "left"|"center"|"right", fullWidth: boolean, fontSize: number, paddingX: number, paddingY: number }
5. "divider" — { color: "#hex", thickness: number, widthPercent: number(0-100), style: "solid"|"dashed"|"dotted" }
6. "spacer" — { height: number(px) }
7. "social" — { networks: [{ platform: "facebook"|"instagram"|"twitter"|"youtube"|"linkedin"|"tiktok", url: string }], alignment: "left"|"center"|"right", iconSize: number }

RULES:
- All image src values MUST follow the image variable naming rules below.
- All link URLs MUST be mustache variables like {{main_cta_url}}, {{hero_link_url}}
- **IMPORTANT CTA URL NAMING:** The PRIMARY call-to-action link MUST always use {{main_cta_url}}.
- All text/copy MUST be hardcoded (NOT mustache variables)
- Generate unique IDs for each block (e.g. "block-heading-1", "block-text-1")
- NO EM-DASHES in any text

${VARIABLE_RULES_PROMPT}
`;

export async function POST(req: Request) {
    try {
        const { currentBlocks, messages, model, audienceContext = "dreamplay", aiDossier = "" } = await req.json();

        // --- SMART ROUTER LOGIC ---
        let actualModel = model;
        let routingReason = "";

        if (model === "auto") {
            const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop();
            const hasImages = lastUserMessage?.imageUrls?.length > 0;
            const isEmpty = !currentBlocks || currentBlocks.length === 0;

            if (isEmpty) {
                actualModel = "claude-sonnet-4-20250514";
                routingReason = "New template from scratch → Sonnet.";
            } else if (hasImages) {
                actualModel = "claude-sonnet-4-20250514";
                routingReason = "Vision task (screenshot reference) → Sonnet.";
            } else {
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
                        actualModel = "claude-sonnet-4-20250514";
                        routingReason = "Complex structural edit → Sonnet.";
                    } else {
                        actualModel = "claude-3-5-haiku-latest";
                        routingReason = "Simple text/style edit → Haiku.";
                    }
                } catch (e) {
                    actualModel = "claude-sonnet-4-20250514";
                    routingReason = "Router fallback → Sonnet.";
                }
            }
            console.log(`[Smart Router DnD] ${routingReason} (model: ${actualModel})`);
        }
        // ------------------------------

        // Fetch audience-driven context
        const payload = await getAllContextForAudience(audienceContext);
        const { contextBlock: dynamicContext, linksBlock: defaultLinksBlock } = await formatContextForPrompt(payload, audienceContext);

        // Process images in messages
        const processedMessages = await Promise.all(messages.map(async (msg: any, index: number) => {
            const isRecent = index >= messages.length - 3;
            let processedImages: any[] = [];
            if (isRecent && msg.imageUrls && msg.imageUrls.length > 0) {
                const downloads = await Promise.all(msg.imageUrls.map((url: string) => urlToBase64(url)));
                processedImages = downloads.filter(img => img !== null);
            }
            return { role: msg.role, content: msg.content, images: processedImages };
        }));

        const systemInstruction = `
You are an expert Email Template Designer that builds emails using a BLOCK-BASED system.
The user will describe what they want, and you return a structured array of blocks.

${BLOCK_SCHEMA}

### RESPONSE FORMAT (STRICT JSON ONLY):
You MUST return ONLY a valid JSON object. Do not include any conversational text before or after the JSON.
{ 
  "_thoughts": "Think step-by-step about the blocks you need to create/modify.",
  "explanation": "A brief summary of what you created/changed", 
  "blocks": [ ...array of block objects... ] 
}

### COMPANY CONTEXT:
${dynamicContext}
${defaultLinksBlock}

### CURRENT BLOCKS:
${JSON.stringify(currentBlocks, null, 2)}

When modifying existing blocks:
- PRESERVE all blocks that the user did not ask to change
- Use the same IDs for unchanged blocks
- Generate new IDs for new blocks
When creating from scratch, build a complete email with appropriate sections.
${aiDossier ? `
### AUDIENCE INTELLIGENCE:
${aiDossier}
` : ""}
`;

        let rawResponse = "";

        if (actualModel.includes("claude")) {
            const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

            const anthropicMessages = processedMessages.map((msg: any) => {
                const role = (msg.role === 'result' ? 'assistant' : 'user') as "assistant" | "user";
                let content: any[] = [];

                if (msg.images) {
                    msg.images.forEach((img: any) => {
                        const isPdf = img.mediaType === 'application/pdf';
                        content.push({
                            type: isPdf ? "document" : "image",
                            source: { type: "base64", media_type: img.mediaType, data: img.base64 }
                        });
                    });
                }

                if (msg.content) content.push({ type: "text", text: msg.content });
                return { role, content };
            });

            const msg = await anthropic.messages.create({
                model: actualModel,
                max_tokens: 32768,
                temperature: 0,
                system: systemInstruction,
                messages: anthropicMessages
            });

            const textBlock = msg.content[0];
            if (textBlock.type === 'text') rawResponse = textBlock.text;
        } else {
            // Gemini fallback — use same structure
            const { GoogleGenerativeAI } = await import("@google/generative-ai");
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
                        parts.push({ inlineData: { mimeType: img.mediaType, data: img.base64 } });
                    });
                }
                if (msg.content) parts.push({ text: msg.content });
                return { role, parts };
            });

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

            if (routingReason) {
                parsed.explanation = `*(⚡️ ${routingReason})*\n\n` + (parsed.explanation || "");
            }

            return NextResponse.json(parsed);
        } catch (e: any) {
            console.error("JSON Parse Error:", e.message);
            return NextResponse.json({
                blocks: currentBlocks,
                explanation: "I successfully generated the blocks, but my output formatting broke. Please try asking me again!"
            });
        }

    } catch (error: any) {
        console.error("DnD Copilot API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
