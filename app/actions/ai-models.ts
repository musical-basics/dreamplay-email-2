"use server"

import Anthropic from "@anthropic-ai/sdk";

export async function getAnthropicModels() {
    if (!process.env.ANTHROPIC_API_KEY) return []

    try {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const list = await anthropic.models.list();

        // Return just the IDs, sorted to put newer ones first (typically higher numbers/dates)
        return list.data
            .map(m => m.id)
            .filter(id => id.includes("claude")) // Ensure we only get Claude models
            .sort((a, b) => b.localeCompare(a));
    } catch (e) {
        console.error("Failed to fetch Anthropic models:", e);
        return [];
    }
}
