import { inngest } from "@/inngest/client";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { renderTemplate } from "@/lib/render-template";
import { createShopifyDiscount } from "@/app/actions/shopify-discount";
import { applyAllMergeTags } from "@/lib/merge-tags";
import { injectPreheader } from "@/lib/email-preheader";
import { inlineStyles } from "@/lib/email-inline-styles";
import { getDefaultLinks } from "@/app/actions/settings";

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

export const sendCampaign = inngest.createFunction(
    { id: "send-campaign" },
    { event: "campaign.send" },
    async ({ event, step }) => {
        const { campaignId } = event.data;

        // 1. Fetch Campaign
        const campaign = await step.run("fetch-campaign", async () => {
            const { data, error } = await supabase
                .from("campaigns")
                .select("*")
                .eq("id", campaignId)
                .single();

            if (error || !data) throw new Error("Campaign not found");
            return data;
        });

        // 2. Fetch Recipients
        const recipients = await step.run("fetch-recipients", async () => {
            const lockedSubscriberId = campaign.variable_values?.subscriber_id;
            const lockedSubscriberIds: string[] | undefined = campaign.variable_values?.subscriber_ids;
            const targetTag = campaign.variable_values?.target_tag;
            let query = supabase.from("subscribers").select("*").eq("status", "active");

            if (lockedSubscriberIds && lockedSubscriberIds.length > 0) {
                query = query.in("id", lockedSubscriberIds);
            } else if (lockedSubscriberId) {
                query = query.eq("id", lockedSubscriberId);
            } else if (targetTag) {
                // Filter by tag — only send to subscribers who have this tag
                query = query.contains("tags", [targetTag]);
            }
            // Exclude unsubscribed (redundant check but safe)
            query = query.neq('status', 'unsubscribed');

            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        });

        if (recipients.length === 0) {
            return { message: "No recipients found" };
        }

        // 3. Resolve default links for URL variable fallback (for discount injection)
        const defaultLinks = await step.run("resolve-default-links", async () => {
            try {
                return await getDefaultLinks("dreamplay");
            } catch {
                return {};
            }
        });

        // 4. Send Emails in Batches
        const result = await step.run("send-emails", async () => {
            const globalHtmlContent = renderTemplate(campaign.html_content || "", campaign.variable_values || {});

            // Inject preview text (preheader) if set
            const htmlWithPreheader = injectPreheader(globalHtmlContent, campaign.variable_values?.preview_text);
            // Inline CSS class styles into element style attributes (Gmail strips <style> blocks)
            const htmlWithInlinedStyles = inlineStyles(htmlWithPreheader);

            // Footer Template
            const unsubscribeFooter = `
<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; font-family: sans-serif;">
  <p style="margin: 0;">
    No longer want to receive these emails? 
    <a href="{{unsubscribe_url}}" style="color: #6b7280; text-decoration: underline;">Unsubscribe here</a>.
  </p>
</div>
`;
            const htmlWithFooter = htmlWithInlinedStyles + unsubscribeFooter;
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://email.dreamplaypianos.com";

            let successCount = 0;
            let failureCount = 0;
            const sentRecords: any[] = [];

            // Multi-discount slots support (with backward compat for legacy single-preset config)
            const discountSlots: any[] = campaign.variable_values?.discount_slots || []
            const legacyPresetConfig = campaign.variable_values?.discount_preset_config
            const legacyIsPerUser = !!campaign.variable_values?.discount_preset_id && !!legacyPresetConfig
            if (discountSlots.length === 0 && legacyIsPerUser) {
                discountSlots.push({
                    config: legacyPresetConfig,
                    preview_code: campaign.variable_values?.discount_code || "",
                    target_url_key: legacyPresetConfig.targetUrlKey || "",
                    code_mode: "per_user",
                })
            }
            const hasPerUserSlots = discountSlots.some((s: any) => (s.code_mode || "per_user") === "per_user")

            // Process recipients sequentially (needed for per-user discount rate limiting)
            for (let ri = 0; ri < recipients.length; ri++) {
                const sub = recipients[ri];
                try {
                    // Personalize content with merge tags
                    const unsubscribeUrl = `${baseUrl}/unsubscribe?s=${sub.id}&c=${campaignId}`;
                    let personalHtml = await applyAllMergeTags(htmlWithFooter, sub, {
                        unsubscribe_url: unsubscribeUrl,
                        discount_code: campaign.variable_values?.discount_code || "",
                        discount_code1: campaign.variable_values?.discount_code1 || "",
                        discount_code2: campaign.variable_values?.discount_code2 || "",
                        discount_code3: campaign.variable_values?.discount_code3 || "",
                    });

                    // Per-user discount: generate unique Shopify codes for each slot
                    if (hasPerUserSlots) {
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
                                });
                                if (discountRes.success && discountRes.code) {
                                    if (slot.preview_code) {
                                        personalHtml = personalHtml.replaceAll(slot.preview_code, discountRes.code);
                                    }
                                    const targetUrlKey = slot.target_url_key;
                                    if (targetUrlKey) {
                                        // Try variable_values first, then fall back to global default links
                                        const targetUrl = campaign.variable_values?.[targetUrlKey]
                                            || (defaultLinks as Record<string, string>)?.[targetUrlKey]
                                            || "";
                                        if (targetUrl && !targetUrl.includes('discount=')) {
                                            const escapedUrl = targetUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                            const urlRegex = new RegExp(`(href=["'])${escapedUrl}([^"']*)`, 'g');
                                            personalHtml = personalHtml.replace(urlRegex, (match: string, prefix: string, suffix: string) => {
                                                if (match.includes('discount=')) return match;
                                                const sep = (targetUrl + suffix).includes('?') ? '&' : '?';
                                                return `${prefix}${targetUrl}${suffix}${sep}discount=${discountRes.code}`;
                                            });
                                        }
                                    }
                                }
                            } catch (discountErr) {
                                console.error(`Failed to generate per-user discount for ${sub.email} (slot ${slot.config.codePrefix}):`, discountErr);
                            }
                        }
                        if (ri < recipients.length - 1) {
                            await new Promise(r => setTimeout(r, 300));
                        }
                    }

                    // Smart Blocks: process conditional tag content per subscriber
                    const subscriberTags = sub.tags || [];

                    personalHtml = personalHtml.replace(
                        /\{\{#if\s+tag_(\w+)\}\}([\s\S]*?)\{\{\/?endif\}\}/gi,
                        (_match: string, tagName: string, content: string) => {
                            const hasTag = subscriberTags.some(
                                (t: string) => t.toLowerCase() === tagName.toLowerCase()
                            );
                            return hasTag ? content.trim() : "";
                        }
                    );

                    // Append subscriber context to links (no redirect tracking)
                    personalHtml = personalHtml.replace(/href=([\"'])(https?:\/\/[^\"']+)\1/g, (match, quote, url) => {
                        if (url.includes('/unsubscribe')) return match;
                        const sep = url.includes('?') ? '&' : '?';
                        return `href=${quote}${url}${sep}sid=${sub.id}&cid=${campaignId}&em=${encodeURIComponent(sub.email)}${quote}`;
                    });

                    // Send Email
                    const fromName = campaign.variable_values?.from_name;
                    const fromEmail = campaign.variable_values?.from_email;

                    const personalSubject = await applyAllMergeTags(campaign.subject_line || "", sub);

                    // Send Email (disable Resend's tracking — we use our own)
                    const { error } = await resend.emails.send({
                        from: fromName && fromEmail ? `${fromName} <${fromEmail}>` : (process.env.RESEND_FROM_EMAIL || "DreamPlay <hello@email.dreamplaypianos.com>"),
                        to: sub.email,
                        subject: personalSubject,
                        html: personalHtml,
                        headers: {
                            "List-Unsubscribe": `<${unsubscribeUrl}>`,
                            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
                        },
                        click_tracking: false,
                        open_tracking: false,
                    } as any);

                    if (error) {
                        console.error(`Failed to send to ${sub.email}:`, error);
                        failureCount++;
                    } else {
                        successCount++;
                        sentRecords.push({
                            campaign_id: campaignId,
                            subscriber_id: sub.id,
                            sent_at: new Date().toISOString(),
                            variant_sent: campaign.subject_line || null
                        });
                    }
                } catch (e) {
                    console.error(`Unexpected error for ${sub.email}:`, e);
                    failureCount++;
                }

                // Rate-limit buffer: Resend allows 2 req/sec, so 600ms gap is safe
                if (ri < recipients.length - 1) {
                    await new Promise(r => setTimeout(r, 600));
                }
            }

            return { successCount, failureCount, sentRecords };
        });

        // 4. Update History & Status
        await step.run("update-metrics", async () => {
            const { successCount, sentRecords } = result;

            // Insert history
            if (sentRecords.length > 0) {
                const { error } = await supabase.from("sent_history").insert(sentRecords);
                if (error) console.error("Failed to insert history:", error);
            }

            // Update campaign status
            await supabase.from("campaigns").update({
                status: "completed",
                total_recipients: recipients.length
            }).eq("id", campaignId);

            return { success: true };
        });

        return {
            event: "campaign.send.completed",
            body: {
                campaignId,
                stats: {
                    sent: result.successCount,
                    failed: result.failureCount,
                    total: recipients.length
                }
            }
        };
    }
);
