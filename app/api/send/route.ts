import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { renderTemplate } from "@/lib/render-template";
import { applyAllMergeTags } from "@/lib/merge-tags";
import { injectPreheader } from "@/lib/email-preheader";
import { inlineStyles } from "@/lib/email-inline-styles";

const resend = new Resend(process.env.RESEND_API_KEY);

// Admin client for data fetching (bypassing RLS for campaign data)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

/**
 * /api/send — TEST SENDS ONLY
 *
 * Only handles type: "test" (sends to a given email address with simulated
 * subscriber data for preview purposes). Does NOT do tracking, history, or
 * image proxying — this is intentional for previews.
 *
 * For everything else:
 *   - Broadcast send  → POST /api/send-stream (type omitted / "broadcast")
 *   - Schedule        → POST /api/send-stream (type: "schedule")
 *   - Cancel schedule → POST /api/send-stream (type: "cancel_schedule")
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { campaignId, type, email, fromName, fromEmail, resendClickTracking = false, resendOpenTracking = false } = body;

        if (type !== "test") {
            return NextResponse.json({
                error: "Only type: 'test' is handled here. Use /api/send-stream for broadcast, schedule, and cancel_schedule."
            }, { status: 400 });
        }

        if (!email) return NextResponse.json({ error: "Test email required" }, { status: 400 });

        // Fetch campaign
        const { data: campaign, error: campaignError } = await supabaseAdmin
            .from("campaigns")
            .select("*")
            .eq("id", campaignId)
            .single();

        if (campaignError || !campaign) {
            return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
        }

        // Render global template variables (exclude per-subscriber vars)
        const subscriberVars = ["first_name", "last_name", "email", "unsubscribe_url", "unsubscribe_link_url", "unsubscribe_link"];
        const globalAssets = Object.fromEntries(
            Object.entries(campaign.variable_values || {}).filter(([key]) => !subscriberVars.includes(key))
        ) as Record<string, string>;
        let htmlContent = renderTemplate(campaign.html_content || "", globalAssets);
        htmlContent = injectPreheader(htmlContent, campaign.variable_values?.preview_text);
        htmlContent = inlineStyles(htmlContent);
        // Note: proxyEmailImages intentionally skipped for test sends (we want to see originals)

        // Simulate subscriber for merge tags
        let simulationSubscriber = null;
        const lockedSubscriberId = campaign.variable_values?.subscriber_id;
        if (lockedSubscriberId) {
            const { data } = await supabaseAdmin.from("subscribers").select("*").eq("id", lockedSubscriberId).single();
            simulationSubscriber = data;
        } else {
            const { data } = await supabaseAdmin.from("subscribers").select("*").eq("status", "active").limit(1).single();
            simulationSubscriber = data;
        }

        if (simulationSubscriber) {
            htmlContent = await applyAllMergeTags(htmlContent, simulationSubscriber);
            // Append sid to links for click inspection during preview
            htmlContent = htmlContent.replace(/href=(["'])(https?:\/\/[^"']+)\1/g, (match, quote, url) => {
                if (url.includes("/unsubscribe")) return match;
                try {
                    const parsed = new URL(url);
                    parsed.searchParams.set("sid", simulationSubscriber.id);
                    return `href=${quote}${parsed.toString()}${quote}`;
                } catch {
                    const sep = url.includes("?") ? "&" : "?";
                    return `href=${quote}${url}${sep}sid=${simulationSubscriber.id}${quote}`;
                }
            });
        } else {
            htmlContent = htmlContent
                .replace(/{{first_name}}/g, "[Test Name]")
                .replace(/{{email}}/g, "test@example.com")
                .replace(/{{subscriber_id}}/g, "test-subscriber-id");
        }

        // Test footer (uses # for unsubscribe link since this is a preview)
        htmlContent += `
<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; font-family: sans-serif;">
  <p style="margin: 0;">No longer want to receive these emails? <a href="#" style="color: #6b7280; text-decoration: underline;">Unsubscribe here</a>.</p>
</div>`;

        const subject = simulationSubscriber
            ? await applyAllMergeTags(campaign.subject_line || "", simulationSubscriber)
            : campaign.subject_line;

        console.log("🚀 Sending test email to:", email);
        const { data, error } = await resend.emails.send({
            from: fromName && fromEmail
                ? `${fromName} <${fromEmail}>`
                : (process.env.RESEND_FROM_EMAIL || "DreamPlay <hello@email.dreamplaypianos.com>"),
            to: email,
            subject: `[TEST] ${subject}`,
            html: htmlContent,
            click_tracking: resendClickTracking,
            open_tracking: resendOpenTracking,
        } as any);

        if (error) {
            console.error("❌ Test send failed:", JSON.stringify(error, null, 2));
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, data });

    } catch (error: any) {
        console.error("Server Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}