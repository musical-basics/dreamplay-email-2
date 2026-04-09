import { NextResponse } from "next/server";

export async function GET() {
    const results: any = {
        google: [],
        anthropic: [],
        errors: []
    };

    // 1. Ping Google (Gemini)
    try {
        const googleKey = process.env.GEMINI_API_KEY;
        if (googleKey) {
            // Google exposes a REST endpoint to list models
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${googleKey}`
            );
            const data = await response.json();
            // Filter only for "generateContent" models (chat models)
            results.google = data.models
                ?.filter((m: any) => m.supportedGenerationMethods.includes("generateContent"))
                .map((m: any) => m.name.replace("models/", "")) // Clean up the name
                .sort();
        } else {
            results.errors.push("Missing GEMINI_API_KEY");
        }
    } catch (e: any) {
        results.errors.push(`Google Error: ${e.message}`);
    }

    // 2. Ping Anthropic (Claude)
    try {
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        if (anthropicKey) {
            const response = await fetch("https://api.anthropic.com/v1/models", {
                headers: {
                    "x-api-key": anthropicKey,
                    "anthropic-version": "2023-06-01"
                }
            });
            const data = await response.json();
            results.anthropic = data.data?.map((m: any) => m.id).sort();
        } else {
            results.errors.push("Missing ANTHROPIC_API_KEY");
        }
    } catch (e: any) {
        results.errors.push(`Anthropic Error: ${e.message}`);
    }

    return NextResponse.json(results);
}
