import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { renderTemplate } from "@/lib/render-template";
import { createShopifyDiscount } from "@/app/actions/shopify-discount";
import { applyAllMergeTagsWithLog } from "@/lib/merge-tags";
import { inngest } from "@/inngest/client";
import { proxyEmailImages } from "@/lib/image-proxy";


const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

// 1. Define your Safe List
const allowedOrigins = [
    "https://dreamplaypianos.com",
    "https://www.dreamplaypianos.com",
    "https://belgium-concert-landing-page.vercel.app",
];

// 2. Helper to generate dynamic headers based on who is asking
function getCorsHeaders(request: Request) {
    const origin = request.headers.get("origin");

    // If the requester is in our safe list, let them in. 
    // Otherwise, default to the main domain (which effectively blocks them).
    const allowOrigin = (origin && allowedOrigins.includes(origin))
        ? origin
        : allowedOrigins[0];

    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
}

export async function OPTIONS(request: Request) {
    return NextResponse.json({}, { headers: getCorsHeaders(request) });
}

// ─── DB Logger ────────────────────────────────────────────────────────
async function logTriggerEvent(
    level: "info" | "warn" | "error" | "success",
    event: string,
    details: Record<string, any> = {}
) {
    try {
        await supabase.from("trigger_logs").insert({
            level,
            event,
            details,
        });
    } catch (e) {
        console.error("[TriggerLog] Failed to write log:", e);
    }
    // Also console.log for server-side visibility
    const prefix = level === "error" ? "❌" : level === "warn" ? "⚠️" : level === "success" ? "✅" : "ℹ️";
    console.log(`${prefix} [Trigger] ${event}`, Object.keys(details).length > 0 ? JSON.stringify(details) : "");
}

