// lib/chains/sender.ts
// sendChainEmail is a thin wrapper that creates a named child campaign from
// the template, then delegates ALL send logic to /api/send-stream (the single
// source of truth for image proxying, video overlay, CSS inlining, merge tags,
// tracking, open pixel, Resend, and history insertion).

import { createClient } from "@supabase/supabase-js";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://email.dreamplaypianos.com";

export async function sendChainEmail(
    subscriberId: string,
    email: string,
    firstName: string,
    templateKeyOrId: string,
    clickTracking = false,
    openTracking = true,
    resendClickTracking = false,
    resendOpenTracking = false,
    chainName?: string, // used for child campaign naming: "Email — Chain: Onboarding (John)"
) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY!
    );

    // 1. Fetch the template campaign
    const { data: template, error } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", templateKeyOrId)
        .single();

    if (error || !template) {
        console.error("Chain: Failed to load template:", templateKeyOrId, error);
        return { success: false, campaignId: "", error: "Template not found" };
    }

    // 2. Create a named child campaign so this send is tracked separately
    //    (master templates have is_template=true which the Completed tab filters out)
    const childName = chainName
        ? `${template.name} — Chain: ${chainName} (${firstName || email})`
        : template.name;

    const { data: child, error: childError } = await supabase
        .from("campaigns")
        .insert({
            name: childName,
            subject_line: template.subject_line,
            html_content: template.html_content,
            status: "draft",
            is_template: false,
            parent_template_id: templateKeyOrId,
            workspace: template.workspace,
            variable_values: (() => {
                const { subscriber_id, subscriber_ids, ...rest } = template.variable_values || {};
                return rest;
            })(),
        })
        .select("id")
        .single();

    if (childError || !child) {
        console.error("Chain: Failed to create child campaign:", childError);
        return { success: false, campaignId: "", error: "Failed to create child campaign" };
    }

    // 3. Delegate to /api/send-stream — single source of truth for all send logic
    //    (proxyEmailImages, addPlayButtonsToVideoThumbnails, inlineStyles, merge tags,
    //     click/open tracking, Resend send, sent_history insert, campaign status update)
    const response = await fetch(`${baseUrl}/api/send-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            campaignId: child.id,
            overrideSubscriberIds: [subscriberId],
            fromName: template.variable_values?.from_name || null,
            fromEmail: template.variable_values?.from_email || null,
            clickTracking,
            openTracking,
            resendClickTracking,
            resendOpenTracking,
        }),
    });

    // Consume the NDJSON stream fully and parse the final summary line
    const text = await response.text();
    const lines = text.trim().split("\n").filter(Boolean);
    const lastLine = lines[lines.length - 1];

    try {
        const parsed = JSON.parse(lastLine);
        if (parsed.done) {
            const sent = parsed.stats?.sent ?? 0;
            return { success: sent > 0, campaignId: child.id };
        }
    } catch { /* fall through */ }

    if (!response.ok) {
        console.error("Chain: send-stream failed:", text.slice(0, 300));
        return { success: false, campaignId: child.id, error: `send-stream failed` };
    }

    return { success: true, campaignId: child.id };
}

/**
 * JIT AI Email Sender — generates a bespoke 1:1 email using Claude,
 * sends via Resend, and logs a jit_email_sent event.
 */
export async function generateAndSendJITEmail(subscriberId: string, contextPrompt: string) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY!
    );

    // 1. Fetch subscriber profile
    const { data: subscriber, error } = await supabase
        .from("subscribers")
        .select("id, email, first_name, last_name, location_country, tags, smart_tags")
        .eq("id", subscriberId)
        .eq("status", "active")
        .single();

    if (error || !subscriber) {
        console.error("JIT: Subscriber not found or inactive:", subscriberId);
        return { success: false, error: "Subscriber not found" };
    }

    const firstName = subscriber.first_name || "there";
    const country = subscriber.location_country || "Unknown";

    // 2. Generate email copy via Claude
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const msg = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 400,
        system: `You are Lionel Yu, founder of DreamPlay Pianos. You write warm, personal emails that feel like they come from a real person, not a marketing department. Never sound creepy, never mention tracking or data. Keep it under 4 sentences. Write only the email body text, no subject line.`,
        messages: [{
            role: "user",
            content: `Write a personal 1-to-1 email to ${firstName}. Context: ${contextPrompt}. Their Country: ${country}.`
        }]
    });

    const emailBody = (msg.content[0] as any).text || "";

    // 3. Wrap in HTML
    const unsubscribeUrl = `${baseUrl}/unsubscribe?s=${subscriber.id}`;
    const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #333; line-height: 1.7;">
${emailBody.split("\n").filter((l: string) => l.trim()).map((p: string) => `<p style="margin: 0 0 16px 0;">${p}</p>`).join("\n")}
<p style="margin: 24px 0 0 0; color: #666;">Best,<br>Lionel</p>
<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280;">
  <p style="margin: 0;">No longer want to receive these emails? <a href="${unsubscribeUrl}" style="color: #6b7280; text-decoration: underline;">Unsubscribe here</a>.</p>
</div>
</body>
</html>`;

    // 4. Send via Resend (disable Resend's tracking — we use our own)
    const sendResult = await resend.emails.send({
        from: "Lionel Yu <lionel@email.dreamplaypianos.com>",
        to: subscriber.email,
        subject: `Quick note, ${firstName}`,
        html,
        headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        click_tracking: false,
        open_tracking: false,
    } as any);

    if (sendResult.error) {
        console.error("JIT send error:", sendResult.error);
        return { success: false, error: sendResult.error.message };
    }

    // 5. Log the JIT send event
    await supabase.from("subscriber_events").insert({
        subscriber_id: subscriberId,
        type: "sent",
        metadata: { chain: "jit", context: contextPrompt.slice(0, 200) },
    });

    return { success: true, email: subscriber.email };
}
