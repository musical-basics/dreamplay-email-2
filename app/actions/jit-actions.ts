"use server"

import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

/**
 * Generates a bespoke AI email draft and saves it as a campaign.
 * Does NOT send — waits for admin approval via the HITL workflow.
 * 
 * Returns the new campaign ID (the draft).
 */
export async function generateJITDraft(
    subscriberId: string,
    triggerContext: string
): Promise<{ campaignId: string } | { error: string }> {
    // 1. Fetch subscriber profile
    const { data: subscriber, error: subError } = await supabase
        .from("subscribers")
        .select("id, email, first_name, last_name, location_country, tags, smart_tags")
        .eq("id", subscriberId)
        .single()

    if (subError || !subscriber) {
        return { error: "Subscriber not found" }
    }

    const firstName = subscriber.first_name || "there"
    const country = subscriber.location_country || "Unknown"

    // 2. Fetch recent browsing events for context
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { data: events } = await supabase
        .from("subscriber_events")
        .select("type, url, metadata, created_at")
        .eq("subscriber_id", subscriberId)
        .gte("created_at", sevenDaysAgo.toISOString())
        .in("type", ["page_view", "session_end", "click"])
        .order("created_at", { ascending: false })
        .limit(10)

    const eventSummary = (events || [])
        .map(e => {
            const duration = e.metadata?.duration_seconds
            return `${e.type}: ${e.url}${duration ? ` (${duration}s)` : ""}`
        })
        .join("\n")

    // 3. Generate email copy via Claude
    const Anthropic = (await import("@anthropic-ai/sdk")).default
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        system: `You are Lionel Yu, founder of DreamPlay Pianos. You write warm, personal emails that feel like they come from a real person, not a marketing department. Never sound creepy or mention tracking, data, or browsing history. Keep it under 4 sentences. Write only the email body text (no subject line, no greeting, no sign-off). If the person is in Europe, mention that VAT/duties are handled and shipping is included.`,
        messages: [{
            role: "user",
            content: `Write a personal 1-to-1 email to ${firstName}. Their Country: ${country}. Recent behavior:\n${eventSummary}\nContext: ${triggerContext}`
        }]
    })

    const emailBody = (msg.content[0] as any).text || ""

    // 4. Wrap in minimal HTML
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://email.dreamplaypianos.com"
    const unsubscribeUrl = `${baseUrl}/unsubscribe?s=${subscriber.id}`

    const html = `<!DOCTYPE html>
<html>
<body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #333; line-height: 1.7;">
<p style="margin: 0 0 16px 0;">Hi ${firstName},</p>
${emailBody.split("\n").filter((l: string) => l.trim()).map((p: string) => `<p style="margin: 0 0 16px 0;">${p}</p>`).join("\n")}
<p style="margin: 24px 0 0 0; color: #666;">Best,<br>Lionel</p>
<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280;">
  <p style="margin: 0;">No longer want to receive these emails? <a href="${unsubscribeUrl}" style="color: #6b7280; text-decoration: underline;">Unsubscribe here</a>.</p>
</div>
</body>
</html>`

    // 5. Save as draft campaign
    const { data: campaign, error: insertError } = await supabase
        .from("campaigns")
        .insert({
            name: `AI Draft: ${triggerContext.slice(0, 60)} for ${subscriber.email}`,
            status: "draft",
            subject_line: `Quick note, ${firstName}`,
            html_content: html,
            variable_values: {
                subscriber_id: subscriberId,
                is_jit_draft: true,
                trigger_context: triggerContext,
                from_name: "Lionel Yu",
                from_email: "lionel@email.dreamplaypianos.com",
            },
        })
        .select()
        .single()

    if (insertError || !campaign) {
        return { error: insertError?.message || "Failed to create draft" }
    }

    return { campaignId: campaign.id }
}
