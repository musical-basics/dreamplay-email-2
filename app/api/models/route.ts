import { NextResponse } from "next/server"

interface ModelInfo {
    id: string
    name: string
    provider: "gemini" | "anthropic"
}

export async function GET() {
    const models: ModelInfo[] = []

    // Fetch Gemini models
    try {
        const geminiKey = process.env.GEMINI_API_KEY
        if (geminiKey) {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`,
                { next: { revalidate: 3600 } }
            )
            if (res.ok) {
                const data = await res.json()
                const geminiModels = (data.models || [])
                    .filter((m: { name: string; supportedGenerationMethods?: string[] }) => {
                        const name = m.name.replace("models/", "")
                        return (
                            m.supportedGenerationMethods?.includes("generateContent") &&
                            (name.includes("gemini-2") || name.includes("gemini-1.5")) &&
                            !name.includes("tuning") &&
                            !name.includes("embedding") &&
                            !name.toLowerCase().includes("tts") &&
                            !name.toLowerCase().includes("image-generation") &&
                            !name.toLowerCase().includes("nano") &&
                            !name.toLowerCase().includes("computer-use")
                        )
                    })
                    .map((m: { name: string; displayName?: string }) => ({
                        id: m.name.replace("models/", ""),
                        name: m.displayName || m.name.replace("models/", ""),
                        provider: "gemini" as const,
                    }))
                    .sort((a: ModelInfo, b: ModelInfo) => b.id.localeCompare(a.id))

                models.push(...geminiModels)
            }
        }
    } catch (err) {
        console.error("Failed to fetch Gemini models:", err)
    }

    // Fetch Anthropic models
    try {
        const anthropicKey = process.env.ANTHROPIC_API_KEY
        if (anthropicKey) {
            const res = await fetch("https://api.anthropic.com/v1/models", {
                headers: {
                    "x-api-key": anthropicKey,
                    "anthropic-version": "2023-06-01",
                },
                next: { revalidate: 3600 },
            })
            if (res.ok) {
                const data = await res.json()
                const anthropicModels = (data.data || [])
                    .filter((m: { id: string }) => {
                        return m.id.includes("claude") && !m.id.includes("instant")
                    })
                    .map((m: { id: string; display_name?: string }) => ({
                        id: m.id,
                        name: m.display_name || m.id,
                        provider: "anthropic" as const,
                    }))
                    .sort((a: ModelInfo, b: ModelInfo) => b.id.localeCompare(a.id))

                models.push(...anthropicModels)
            }
        }
    } catch (err) {
        console.error("Failed to fetch Anthropic models:", err)
    }

    return NextResponse.json({ models })
}