// ─── Trigger execution (fire-and-forget) ──────────────────────────────
async function executeTriggers(subscriberTags: string[], subscriberId: string, subscriberEmail: string, workspace: string) {
    await logTriggerEvent("info", "Trigger execution started", {
        subscriber_email: subscriberEmail,
        subscriber_id: subscriberId,
        new_tags: subscriberTags,
    });

    try {
        // Find active triggers matching any of the subscriber's tags
        const { data: triggers, error: tErr } = await supabase
            .from("email_triggers")
            .select("*")
            .eq("trigger_type", "subscriber_tag")
            .eq("is_active", true)
            .eq("workspace", workspace)
            .in("trigger_value", subscriberTags);

        if (tErr) {
            await logTriggerEvent("error", "Failed to query email_triggers table", {
                error: tErr.message,
                hint: tErr.hint || "Does the email_triggers table exist? Run the SQL migration.",
                subscriber_email: subscriberEmail,
            });
            return;
        }

        if (!triggers || triggers.length === 0) {
            await logTriggerEvent("warn", "No matching triggers found", {
                subscriber_email: subscriberEmail,
                searched_tags: subscriberTags,
                hint: "Create triggers on the Triggers page that match these tag names.",
            });
            return;
        }

        await logTriggerEvent("info", `Found ${triggers.length} matching trigger(s)`, {
            subscriber_email: subscriberEmail,
            triggers: triggers.map(t => ({ id: t.id, name: t.name, trigger_value: t.trigger_value })),
        });

        for (const trigger of triggers) {
            try {
                // ─── CHAIN DISPATCH ───────────────────────────────
                if (trigger.chain_id) {
                    await logTriggerEvent("info", `Trigger "${trigger.name}" starting journey`, {
                        trigger_id: trigger.id,
                        chain_id: trigger.chain_id,
                        subscriber_email: subscriberEmail,
                    });

                    // Snapshot the master chain
                    const { data: masterChain } = await supabase
                        .from("email_chains")
                        .select("id, name")
                        .eq("id", trigger.chain_id)
                        .single();

                    if (!masterChain) {
                        await logTriggerEvent("error", `Journey not found for trigger "${trigger.name}"`, {
                            chain_id: trigger.chain_id,
                            subscriber_email: subscriberEmail,
                        });
                        continue;
                    }

                    // Cancel any existing active chains for this subscriber
                    const { data: existingProcesses } = await supabase
                        .from("chain_processes")
                        .select("id, history")
                        .eq("subscriber_id", subscriberId)
                        .in("status", ["active", "paused"]);

                    if (existingProcesses && existingProcesses.length > 0) {
                        for (const proc of existingProcesses) {
                            const history = proc.history || [];
                            history.push({
                                step_name: "System",
                                action: "Chain Cancelled — Replaced by trigger-launched chain",
                                timestamp: new Date().toISOString(),
                            });
                            await supabase
                                .from("chain_processes")
                                .update({ status: "cancelled", history, updated_at: new Date().toISOString() })
                                .eq("id", proc.id);
                            await inngest.send({ name: "chain.cancel", data: { processId: proc.id } });
                        }
                    }

                    // Duplicate chain as snapshot
                    // 1. Clone the chain row
                    const { data: chainRow } = await supabase
                        .from("email_chains")
                        .select("*")
                        .eq("id", trigger.chain_id)
                        .single();

                    if (!chainRow) {
                        await logTriggerEvent("error", `Failed to fetch chain for snapshot`, { chain_id: trigger.chain_id });
                        continue;
                    }

                    const { data: snapshot, error: snapErr } = await supabase
                        .from("email_chains")
                        .insert({
                            name: `${chainRow.name} (snapshot)`,
                            slug: `${chainRow.slug}-snap-${Date.now()}`,
                            description: chainRow.description,
                            trigger_label: chainRow.trigger_label,
                            trigger_event: chainRow.trigger_event,
                            subscriber_id: null,
                            is_snapshot: true,
                            workspace: chainRow.workspace,
                        })
                        .select("id")
                        .single();

                    if (snapErr || !snapshot) {
                        await logTriggerEvent("error", `Failed to create chain snapshot`, { error: snapErr?.message });
                        continue;
                    }

                    // 2. Clone steps
                    const { data: steps } = await supabase
                        .from("chain_steps")
                        .select("*")
                        .eq("chain_id", trigger.chain_id)
                        .order("position", { ascending: true });

                    if (steps && steps.length > 0) {
                        await supabase.from("chain_steps").insert(
                            steps.map(s => ({
                                chain_id: snapshot.id,
                                position: s.position,
                                label: s.label,
                                template_key: s.template_key,
                                wait_after: s.wait_after,
                            }))
                        );
                    }

                    // 3. Clone branches
                    const { data: branches } = await supabase
                        .from("chain_branches")
                        .select("*")
                        .eq("chain_id", trigger.chain_id);

                    if (branches && branches.length > 0) {
                        await supabase.from("chain_branches").insert(
                            branches.map(b => ({
                                chain_id: snapshot.id,
                                description: b.description,
                                position: b.position,
                                label: b.label,
                                condition: b.condition,
                                action: b.action,
                            }))
                        );
                    }

                    // Create process
                    const { data: process, error: procErr } = await supabase
                        .from("chain_processes")
                        .insert({
                            chain_id: snapshot.id,
                            subscriber_id: subscriberId,
                            status: "active",
                            current_step_index: 0,
                            history: [{
                                step_name: "System",
                                action: `Chain started via trigger "${trigger.name}"`,
                                timestamp: new Date().toISOString(),
                            }],
                        })
                        .select("id")
                        .single();

                    if (procErr || !process) {
                        await logTriggerEvent("error", `Failed to create chain process`, { error: procErr?.message });
                        continue;
                    }

                    // Fetch subscriber first name for inngest event
                    const { data: subRow } = await supabase
                        .from("subscribers")
                        .select("first_name")
                        .eq("id", subscriberId)
                        .single();

                    // Fire Inngest event
                    await inngest.send({
                        name: "chain.run",
                        data: {
                            processId: process.id,
                            chainId: snapshot.id,
                            subscriberId,
                            email: subscriberEmail,
                            firstName: subRow?.first_name || "",
                        },
                    });

                    await logTriggerEvent("info", `Journey "${masterChain.name}" started for ${subscriberEmail}`, {
                        trigger_name: trigger.name,
                        chain_id: trigger.chain_id,
                        process_id: process.id,
                    });

                    continue; // Skip the email send flow
                }

                // ─── EMAIL DISPATCH ───────────────────────────────
                if (!trigger.campaign_id) {
                    await logTriggerEvent("warn", `Trigger "${trigger.name}" has no linked campaign or journey`, {
                        trigger_id: trigger.id,
                        subscriber_email: subscriberEmail,
                        hint: "Link an automated email or journey to this trigger on the Triggers page.",
                    });
                    continue;
                }

                // Fetch the linked automated email template
                const { data: campaign, error: campErr } = await supabase
                    .from("campaigns")
                    .select("id, name, subject_line, html_content, variable_values")
                    .eq("id", trigger.campaign_id)
                    .single();

                if (campErr || !campaign) {
                    await logTriggerEvent("error", `Failed to fetch linked campaign`, {
                        trigger_name: trigger.name,
                        campaign_id: trigger.campaign_id,
                        error: campErr?.message || "Campaign not found",
                        subscriber_email: subscriberEmail,
                    });
                    continue;
                }

                if (!campaign.html_content) {
                    await logTriggerEvent("warn", `Campaign "${campaign.name}" has no HTML content`, {
                        trigger_name: trigger.name,
                        campaign_id: campaign.id,
                        subscriber_email: subscriberEmail,
                        hint: "Design the email template in the Email Builder first.",
                    });
                    continue;
                }

                // Generate discount codes — multi-slot support
                // Priority: campaign discount_slots > campaign legacy preset_config > trigger-level config
                const campaignSlots: any[] = campaign.variable_values?.discount_slots || []
                const campaignLegacyConfig = campaign.variable_values?.discount_preset_config
                const campaignLegacyIsPerUser = !!campaign.variable_values?.discount_preset_id && !!campaignLegacyConfig
                const triggerDiscountConfig = trigger.discount_config

                // Build effective slots list
                const effectiveSlots: any[] = [...campaignSlots]
                if (effectiveSlots.length === 0 && campaignLegacyIsPerUser) {
                    effectiveSlots.push({
                        config: campaignLegacyConfig,
                        preview_code: campaign.variable_values?.discount_code || "",
                        target_url_key: campaignLegacyConfig.targetUrlKey || "",
                        code_mode: "per_user",
                    })
                }
                if (effectiveSlots.length === 0 && trigger.generate_discount && triggerDiscountConfig) {
                    effectiveSlots.push({
                        config: triggerDiscountConfig,
                        preview_code: "",
                        target_url_key: triggerDiscountConfig.targetUrlKey || "",
                        code_mode: "per_user",
                    })
                }

                // Build template variables
                const assets: Record<string, string> = {
                    ...(campaign.variable_values || {}),
                    subscriber_email: subscriberEmail,
                };

                // Generate a discount code for each slot and inject into assets
                for (const slot of effectiveSlots) {
                    await logTriggerEvent("info", `Generating Shopify discount code (${slot.config.codePrefix})`, {
                        trigger_name: trigger.name,
                        config: slot.config,
                        subscriber_email: subscriberEmail,
                    });

                    const result = await createShopifyDiscount({
                        type: slot.config.type,
                        value: slot.config.value,
                        durationDays: slot.config.durationDays,
                        codePrefix: slot.config.codePrefix,
                        usageLimit: slot.config.usageLimit ?? 1,
                        ...(slot.config.expiresOn ? { expiresOn: slot.config.expiresOn } : {}),
                    });

                    if (result.success && result.code) {
                        await logTriggerEvent("success", `Shopify code generated: ${result.code}`, {
                            trigger_name: trigger.name,
                            subscriber_email: subscriberEmail,
                        });

                        // Replace preview code in HTML if present
                        if (slot.preview_code && slot.preview_code !== result.code) {
                            campaign.html_content = campaign.html_content.replaceAll(slot.preview_code, result.code);
                        }

                        // Inject discount into target URL variable
                        const targetUrlKey = slot.target_url_key;
                        if (targetUrlKey && assets[targetUrlKey]) {
                            const baseUrl = assets[targetUrlKey];
                            const sep = baseUrl.includes("?") ? "&" : "?";
                            assets[targetUrlKey] = baseUrl.includes("discount=")
                                ? baseUrl.replace(/discount=[^&]+/, `discount=${result.code}`)
                                : `${baseUrl}${sep}discount=${result.code}`;
                        } else if (!targetUrlKey) {
                            // Fallback: scan all CTA/activate URL variables (only for slots with no explicit mapping)
                            for (const [key, value] of Object.entries(assets)) {
                                if (typeof value === "string"
                                    && (key.includes("cta") || key.includes("activate"))
                                    && value.startsWith("http")
                                    && !value.includes("discount=")) {
                                    const sep = value.includes("?") ? "&" : "?";
                                    assets[key] = `${value}${sep}discount=${result.code}`;
                                }
                            }
                        }

                        // Write code to the slot's mapped code_variable
                        if (slot.code_variable) {
                            assets[slot.code_variable] = result.code;
                        }
                        // Set discount_code for legacy template rendering
                        assets.discount_code = result.code;
                    } else {
                        await logTriggerEvent("error", `Shopify discount generation failed (${slot.config.codePrefix})`, {
                            trigger_name: trigger.name,
                            error: result.error,
                            subscriber_email: subscriberEmail,
                        });
                    }
                }

                // ─── Create child campaign from master template ──────────
                const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
                const childName = `${campaign.name} — ${trigger.name} — ${today}`;

                const { data: childCampaign, error: childErr } = await supabase
                    .from("campaigns")
                    .insert({
                        name: childName,
                        subject_line: campaign.subject_line,
                        html_content: campaign.html_content,
                        status: "draft",
                        is_template: false,
                        parent_template_id: campaign.id,
                        workspace,
                        variable_values: {
                            ...(campaign.variable_values || {}),
                            subscriber_ids: [subscriberId],
                            trigger_id: trigger.id,
                            trigger_name: trigger.name,
                        },
                    })
                    .select("id")
                    .single();

                if (childErr || !childCampaign) {
                    await logTriggerEvent("error", `Failed to create child campaign`, {
                        trigger_name: trigger.name,
                        error: childErr?.message || "Unknown error",
                        subscriber_email: subscriberEmail,
                    });
                    continue;
                }

                const trackingCampaignId = childCampaign.id;

                await logTriggerEvent("info", `Created child campaign ${trackingCampaignId} from template ${campaign.id}`, {
                    trigger_name: trigger.name,
                    child_campaign_name: childName,
                    subscriber_email: subscriberEmail,
                });

                // Render template (campaign variables + smart blocks)
                let renderedHtml = renderTemplate(campaign.html_content, assets, subscriberTags);
                renderedHtml = (await proxyEmailImages(renderedHtml)).html; // snapshot externals → permanent Supabase URLs

                // Apply merge tags (subscriber fields, global links, dynamic vars)
                const { data: subscriberData } = await supabase
                    .from("subscribers")
                    .select("*")
                    .eq("id", subscriberId)
                    .single();

                const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://email.dreamplaypianos.com";
                const unsubscribeUrl = `${baseUrl}/unsubscribe?s=${subscriberId}&c=${trackingCampaignId}`;

                if (subscriberData) {
                    const { html: mergedHtml, log: mergeTagLog } = await applyAllMergeTagsWithLog(renderedHtml, subscriberData, {
                        discount_code: assets.discount_code || "",
                        discount_code1: assets.discount_code1 || "",
                        discount_code2: assets.discount_code2 || "",
                        discount_code3: assets.discount_code3 || "",
                        unsubscribe_url: unsubscribeUrl,
                    });
                    renderedHtml = mergedHtml;

                    // Store the log for sent_history
                    (trigger as any)._mergeTagLog = mergeTagLog;
                }

                // Append sid and cid to all links (matching manual send behavior)
                renderedHtml = renderedHtml.replace(/href=(["'])(https?:\/\/[^"']+)\1/g, (match, quote, url) => {
                    if (url.includes('/unsubscribe')) return match;
                    if (url.includes('/api/track/')) return match;
                    try {
                        const parsedUrl = new URL(url);
                        parsedUrl.searchParams.set("sid", subscriberId);
                        parsedUrl.searchParams.set("cid", trackingCampaignId);
                        return `href=${quote}${parsedUrl.toString()}${quote}`;
                    } catch (e) {
                        const sep = url.includes('?') ? '&' : '?';
                        return `href=${quote}${url}${sep}sid=${subscriberId}&cid=${trackingCampaignId}${quote}`;
                    }
                });

                // Determine sender
                const fromName = campaign.variable_values?.from_name || "Lionel Yu";
                const senderEmail = campaign.variable_values?.from_email || "lionel@email.dreamplaypianos.com";
                const subjectLine = subscriberData
                    ? await (async () => {
                        const { applyAllMergeTags } = await import("@/lib/merge-tags");
                        return applyAllMergeTags(campaign.subject_line || trigger.name, subscriberData);
                    })()
                    : (campaign.subject_line || trigger.name);

                await logTriggerEvent("info", `Sending email via Resend`, {
                    trigger_name: trigger.name,
                    campaign_name: campaign.name,
                    child_campaign_id: trackingCampaignId,
                    to: subscriberEmail,
                    from: `${fromName} <${senderEmail}>`,
                    subject: subjectLine,
                });

                // Open tracking: inject 1x1 pixel
                const openPixel = `<img src="${baseUrl}/api/track/open?c=${trackingCampaignId}&s=${subscriberId}" width="1" height="1" alt="" style="display:none !important;width:1px;height:1px;opacity:0;" />`;
                if (renderedHtml.includes('</body>')) {
                    renderedHtml = renderedHtml.replace(/<\/body>/i, `${openPixel}</body>`);
                } else {
                    renderedHtml += openPixel;
                }

                // Send via Resend
                const { data: emailResult, error: emailError } = await resend.emails.send({
                    from: `${fromName} <${senderEmail}>`,
                    to: [subscriberEmail],
                    subject: subjectLine,
                    html: renderedHtml,
                    headers: {
                        "List-Unsubscribe": `<${unsubscribeUrl}>`,
                        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                    },
                });

                if (emailError) {
                    await logTriggerEvent("error", `Resend email send failed`, {
                        trigger_name: trigger.name,
                        subscriber_email: subscriberEmail,
                        error: emailError,
                    });
                    // Mark child as failed
                    await supabase.from("campaigns").update({ status: "failed" }).eq("id", trackingCampaignId);
                    continue;
                }

                await logTriggerEvent("success", `Email sent successfully`, {
                    trigger_name: trigger.name,
                    subscriber_email: subscriberEmail,
                    resend_id: emailResult?.id,
                    campaign_name: campaign.name,
                    child_campaign_id: trackingCampaignId,
                });

                // Log to sent_history (using child campaign ID)
                await supabase.from("sent_history").insert({
                    campaign_id: trackingCampaignId,
                    subscriber_id: subscriberId,
                    resend_email_id: emailResult?.id || null,
                    merge_tag_log: (trigger as any)._mergeTagLog || null,
                });

                // Mark child campaign as completed
                await supabase.from("campaigns").update({
                    status: "completed",
                    total_recipients: 1,
                    resend_email_id: emailResult?.id || null,
                }).eq("id", trackingCampaignId);

            } catch (innerErr: any) {
                await logTriggerEvent("error", `Trigger execution error`, {
                    trigger_name: trigger.name,
                    subscriber_email: subscriberEmail,
                    error: innerErr.message || String(innerErr),
                    stack: innerErr.stack?.split("\n").slice(0, 3),
                });
            }
        }
    } catch (err: any) {
        await logTriggerEvent("error", "Fatal error in executeTriggers", {
            subscriber_email: subscriberEmail,
            error: err.message || String(err),
            stack: err.stack?.split("\n").slice(0, 3),
        });
    }
}

export async function POST(request: Request) {
    try {
        const { email, first_name, last_name, tags, city, country, ip_address, temp_session_id, workspace: rawWorkspace, gdpr_consent } = await request.json();

        if (!email) {
            return NextResponse.json(
                { error: "Email required" },
                { status: 400, headers: getCorsHeaders(request) }
            );
        }

        const workspace = rawWorkspace || 'dreamplay_marketing';
        const finalTags = tags && Array.isArray(tags) ? tags : ["Website Import"];

        await logTriggerEvent("info", "Subscribe webhook received", {
            email,
            tags: finalTags,
            city,
            country,
            workspace,
            gdpr_consent: gdpr_consent !== undefined ? !!gdpr_consent : "not provided",
        });

        // 🏷️ Auto-create tag_definitions for any new tags
        if (finalTags.length > 0) {
            const { data: existingDefs } = await supabase
                .from("tag_definitions")
                .select("name")
                .eq("workspace", workspace)
                .in("name", finalTags);

            const existingNames = new Set((existingDefs || []).map((d: any) => d.name));
            const missingTags = finalTags.filter((t: string) => !existingNames.has(t));

            if (missingTags.length > 0) {
                const newDefs = missingTags.map((name: string) => ({
                    name,
                    color: "#6b7280",
                    workspace,
                }));
                await supabase.from("tag_definitions").insert(newDefs);
                await logTriggerEvent("info", `Auto-created tag definitions: ${missingTags.join(", ")}`, { tags: missingTags });
            }
        }

        // Check for existing user to merge tags and respect unsubscribe status
        const { data: existingUser } = await supabase
            .from("subscribers")
            .select("tags, status")
            .eq("email", email)
            .eq("workspace", workspace)
            .single();

        let mergedTags = finalTags;
        if (existingUser?.tags) {
            mergedTags = Array.from(new Set([...existingUser.tags, ...finalTags]));
        }

        // Don't override status if user has explicitly unsubscribed
        const shouldSetActive = !existingUser || existingUser.status !== "unsubscribed";

        const { data, error } = await supabase
            .from("subscribers")
            .upsert({
                email,
                first_name: first_name || "",
                last_name: last_name || "",
                tags: mergedTags,
                ...(shouldSetActive ? { status: "active" } : {}),
                location_city: city,
                location_country: country,
                ip_address: ip_address,
                workspace,
                // GDPR: only write consent fields if explicitly provided
                ...(gdpr_consent !== undefined ? {
                    gdpr_consent: !!gdpr_consent,
                    consent_timestamp: gdpr_consent ? new Date().toISOString() : null,
                } : {}),
            }, { onConflict: "email, workspace" })
            .select()
            .single();

        if (error) throw error;

        // 📍 IDENTITY STITCHING
        if (temp_session_id && data.id) {
            const { error: stitchError, count } = await supabase
                .from("subscriber_events")
                .update({ subscriber_id: data.id })
                .is("subscriber_id", null)
                .eq("metadata->>temp_session_id", temp_session_id);

            if (stitchError) {
                console.error("[Webhook] Identity stitch error:", stitchError);
            } else {
                console.log(`[Webhook] Stitched ${count || 0} anonymous events for ${data.email}`);
            }
        }

        // 🔥 TRIGGER EXECUTION
        const newTags = existingUser?.tags
            ? finalTags.filter((t: string) => !existingUser.tags.includes(t))
            : finalTags;

        if (newTags.length > 0) {
            await logTriggerEvent("info", "New tags detected, executing triggers", {
                email,
                new_tags: newTags,
                existing_tags: existingUser?.tags || [],
            });
            await executeTriggers(newTags, data.id, email, workspace);
        } else {
            await logTriggerEvent("warn", "No new tags — skipping trigger execution", {
                email,
                incoming_tags: finalTags,
                existing_tags: existingUser?.tags || [],
                hint: "All incoming tags already existed on this subscriber. Triggers only fire on NEW tags.",
            });
        }

        return NextResponse.json(
            { success: true, id: data.id },
            { headers: getCorsHeaders(request) }
        );

    } catch (error: any) {
        await logTriggerEvent("error", "Webhook error", { error: error.message });
        console.error("Webhook Error:", error);
        return NextResponse.json(
            { error: error.message },
            { status: 500, headers: getCorsHeaders(request) }
        );
    }
}
