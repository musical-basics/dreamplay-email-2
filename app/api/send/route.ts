import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { renderTemplate } from "@/lib/render-template";
import { addPlayButtonsToVideoThumbnails } from "@/lib/video-overlay";
import { createShopifyDiscount } from "@/app/actions/shopify-discount";
import { applyAllMergeTags, applyAllMergeTagsWithLog } from "@/lib/merge-tags";
import { injectPreheader } from "@/lib/email-preheader";
import { inlineStyles } from "@/lib/email-inline-styles";
import { getDefaultLinks } from "@/app/actions/settings";

const resend = new Resend(process.env.RESEND_API_KEY);

// Admin client for data fetching (bypassing RLS for campaign data)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { campaignId, type, email, fromName, fromEmail, clickTracking = true, openTracking = true, resendClickTracking = false, resendOpenTracking = false } = body;

        // Fetch Campaign
        const { data: campaign, error: campaignError } = await supabaseAdmin
            .from("campaigns")
            .select("*")
            .eq("id", campaignId)
            .single();

        if (campaignError || !campaign) {
            console.error("Supabase Error:", campaignError);
            return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
        }

        // Render Global Template (exclude per-subscriber variables so they survive to per-recipient pass)
        const subscriberVars = ["first_name", "last_name", "email", "unsubscribe_url", "unsubscribe_link_url", "unsubscribe_link"];
        const globalAssets = Object.fromEntries(
            Object.entries(campaign.variable_values || {}).filter(([key]) => !subscriberVars.includes(key))
        ) as Record<string, string>;
        const globalHtmlContent = renderTemplate(campaign.html_content || "", globalAssets);
        // Inject preview text (preheader) if set
        const htmlWithPreheader = injectPreheader(globalHtmlContent, campaign.variable_values?.preview_text);
        // Inline all CSS class styles into element style attributes (Gmail strips <style> blocks)
        const htmlInlined = inlineStyles(htmlWithPreheader);
        // Snapshot email-asset images for broadcast sends (test sends skip this)
        let htmlContent = htmlInlined;

        if (type === "test") {
            if (!email) return NextResponse.json({ error: "Test email required" }, { status: 400 });

            // Simulation Subscriber Logic
            let simulationSubscriber = null;
            const lockedSubscriberId = campaign.variable_values?.subscriber_id;

            if (lockedSubscriberId) {
                const { data } = await supabaseAdmin
                    .from("subscribers")
                    .select("*")
                    .eq("id", lockedSubscriberId)
                    .single();
                simulationSubscriber = data;
            } else {
                const { data } = await supabaseAdmin
                    .from("subscribers")
                    .select("*")
                    .eq("status", "active")
                    .limit(1)
                    .single();
                simulationSubscriber = data;
            }

            // Replace Variables
            let finalHtml = htmlContent;
            if (simulationSubscriber) {
                finalHtml = await applyAllMergeTags(finalHtml, simulationSubscriber);

                // Auto-append sid and em to all links
                finalHtml = finalHtml.replace(/href=(["'])(https?:\/\/[^"']+)\1/g, (match, quote, url) => {
                    if (url.includes('/unsubscribe')) return match;
                    try {
                        const parsedUrl = new URL(url);
                        parsedUrl.searchParams.delete('cid');
                        parsedUrl.searchParams.set('sid', simulationSubscriber.id);
                        return `href=${quote}${parsedUrl.toString()}${quote}`;
                    } catch (e) {
                        const sep = url.includes('?') ? '&' : '?';
                        return `href=${quote}${url}${sep}sid=${simulationSubscriber.id}${quote}`;
                    }
                });
            } else {
                finalHtml = finalHtml
                    .replace(/{{first_name}}/g, "[Test Name]")
                    .replace(/{{email}}/g, "test@example.com")
                    .replace(/{{subscriber_id}}/g, "test-subscriber-id");
            }

            // Test Footer
            const unsubscribeFooter = `
<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; font-family: sans-serif;">
  <p style="margin: 0;">
    No longer want to receive these emails? 
    <a href="#" style="color: #6b7280; text-decoration: underline;">Unsubscribe here</a>.
  </p>
</div>
`;
            finalHtml += unsubscribeFooter;

            console.log("🚀 Sending Test Email...");
            const { data, error } = await resend.emails.send({
                from: fromName && fromEmail ? `${fromName} <${fromEmail}>` : (process.env.RESEND_FROM_EMAIL || "DreamPlay <hello@email.dreamplaypianos.com>"),
                to: email,
                subject: `[TEST] ${simulationSubscriber ? await applyAllMergeTags(campaign.subject_line || "", simulationSubscriber) : campaign.subject_line}`,
                html: finalHtml,
                click_tracking: resendClickTracking,
                open_tracking: resendOpenTracking,
            } as any);

            if (error) {
                console.error("❌ RESEND FAILED:", JSON.stringify(error, null, 2));
                return NextResponse.json({ error: error.message }, { status: 500 });
            }

            return NextResponse.json({ success: true, data });
        }

        else if (type === "broadcast") {
            console.log(`🚀 Starting broadcast for campaign ${campaignId}`);
            console.log(`📊 Tracking flags — click: ${clickTracking}, open: ${openTracking}, resendClick: ${resendClickTracking}, resendOpen: ${resendOpenTracking}, fromEmail: ${fromEmail}`);

            // If broadcasting from a template, create a child campaign for tracking
            let trackingCampaignId = campaignId;
            if (campaign.is_template) {
                const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                const childName = `${campaign.name} — ${today}`;

                const { data: child, error: childError } = await supabaseAdmin
                    .from("campaigns")
                    .insert({
                        name: childName,
                        subject_line: campaign.subject_line,
                        html_content: campaign.html_content,
                        status: "draft",
                        is_template: false,
                        parent_template_id: campaignId,
                        // Strip subscriber_id so child shows in Completed tab (not filtered as subscriber-locked)
                        variable_values: (() => {
                            const { subscriber_id, ...rest } = campaign.variable_values || {};
                            return rest;
                        })(),
                    })
                    .select("id")
                    .single();

                if (childError || !child) {
                    console.error("Failed to create child campaign:", childError);
                    return NextResponse.json({ error: "Failed to create send record" }, { status: 500 });
                }

                trackingCampaignId = child.id;
                console.log(`📋 Created child campaign ${trackingCampaignId} from template ${campaignId}`);
            }

            // Fetch recipients
            const lockedSubscriberId = campaign.variable_values?.subscriber_id;
            const lockedSubscriberIds: string[] | undefined = campaign.variable_values?.subscriber_ids;
            let query = supabaseAdmin.from("subscribers").select("*").eq("status", "active");
            if (lockedSubscriberIds && lockedSubscriberIds.length > 0) {
                query = query.in("id", lockedSubscriberIds);
            } else if (lockedSubscriberId) {
                query = query.eq("id", lockedSubscriberId);
            }

            const { data: recipients, error: recipientError } = await query;

            if (recipientError || !recipients || recipients.length === 0) {
                return NextResponse.json({ error: "No active subscribers found" }, { status: 400 });
            }

            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://dreamplay-email-2.vercel.app";

            // Unsubscribe Footer Template
            const unsubscribeFooter = `
<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; font-family: sans-serif;">
  <p style="margin: 0;">
    No longer want to receive these emails? 
    <a href="{{unsubscribe_url}}" style="color: #6b7280; text-decoration: underline;">Unsubscribe here</a>.
  </p>
</div>
`;
            const htmlWithFooter = htmlContent + unsubscribeFooter;

            // Composite play button overlay on video-linked thumbnails (once for all recipients)
            const htmlWithVideoOverlay = await addPlayButtonsToVideoThumbnails(htmlWithFooter);

            let successCount = 0;
            let failureCount = 0;
            let firstResendEmailId: string | null = null;
            const sentRecords: any[] = [];

            // Send to each recipient
            // Multi-discount slots support (with backward compat for legacy single-preset config)
            const discountSlots: any[] = campaign.variable_values?.discount_slots || []
            const legacyPresetConfig = campaign.variable_values?.discount_preset_config
            const legacyIsPerUser = !!campaign.variable_values?.discount_preset_id && !!legacyPresetConfig
            // Backward compat: wrap legacy single config into a slot
            if (discountSlots.length === 0 && legacyIsPerUser) {
                discountSlots.push({
                    config: legacyPresetConfig,
                    preview_code: campaign.variable_values?.discount_code || "",
                    target_url_key: legacyPresetConfig.targetUrlKey || "",
                    code_mode: "per_user",
                })
            }
            const hasPerUserSlots = discountSlots.some((s: any) => (s.code_mode || "per_user") === "per_user")

            // Resolve default links for URL variable fallback (for discount injection)
            let defaultLinks: Record<string, string> = {};
            try {
                defaultLinks = await getDefaultLinks("dreamplay") as unknown as Record<string, string>;
            } catch { }

            for (let ri = 0; ri < recipients.length; ri++) {
                const sub = recipients[ri];
                try {
                    const unsubscribeUrl = `${baseUrl}/unsubscribe?s=${sub.id}&c=${trackingCampaignId}&w=${campaign.workspace}`;

                    const { html: personalHtml_, log: mergeTagLog } = await applyAllMergeTagsWithLog(htmlWithVideoOverlay, sub, {
                        unsubscribe_url: unsubscribeUrl,
                        discount_code: campaign.variable_values?.discount_code || "",
                        discount_code1: campaign.variable_values?.discount_code1 || "",
                        discount_code2: campaign.variable_values?.discount_code2 || "",
                        discount_code3: campaign.variable_values?.discount_code3 || "",
                    });
                    let personalHtml = personalHtml_;

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
                                    // Replace preview code text in HTML
                                    if (slot.preview_code) {
                                        personalHtml = personalHtml.replaceAll(slot.preview_code, discountRes.code);
                                    }
                                    // Replace discount= param for this slot's target URL in rendered HTML
                                    const targetUrlKey = slot.target_url_key;
                                    if (targetUrlKey) {
                                        // Try variable_values first, then fall back to global default links
                                        const targetUrl = campaign.variable_values?.[targetUrlKey]
                                            || defaultLinks[targetUrlKey]
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
                                // Continue with the preview code as fallback
                            }
                        }
                        // Rate limit: small delay between Shopify API calls
                        if (ri < recipients.length - 1) {
                            await new Promise(r => setTimeout(r, 300));
                        }
                    }

                    // Click tracking: rewrite all links to go through our redirect tracker
                    if (clickTracking) {
                        personalHtml = personalHtml.replace(/href=([\"'])(https?:\/\/[^\"']+)\1/g, (match, quote, url) => {
                            if (url.includes('/unsubscribe')) return match;
                            if (url.includes('/api/track/')) return match;
                            let cleanUrl = url;
                            try {
                                const parsedUrl = new URL(url);
                                parsedUrl.searchParams.delete("sid");
                                parsedUrl.searchParams.delete("cid");
                                cleanUrl = parsedUrl.toString();
                            } catch (e) { }
                            const trackUrl = `${baseUrl}/api/track/click?u=${encodeURIComponent(cleanUrl)}&c=${trackingCampaignId}&s=${sub.id}`;
                            return `href=${quote}${trackUrl}${quote}`;
                        });
                    } else {
                        // Fallback: just append sid+cid inline (no redirect)
                        personalHtml = personalHtml.replace(/href=([\"'])(https?:\/\/[^\"']+)\1/g, (match, quote, url) => {
                            if (url.includes('/unsubscribe')) return match;
                            try {
                                const parsedUrl = new URL(url);
                                parsedUrl.searchParams.set("sid", sub.id);
                                parsedUrl.searchParams.set("cid", trackingCampaignId);
                                return `href=${quote}${parsedUrl.toString()}${quote}`;
                            } catch (e) {
                                const sep = url.includes('?') ? '&' : '?';
                                return `href=${quote}${url}${sep}sid=${sub.id}&cid=${trackingCampaignId}${quote}`;
                            }
                        });
                    }

                    // Open tracking pixel (loaded from our own domain)
                    if (openTracking) {
                        const openPixel = `<img src="${baseUrl}/api/track/open?c=${trackingCampaignId}&s=${sub.id}" width="1" height="1" alt="" style="display:none !important;width:1px;height:1px;opacity:0;" />`;
                        const hadBody = personalHtml.includes('</body>');
                        personalHtml = personalHtml.replace(/<\/body>/i, `${openPixel}</body>`);
                        if (!personalHtml.includes(openPixel)) {
                            personalHtml += openPixel;
                        }
                        console.log(`[Open Pixel] Injected for ${sub.email} — campaign=${trackingCampaignId}, hadBody=${hadBody}, baseUrl=${baseUrl}`);
                    } else {
                        console.log(`[Open Pixel] SKIPPED for ${sub.email} — openTracking=${openTracking}`);
                    }

                    const personalSubject = await applyAllMergeTags(campaign.subject_line || "", sub);

                    // Send Email (disable Resend's tracking — we use our own open pixel + click redirect)
                    const { data: sendData, error } = await resend.emails.send({
                        from: fromName && fromEmail ? `${fromName} <${fromEmail}>` : (process.env.RESEND_FROM_EMAIL || "DreamPlay <hello@email.dreamplaypianos.com>"),
                        to: sub.email,
                        subject: personalSubject,
                        html: personalHtml,
                        headers: {
                            "List-Unsubscribe": `<${unsubscribeUrl}>`,
                            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
                        },
                        click_tracking: resendClickTracking,
                        open_tracking: resendOpenTracking,
                    } as any);

                    if (error) {
                        console.error(`Failed to send to ${sub.email}:`, error);
                        failureCount++;
                    } else {
                        successCount++;
                        // Capture the first Resend email ID for the "Show Email" link
                        if (!firstResendEmailId && sendData?.id) {
                            firstResendEmailId = sendData.id;
                        }
                        sentRecords.push({
                            campaign_id: trackingCampaignId,
                            subscriber_id: sub.id,
                            sent_at: new Date().toISOString(),
                            variant_sent: campaign.subject_line || null,
                            merge_tag_log: mergeTagLog,
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

            // Insert history
            if (sentRecords.length > 0) {
                const { error: historyError } = await supabaseAdmin.from("sent_history").insert(sentRecords);
                if (historyError) console.error("Failed to insert history:", historyError);
            }

            // Update the tracking campaign (child or original) to completed
            const updateData: any = {
                status: "completed",
                total_recipients: recipients.length,
                sent_from_email: fromEmail || null,
                updated_at: new Date().toISOString(),
            };
            if (firstResendEmailId) {
                updateData.resend_email_id = firstResendEmailId;
            }
            await supabaseAdmin.from("campaigns").update(updateData).eq("id", trackingCampaignId);

            const message = `Broadcast complete: ${successCount} sent, ${failureCount} failed out of ${recipients.length} recipients.`;
            console.log(`✅ ${message}`);

            return NextResponse.json({
                success: true,
                message,
                stats: { sent: successCount, failed: failureCount, total: recipients.length }
            });
        }

        else if (type === "schedule") {
            const { scheduledAt } = body;
            if (!scheduledAt) return NextResponse.json({ error: "scheduledAt is required" }, { status: 400 });

            const scheduledDate = new Date(scheduledAt);
            if (scheduledDate <= new Date()) {
                return NextResponse.json({ error: "Scheduled time must be in the future" }, { status: 400 });
            }

            // Save schedule to campaign
            await supabaseAdmin
                .from("campaigns")
                .update({
                    scheduled_at: scheduledDate.toISOString(),
                    scheduled_status: "pending",
                })
                .eq("id", campaignId);

            // Send delayed Inngest event
            const { inngest } = await import("@/inngest/client");
            await inngest.send({
                name: "campaign.scheduled-send",
                data: {
                    campaignId,
                    scheduledAt: scheduledDate.toISOString(),
                    fromName,
                    fromEmail,
                    clickTracking,
                    openTracking,
                    resendClickTracking,
                    resendOpenTracking,
                },
            });

            return NextResponse.json({
                success: true,
                message: `Campaign scheduled for ${scheduledDate.toLocaleString()}`,
                scheduledAt: scheduledDate.toISOString(),
            });
        }

        else if (type === "cancel_schedule") {
            await supabaseAdmin
                .from("campaigns")
                .update({
                    scheduled_at: null,
                    scheduled_status: "cancelled",
                })
                .eq("id", campaignId);

            return NextResponse.json({
                success: true,
                message: "Schedule cancelled",
            });
        }

        return NextResponse.json({ error: "Invalid Type" }, { status: 400 });

    } catch (error: any) {
        console.error("Server Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}