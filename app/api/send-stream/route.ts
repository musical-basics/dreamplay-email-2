import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { renderTemplate } from "@/lib/render-template";
import { addPlayButtonsToVideoThumbnails } from "@/lib/video-overlay";
import { createShopifyDiscount } from "@/app/actions/shopify-discount";
import { applyAllMergeTags, applyAllMergeTagsWithLog } from "@/lib/merge-tags";
import { injectPreheader } from "@/lib/email-preheader";
import { proxyEmailImages } from "@/lib/image-proxy";
import { STANDARD_TAGS } from "@/lib/variable-rules";

const resend = new Resend(process.env.RESEND_API_KEY);

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

/** Helper: push a log line to the stream */
function sendLog(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    level: "info" | "success" | "warn" | "error",
    message: string,
    meta?: Record<string, any>
) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...(meta || {}) }) + "\n";
    controller.enqueue(encoder.encode(line));
}

export async function POST(request: Request) {
    const body = await request.json();
    const {
        campaignId, fromName, fromEmail,
        clickTracking = true, openTracking = true,
        resendClickTracking = false, resendOpenTracking = false,
        overrideSubscriberIds,  // optional: caller-supplied list bypasses campaign's own targeting
    } = body;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            try {
                // Fetch campaign
                sendLog(controller, encoder, "info", "Fetching campaign data...");
                const { data: campaign, error: campaignError } = await supabaseAdmin
                    .from("campaigns")
                    .select("*")
                    .eq("id", campaignId)
                    .single();

                if (campaignError || !campaign) {
                    sendLog(controller, encoder, "error", `Campaign not found: ${campaignError?.message || "unknown"}`);
                    controller.close();
                    return;
                }

                sendLog(controller, encoder, "info", `Campaign: "${campaign.name}"`);
                sendLog(controller, encoder, "info", `Tracking flags — click: ${clickTracking}, open: ${openTracking}, resendClick: ${resendClickTracking}, resendOpen: ${resendOpenTracking}`);

                // Render global template
                const subscriberVars = STANDARD_TAGS;
                const globalAssets = Object.fromEntries(
                    Object.entries(campaign.variable_values || {}).filter(([key]) => !subscriberVars.includes(key))
                ) as Record<string, string>;
                const globalHtmlContent = renderTemplate(campaign.html_content || "", globalAssets);
                const htmlWithPreheader = injectPreheader(globalHtmlContent, campaign.variable_values?.preview_text);

                // ── Proxy external images → permanent Supabase URLs ───────────
                sendLog(controller, encoder, "info", "Proxying images to permanent CDN URLs...");
                const htmlProxied = await proxyEmailImages(htmlWithPreheader);
                const proxiedCount = (htmlProxied.match(/supabase\.co/g) || []).length;
                const originalCount = (htmlWithPreheader.match(/supabase\.co/g) || []).length;
                const newlyProxied = proxiedCount - originalCount;
                if (newlyProxied > 0) {
                    sendLog(controller, encoder, "success", `✅ ${newlyProxied} image(s) proxied to Supabase CDN`);
                } else {
                    sendLog(controller, encoder, "warn", "⚠️  No images were proxied — check Vercel logs for proxy errors");
                }
                let htmlContent = htmlProxied;

                // Child campaign for templates
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
                            variable_values: (() => {
                                const { subscriber_id, ...rest } = campaign.variable_values || {};
                                return rest;
                            })(),
                        })
                        .select("id")
                        .single();

                    if (childError || !child) {
                        sendLog(controller, encoder, "error", `Failed to create child campaign: ${childError?.message}`);
                        controller.close();
                        return;
                    }

                    trackingCampaignId = child.id;
                    sendLog(controller, encoder, "info", `Created child campaign ${trackingCampaignId} from template`);
                }

                // Fetch recipients
                sendLog(controller, encoder, "info", "Fetching recipients...");
                const lockedSubscriberId = campaign.variable_values?.subscriber_id;
                const lockedSubscriberIds: string[] | undefined = campaign.variable_values?.subscriber_ids;
                let query = supabaseAdmin.from("subscribers").select("*").eq("status", "active");
                if (overrideSubscriberIds?.length > 0) {
                    // Caller-supplied list (e.g. from send-rotation) takes highest priority
                    query = query.in("id", overrideSubscriberIds);
                } else if (lockedSubscriberIds && lockedSubscriberIds.length > 0) {
                    query = query.in("id", lockedSubscriberIds);
                } else if (lockedSubscriberId) {
                    query = query.eq("id", lockedSubscriberId);
                }

                const { data: recipients, error: recipientError } = await query;

                if (recipientError || !recipients || recipients.length === 0) {
                    sendLog(controller, encoder, "error", "No active subscribers found");
                    controller.close();
                    return;
                }

                sendLog(controller, encoder, "info", `Found ${recipients.length} recipient(s)`, { total: recipients.length });

                const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://dreamplay-email-2.vercel.app";

                const unsubscribeFooter = `
<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; font-family: sans-serif;">
  <p style="margin: 0;">
    No longer want to receive these emails? 
    <a href="{{unsubscribe_url}}" style="color: #6b7280; text-decoration: underline;">Unsubscribe here</a>.
  </p>
</div>
`;
                const htmlWithFooter = htmlContent + unsubscribeFooter;
                const htmlWithVideoOverlay = await addPlayButtonsToVideoThumbnails(htmlWithFooter);

                let successCount = 0;
                let failureCount = 0;
                let firstResendEmailId: string | null = null;
                const sentRecords: any[] = [];

                // Discount slots
                const discountSlots: any[] = campaign.variable_values?.discount_slots || [];
                const legacyPresetConfig = campaign.variable_values?.discount_preset_config;
                const legacyIsPerUser = !!campaign.variable_values?.discount_preset_id && !!legacyPresetConfig;
                if (discountSlots.length === 0 && legacyIsPerUser) {
                    discountSlots.push({
                        config: legacyPresetConfig,
                        preview_code: campaign.variable_values?.discount_code || "",
                        target_url_key: legacyPresetConfig.targetUrlKey || "",
                        code_mode: "per_user",
                    });
                }
                const hasPerUserSlots = discountSlots.some((s: any) => (s.code_mode || "per_user") === "per_user");

                // Send loop
                for (let ri = 0; ri < recipients.length; ri++) {
                    const sub = recipients[ri];
                    const progress = `[${ri + 1}/${recipients.length}]`;

                    try {
                        sendLog(controller, encoder, "info", `${progress} Processing ${sub.email}...`);

                        const unsubscribeUrl = `${baseUrl}/unsubscribe?s=${sub.id}&c=${trackingCampaignId}&w=${campaign.workspace}`;

                        const { html: personalHtml_, log: mergeTagLog } = await applyAllMergeTagsWithLog(htmlWithVideoOverlay, sub, {
                            unsubscribe_url: unsubscribeUrl,
                            discount_code: campaign.variable_values?.discount_code || "",
                            discount_code1: campaign.variable_values?.discount_code1 || "",
                            discount_code2: campaign.variable_values?.discount_code2 || "",
                            discount_code3: campaign.variable_values?.discount_code3 || "",
                        });
                        let personalHtml = personalHtml_;

                        // Per-user discounts
                        if (hasPerUserSlots) {
                            for (const slot of discountSlots) {
                                if ((slot.code_mode || "per_user") !== "per_user") continue;
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
                                        sendLog(controller, encoder, "info", `${progress} Generated discount code: ${discountRes.code}`);
                                        if (slot.preview_code) {
                                            personalHtml = personalHtml.replaceAll(slot.preview_code, discountRes.code);
                                        }
                                        const targetUrlKey = slot.target_url_key;
                                        if (targetUrlKey) {
                                            const targetUrl = campaign.variable_values?.[targetUrlKey];
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
                                    sendLog(controller, encoder, "warn", `${progress} Discount generation failed for slot ${slot.config.codePrefix}`);
                                }
                            }
                            if (ri < recipients.length - 1) {
                                await new Promise(r => setTimeout(r, 300));
                            }
                        }

                        // Click tracking
                        if (clickTracking) {
                            personalHtml = personalHtml.replace(/href=(["'])(https?:\/\/[^"']+)\1/g, (match, quote, url) => {
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
                            sendLog(controller, encoder, "info", `${progress} Click tracking: links rewritten`);
                        } else {
                            personalHtml = personalHtml.replace(/href=(["'])(https?:\/\/[^"']+)\1/g, (match, quote, url) => {
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

                        // Open tracking pixel
                        if (openTracking) {
                            const openPixel = `<img src="${baseUrl}/api/track/open?c=${trackingCampaignId}&s=${sub.id}" width="1" height="1" alt="" style="display:none !important;width:1px;height:1px;opacity:0;" />`;
                            const hadBody = personalHtml.includes('</body>');
                            personalHtml = personalHtml.replace(/<\/body>/i, `${openPixel}</body>`);
                            if (!personalHtml.includes(openPixel)) {
                                personalHtml += openPixel;
                            }
                            sendLog(controller, encoder, "success", `${progress} Open pixel INJECTED for ${sub.email}`, {
                                hadBodyTag: hadBody,
                                pixelUrl: `${baseUrl}/api/track/open?c=${trackingCampaignId}&s=${sub.id}`,
                            });
                        } else {
                            sendLog(controller, encoder, "warn", `${progress} Open pixel SKIPPED for ${sub.email} (openTracking=false)`);
                        }

                        // Merge tags in subject
                        const personalSubject = await applyAllMergeTags(campaign.subject_line || "", sub);

                        // Log merge tag replacements
                        if (mergeTagLog && Object.keys(mergeTagLog).length > 0) {
                            const tagCount = Object.keys(mergeTagLog).length;
                            sendLog(controller, encoder, "info", `${progress} Merge tags resolved: ${tagCount} tag(s)`);
                        }

                        // Send via Resend
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
                            sendLog(controller, encoder, "error", `${progress} ❌ FAILED: ${sub.email} — ${error.message}`);
                            failureCount++;
                        } else {
                            sendLog(controller, encoder, "success", `${progress} ✅ Sent to ${sub.email}`, { resendId: sendData?.id });
                            successCount++;
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
                    } catch (e: any) {
                        sendLog(controller, encoder, "error", `${progress} Unexpected error for ${sub.email}: ${e.message}`);
                        failureCount++;
                    }

                    // Rate limit
                    if (ri < recipients.length - 1) {
                        await new Promise(r => setTimeout(r, 600));
                    }
                }

                // Insert history
                if (sentRecords.length > 0) {
                    sendLog(controller, encoder, "info", `Inserting ${sentRecords.length} history record(s)...`);
                    const { error: historyError } = await supabaseAdmin.from("sent_history").insert(sentRecords);
                    if (historyError) {
                        sendLog(controller, encoder, "warn", `Failed to insert history: ${historyError.message}`);
                    } else {
                        sendLog(controller, encoder, "success", "History records saved");
                    }
                }

                // Update campaign status
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

                // Final summary
                const message = `Broadcast complete: ${successCount} sent, ${failureCount} failed out of ${recipients.length} recipients.`;
                sendLog(controller, encoder, "success", `🎉 ${message}`, {
                    done: true,
                    stats: { sent: successCount, failed: failureCount, total: recipients.length },
                    message,
                });

            } catch (err: any) {
                sendLog(controller, encoder, "error", `Fatal error: ${err.message}`);
            } finally {
                controller.close();
            }
        }
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
            "Transfer-Encoding": "chunked",
        },
    });
}
