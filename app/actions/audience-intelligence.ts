"use server"

import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

interface SmartTags {
    engagement?: "high" | "medium" | "low"
    intents?: string[]
    region?: string
}

/**
 * Generates a plain-English AI dossier for the Copilot based on the campaign's
 * targeting context and the subscriber's behavioral Smart Tags.
 * 
 * Returns a string that gets injected into the system instruction.
 */
export async function getCampaignDossier(campaignId: string, workspace: string): Promise<string> {
    if (!campaignId) return ""

    // Fetch campaign
    const { data: campaign } = await supabase
        .from("campaigns")
        .select("variable_values")
        .eq("id", campaignId)
        .eq("workspace", workspace)
        .single()

    if (!campaign) return ""

    const variableValues = campaign.variable_values || {}
    const subscriberId = variableValues.subscriber_id
    const targetTag = variableValues.target_tag

    // ─── CASE 1: 1-on-1 Email ─────────────────────────
    if (subscriberId) {
        const { data: subscriber } = await supabase
            .from("subscribers")
            .select("smart_tags, tags, first_name, location_country")
            .eq("id", subscriberId)
            .eq("workspace", workspace)
            .single()

        if (!subscriber) return ""

        const smartTags: SmartTags = subscriber.smart_tags || {}
        const manualTags: string[] = subscriber.tags || []
        const lines: string[] = []

        lines.push(`You are writing a 1-on-1 email to ${subscriber.first_name || "this subscriber"}.`)

        // Engagement
        if (smartTags.engagement) {
            const toneMap: Record<string, string> = {
                high: "This is a highly engaged subscriber who opens and clicks frequently. Use an enthusiastic, insider tone — they're already a fan.",
                medium: "This subscriber has moderate engagement. Be warm but direct — give them a reason to engage more.",
                low: "This subscriber has low engagement. Lead with a strong hook or exclusive offer to re-capture their attention.",
            }
            lines.push(toneMap[smartTags.engagement])
        }

        // Intents
        if (smartTags.intents && smartTags.intents.length > 0) {
            lines.push("CRITICAL BEHAVIORAL SIGNALS:")
            if (smartTags.intents.includes("customize")) {
                lines.push("- They spent significant time on the /customize page. Emphasize the upcoming PRICE INCREASE and the value of customization options. Create urgency.")
            }
            if (smartTags.intents.includes("shipping")) {
                lines.push("- They browsed the /shipping page. Reassure them about FREE SHIPPING and fast delivery. Address any logistics concerns proactively.")
            }
        }

        // Region
        if (smartTags.region === "europe") {
            lines.push("GEOGRAPHIC CONTEXT: This subscriber is in Europe. Mention that VAT/duties are handled, use metric measurements if relevant, and ensure pricing language accounts for international shipping.")
        }

        // Manual tags
        if (manualTags.length > 0) {
            lines.push(`Manual Tags: ${manualTags.join(", ")}`)
        }

        return lines.join("\n")
    }

    // ─── CASE 2: Tag-Targeted Broadcast ────────────────
    if (targetTag) {
        return [
            `You are writing a broadcast email to the "${targetTag}" segment.`,
            `Tailor the messaging to address this segment's specific interests.`,
            `If targeting a skill level (e.g., Beginner, Advanced), adjust the complexity and tone accordingly.`,
            `If targeting a product interest (e.g., Piano, Theory), focus the content on that topic.`,
        ].join("\n")
    }

    // ─── CASE 3: General Broadcast ─────────────────────
    return ""
}
