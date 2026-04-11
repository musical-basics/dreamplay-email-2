// lib/chains/sender.ts
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { renderTemplate } from "@/lib/render-template";
import { createShopifyDiscount } from "@/app/actions/shopify-discount";
import { applyAllMergeTags } from "@/lib/merge-tags";
import { injectPreheader } from "@/lib/email-preheader";
import { inlineStyles } from "@/lib/email-inline-styles";
import { getDefaultLinks } from "@/app/actions/settings";
import { proxyEmailImages } from "@/lib/image-proxy";

const resend = new Resend(process.env.RESEND_API_KEY);
const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://email.dreamplaypianos.com";

export async function sendChainEmail(subscriberId: string, email: string, firstName: string, templateKeyOrId: string, clickTracking = false, openTracking = true, resendClickTracking = false, resendOpenTracking = false) {
    let rawHtml = "";
    let subject = "";
    let campaignId = "";
    let templateFromName = "";
    let templateFromEmail = "";
    let templateVariableValues: Record<string, any> | null = null;

    // Dynamic Database Template — templateKeyOrId is a campaign UUID
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY!
    );
    const { data: dbTemplate, error } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", templateKeyOrId)
        .single();

    if (error || !dbTemplate) {
        console.error("Failed to load template for chain:", templateKeyOrId, error);
        return { success: false, campaignId: "", error: "Template not found" };
    }

    const vars: Record<string, string> = {
        ...dbTemplate.variable_values,
        first_name: firstName || "there",
        email: email,
    };
    rawHtml = renderTemplate(dbTemplate.html_content || "", vars);
    rawHtml = await proxyEmailImages(rawHtml); // snapshot external images → permanent Supabase URLs
    rawHtml = injectPreheader(rawHtml, dbTemplate.variable_values?.preview_text);
    // Inline CSS class styles into element style attributes (Gmail strips <style> blocks)
    rawHtml = inlineStyles(rawHtml);
    subject = dbTemplate.subject_line || "No Subject";
    campaignId = dbTemplate.id;
    templateFromName = dbTemplate.variable_values?.from_name || "";
    templateFromEmail = dbTemplate.variable_values?.from_email || "";
    templateVariableValues = dbTemplate.variable_values || null;


    const unsubscribeUrl = `${baseUrl}/unsubscribe?s=${subscriberId}&c=${campaignId}`;

    const unsubscribeFooter = `
        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; font-family: sans-serif;">
          <p style="margin: 0;">No longer want to receive these emails? <a href="${unsubscribeUrl}" style="color: #6b7280; text-decoration: underline;">Unsubscribe here</a>.</p>
        </div>
    `;

    let finalHtml = rawHtml + unsubscribeFooter;

    // Apply all merge tags (subscriber fields, global links, dynamic vars)
    const supabaseForSub = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY!
    );
    const { data: subscriberData } = await supabaseForSub
        .from("subscribers")
        .select("*")
        .eq("id", subscriberId)
        .single();

    finalHtml = await applyAllMergeTags(finalHtml, subscriberData || { id: subscriberId, email, first_name: firstName }, {
        unsubscribe_url: unsubscribeUrl,
        discount_code: templateVariableValues?.discount_code || "",
        discount_code1: templateVariableValues?.discount_code1 || "",
        discount_code2: templateVariableValues?.discount_code2 || "",
        discount_code3: templateVariableValues?.discount_code3 || "",
    });

    // Multi-discount slots support (with backward compat for legacy single-preset config)
    if (templateVariableValues) {
        // Resolve default links for URL variable fallback
        let defaultLinks: Record<string, string> = {};
        try {
            defaultLinks = await getDefaultLinks("dreamplay") as unknown as Record<string, string>;
        } catch { }

        const discountSlots: any[] = templateVariableValues.discount_slots || []
        const legacyPresetConfig = templateVariableValues.discount_preset_config
        const legacyIsPerUser = !!templateVariableValues.discount_preset_id && !!legacyPresetConfig
        if (discountSlots.length === 0 && legacyIsPerUser) {
            discountSlots.push({
                config: legacyPresetConfig,
                preview_code: templateVariableValues.discount_code || "",
                target_url_key: legacyPresetConfig.targetUrlKey || "",
                code_mode: "per_user",
            })
        }

        for (const slot of discountSlots) {
            if ((slot.code_mode || "per_user") !== "per_user") continue
            try {
                const discountRes = await createShopifyDiscount({
                    type: slot.config.type,
                    value: slot.config.value,
                    durationDays: slot.config.durationDays,
                    codePrefix: slot.config.codePrefix,
                    usageLimit: 1,
                    ...(slot.config.expiresOn ? { expiresOn: slot.config.expiresOn } : {}),
                })
                if (discountRes.success && discountRes.code) {
                    if (slot.preview_code) {
                        finalHtml = finalHtml.replaceAll(slot.preview_code, discountRes.code)
                    }
                    // Also replace discount= param in any URLs
                    if (slot.target_url_key) {
                        // Try variable_values first, then fall back to global default links
                        const targetUrl = templateVariableValues[slot.target_url_key]
                            || defaultLinks[slot.target_url_key]
                            || "";
                        if (targetUrl && !targetUrl.includes('discount=')) {
                            const escapedUrl = targetUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                            const urlRegex = new RegExp(`(href=["'])${escapedUrl}([^"']*)`, 'g')
                            finalHtml = finalHtml.replace(urlRegex, (match: string, prefix: string, suffix: string) => {
                                if (match.includes('discount=')) return match
                                const sep = (targetUrl + suffix).includes('?') ? '&' : '?'
                                return `${prefix}${targetUrl}${suffix}${sep}discount=${discountRes.code}`
                            })
                        }
                    }
                }
            } catch (discountErr) {
                console.error(`Chain: Failed to generate per-user discount for ${email} (slot ${slot.config.codePrefix}):`, discountErr)
            }
        }
    }

    // Click tracking: rewrite links only when tracking is enabled
    if (clickTracking) {
        finalHtml = finalHtml.replace(/href=([\"'])(https?:\/\/[^\"']+)\1/g, (match, quote, url) => {
            if (url.includes('/unsubscribe')) return match;
            if (url.includes('/api/track/')) return match;
            let cleanUrl = url;
            try {
                const parsedUrl = new URL(url);
                parsedUrl.searchParams.delete("sid");
                parsedUrl.searchParams.delete("cid");
                cleanUrl = parsedUrl.toString();
            } catch (e) { }
            const trackUrl = `${baseUrl}/api/track/click?u=${encodeURIComponent(cleanUrl)}&c=${campaignId}&s=${subscriberId}`;
            return `href=${quote}${trackUrl}${quote}`;
        });
    } else {
        // No redirect tracking — just set sid/cid params inline
        finalHtml = finalHtml.replace(/href=([\"'])(https?:\/\/[^\"']+)\1/g, (match, quote, url) => {
            if (url.includes('/unsubscribe')) return match;
            try {
                const parsedUrl = new URL(url);
                parsedUrl.searchParams.set("sid", subscriberId);
                parsedUrl.searchParams.set("cid", campaignId);
                return `href=${quote}${parsedUrl.toString()}${quote}`;
            } catch (e) {
                const sep = url.includes('?') ? '&' : '?';
                return `href=${quote}${url}${sep}sid=${subscriberId}&cid=${campaignId}${quote}`;
            }
        });
    }

    // Open tracking: inject 1x1 pixel
    if (openTracking) {
        const openPixel = `<img src="${baseUrl}/api/track/open?c=${campaignId}&s=${subscriberId}" width="1" height="1" alt="" style="display:none !important;width:1px;height:1px;opacity:0;" />`;
        if (finalHtml.includes('</body>')) {
            finalHtml = finalHtml.replace(/<\/body>/i, `${openPixel}</body>`);
        } else {
            finalHtml += openPixel;
        }
    }

    // Send Email (disable Resend's tracking — we use our own click redirect)
    const fromField = templateFromName && templateFromEmail
        ? `${templateFromName} <${templateFromEmail}>`
        : (process.env.RESEND_FROM_EMAIL || "Lionel Yu <lionel@musicalbasics.com>");

    const sendResult = await resend.emails.send({
        from: fromField,
        to: email,
        subject: subject,
        html: finalHtml,
        headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
        },
        click_tracking: resendClickTracking,
        open_tracking: resendOpenTracking,
    } as any);

    if (sendResult.error) {
        console.error("Chain email send error:", sendResult.error);
        return { success: false, campaignId, error: sendResult.error.message };
    }

    // Log to sent_history so chain emails appear in subscriber's email history
    const supabaseForHistory = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY!
    );
    await supabaseForHistory.from("sent_history").insert({
        campaign_id: campaignId,
        subscriber_id: subscriberId,
        sent_at: new Date().toISOString(),
        variant_sent: subject,
    });

    return { success: true, campaignId };
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
