import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { renderTemplate } from "@/lib/render-template";
import { injectPreheader } from "@/lib/email-preheader";
import { inlineStyles } from "@/lib/email-inline-styles";
import { applyAllMergeTags } from "@/lib/merge-tags";
import { proxyEmailImages } from "@/lib/image-proxy";

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
    const { rotationId, subscriberIds, fromName, fromEmail } = body;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            try {
                if (!rotationId || !subscriberIds || subscriberIds.length === 0) {
                    sendLog(controller, encoder, "error", "rotationId and subscriberIds are required");
                    controller.close();
                    return;
                }

                // 1. Fetch rotation
                sendLog(controller, encoder, "info", "Fetching rotation data...");
                const { data: rotation, error: rotError } = await supabaseAdmin
                    .from("rotations")
                    .select("*")
                    .eq("id", rotationId)
                    .single();

                if (rotError || !rotation) {
                    sendLog(controller, encoder, "error", `Rotation not found: ${rotError?.message || "unknown"}`);
                    controller.close();
                    return;
                }

                const campaignIds: string[] = rotation.campaign_ids;
                const totalCampaigns = campaignIds.length;

                if (totalCampaigns === 0) {
                    sendLog(controller, encoder, "error", "Rotation has no campaigns");
                    controller.close();
                    return;
                }

                sendLog(controller, encoder, "info", `Rotation: "${rotation.name}" — ${totalCampaigns} campaigns`);

                // 2. Fetch all template campaigns
                const { data: templates } = await supabaseAdmin
                    .from("campaigns")
                    .select("*")
                    .in("id", campaignIds);

                if (!templates || templates.length === 0) {
                    sendLog(controller, encoder, "error", "Template campaigns not found");
                    controller.close();
                    return;
                }

                const templateMap = Object.fromEntries(templates.map(t => [t.id, t]));
                sendLog(controller, encoder, "info", `Loaded ${templates.length} template(s): ${templates.map(t => `"${t.name}"`).join(", ")}`);

                // 3. Fetch subscriber data
                sendLog(controller, encoder, "info", "Fetching subscribers...");
                const { data: subscribers } = await supabaseAdmin
                    .from("subscribers")
                    .select("*")
                    .in("id", subscriberIds)
                    .eq("status", "active");

                if (!subscribers || subscribers.length === 0) {
                    sendLog(controller, encoder, "error", "No active subscribers found");
                    controller.close();
                    return;
                }

                sendLog(controller, encoder, "info", `Found ${subscribers.length} active subscriber(s)`);

                // 4. Round-robin assignment
                let cursor = rotation.cursor_position;
                const assignments: { subscriber: any; campaignId: string }[] = [];

                for (const sub of subscribers) {
                    const assignedCampaignId = campaignIds[cursor % totalCampaigns];
                    assignments.push({ subscriber: sub, campaignId: assignedCampaignId });
                    cursor++;
                }

                // 5. Group by campaign
                const grouped: Record<string, any[]> = {};
                for (const a of assignments) {
                    if (!grouped[a.campaignId]) grouped[a.campaignId] = [];
                    grouped[a.campaignId].push(a.subscriber);
                }

                const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://email.dreamplaypianos.com";
                let totalSent = 0;
                let totalFailed = 0;
                let globalIndex = 0;
                const totalRecipients = subscribers.length;

                for (const [templateId, subs] of Object.entries(grouped)) {
                    const template = templateMap[templateId];
                    if (!template) continue;

                    sendLog(controller, encoder, "info", `--- Batch: "${template.name}" (${subs.length} recipients) ---`);

                    // Create child campaign for this batch
                    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                    const { data: child, error: childError } = await supabaseAdmin
                        .from("campaigns")
                        .insert({
                            name: `${template.name} — Rotation — ${today}`,
                            subject_line: template.subject_line,
                            html_content: template.html_content,
                            status: "draft",
                            is_template: false,
                            parent_template_id: templateId,
                            rotation_id: rotationId,
                            variable_values: (() => {
                                const { subscriber_id, subscriber_ids, ...rest } = template.variable_values || {};
                                return rest;
                            })(),
                        })
                        .select("id")
                        .single();

                    if (childError || !child) {
                        sendLog(controller, encoder, "error", `Failed to create child campaign for "${template.name}": ${childError?.message}`);
                        totalFailed += subs.length;
                        globalIndex += subs.length;
                        continue;
                    }

                    sendLog(controller, encoder, "info", `Created child campaign ${child.id}`);

                    // Render HTML from template and proxy any external images
                    const renderedHtml = renderTemplate(template.html_content || "", template.variable_values || {});
                    const globalHtml = await proxyEmailImages(renderedHtml); // snapshot externals → permanent Supabase URLs
                    const htmlWithPreheader = injectPreheader(globalHtml, template.variable_values?.preview_text);
                    // Inline CSS class styles into element style attributes (Gmail strips <style> blocks)
                    const htmlWithInlinedStyles = inlineStyles(htmlWithPreheader);

                    const unsubscribeFooter = `
<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; font-family: sans-serif;">
  <p style="margin: 0;">
    No longer want to receive these emails? 
    <a href="{{unsubscribe_url}}" style="color: #6b7280; text-decoration: underline;">Unsubscribe here</a>.
  </p>
</div>
`;
                    const htmlWithFooter = htmlWithInlinedStyles + unsubscribeFooter;

                    let campaignSent = 0;
                    let campaignFailed = 0;
                    const sentRecords: any[] = [];

                    const senderFromName = fromName || template.variable_values?.from_name;
                    const senderFromEmail = fromEmail || template.variable_values?.from_email;

                    for (let i = 0; i < subs.length; i++) {
                        const sub = subs[i];
                        globalIndex++;
                        const progress = `[${globalIndex}/${totalRecipients}]`;

                        try {
                            sendLog(controller, encoder, "info", `${progress} Processing ${sub.email}...`);

                            const unsubscribeUrl = `${baseUrl}/unsubscribe?s=${sub.id}&c=${child.id}`;
                            let personalHtml = await applyAllMergeTags(htmlWithFooter, sub, {
                                unsubscribe_url: unsubscribeUrl,
                                discount_code: template.variable_values?.discount_code || "",
                            });

                            // Append subscriber context to links
                            personalHtml = personalHtml.replace(/href=(["'])(https?:\/\/[^"']+)\1/g, (match, quote, url) => {
                                if (url.includes('/unsubscribe')) return match;
                                try {
                                    const parsedUrl = new URL(url);
                                    parsedUrl.searchParams.set("sid", sub.id);
                                    parsedUrl.searchParams.set("cid", child.id);
                                    return `href=${quote}${parsedUrl.toString()}${quote}`;
                                } catch (e) {
                                    const sep = url.includes('?') ? '&' : '?';
                                    return `href=${quote}${url}${sep}sid=${sub.id}&cid=${child.id}${quote}`;
                                }
                            });

                            // Open tracking pixel
                            const openPixel = `<img src="${baseUrl}/api/track/open?c=${child.id}&s=${sub.id}" width="1" height="1" alt="" style="display:none !important;width:1px;height:1px;opacity:0;" />`;
                            const hadBody = personalHtml.includes('</body>');
                            personalHtml = personalHtml.replace(/<\/body>/i, `${openPixel}</body>`);
                            if (!personalHtml.includes(openPixel)) {
                                personalHtml += openPixel;
                            }
                            sendLog(controller, encoder, "success", `${progress} Open pixel INJECTED for ${sub.email}`, {
                                hadBodyTag: hadBody,
                                pixelUrl: `${baseUrl}/api/track/open?c=${child.id}&s=${sub.id}`,
                            });

                            const personalSubject = await applyAllMergeTags(template.subject_line || "", sub);

                            const { error } = await resend.emails.send({
                                from: senderFromName && senderFromEmail
                                    ? `${senderFromName} <${senderFromEmail}>`
                                    : (process.env.RESEND_FROM_EMAIL || "DreamPlay <hello@email.dreamplaypianos.com>"),
                                to: sub.email,
                                subject: personalSubject,
                                html: personalHtml,
                                headers: {
                                    "List-Unsubscribe": `<${unsubscribeUrl}>`,
                                    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                                },
                                click_tracking: false,
                                open_tracking: false,
                            } as any);

                            if (error) {
                                sendLog(controller, encoder, "error", `${progress} ❌ FAILED: ${sub.email} — ${error.message}`);
                                campaignFailed++;
                            } else {
                                sendLog(controller, encoder, "success", `${progress} ✅ Sent to ${sub.email} — template="${template.name}"`);
                                campaignSent++;
                                sentRecords.push({
                                    campaign_id: child.id,
                                    subscriber_id: sub.id,
                                    sent_at: new Date().toISOString(),
                                    variant_sent: template.subject_line || null,
                                });
                            }
                        } catch (e: any) {
                            sendLog(controller, encoder, "error", `${progress} Unexpected error for ${sub.email}: ${e.message}`);
                            campaignFailed++;
                        }

                        // Rate limit
                        if (i < subs.length - 1) {
                            await new Promise(r => setTimeout(r, 600));
                        }
                    }

                    // Insert sent history
                    if (sentRecords.length > 0) {
                        sendLog(controller, encoder, "info", `Inserting ${sentRecords.length} history record(s) for "${template.name}"...`);
                        const { error: histErr } = await supabaseAdmin.from("sent_history").insert(sentRecords);
                        if (histErr) {
                            sendLog(controller, encoder, "warn", `Failed to insert history: ${histErr.message}`);
                        } else {
                            sendLog(controller, encoder, "success", `History saved for "${template.name}"`);
                        }
                    }

                    // Update child campaign status
                    await supabaseAdmin.from("campaigns").update({
                        status: "completed",
                        total_recipients: subs.length,
                        sent_from_email: senderFromEmail || null,
                        updated_at: new Date().toISOString(),
                    }).eq("id", child.id);

                    totalSent += campaignSent;
                    totalFailed += campaignFailed;

                    sendLog(controller, encoder, "info", `Batch "${template.name}" done: ${campaignSent} sent, ${campaignFailed} failed`);
                }

                // Advance cursor
                const newCursor = (rotation.cursor_position + subscribers.length) % totalCampaigns;
                await supabaseAdmin.from("rotations").update({
                    cursor_position: newCursor,
                    updated_at: new Date().toISOString(),
                }).eq("id", rotationId);

                // Final summary
                const message = `Rotation send complete: ${totalSent} sent, ${totalFailed} failed out of ${totalRecipients} recipients.`;
                sendLog(controller, encoder, "success", `🎉 ${message}`, {
                    done: true,
                    stats: { sent: totalSent, failed: totalFailed, total: totalRecipients },
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
