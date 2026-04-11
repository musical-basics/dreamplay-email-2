import { createClient } from "@supabase/supabase-js";

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
        rotationId,
        subscriberIds,
        fromName,
        fromEmail,
        clickTracking = true,
        openTracking = true,
        resendClickTracking = false,
        resendOpenTracking = false,
    } = body;

    const encoder = new TextEncoder();
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://email.dreamplaypianos.com";

    const stream = new ReadableStream({
        async start(controller) {
            try {
                if (!rotationId || !subscriberIds || subscriberIds.length === 0) {
                    sendLog(controller, encoder, "error", "rotationId and subscriberIds are required");
                    controller.close();
                    return;
                }

                // ── 1. Fetch rotation ───────────────────────────────────────
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

                // ── 2. Fetch template campaigns ─────────────────────────────
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

                // ── 3. Fetch subscriber data ────────────────────────────────
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

                // ── 4. Round-robin assignment ───────────────────────────────
                let cursor = rotation.cursor_position;
                const grouped: Record<string, string[]> = {}; // templateId → [subscriberId, ...]

                for (const sub of subscribers) {
                    const assignedCampaignId = campaignIds[cursor % totalCampaigns];
                    if (!grouped[assignedCampaignId]) grouped[assignedCampaignId] = [];
                    grouped[assignedCampaignId].push(sub.id);
                    cursor++;
                }

                // ── 5. For each batch: create child campaign → call send-stream ──
                let totalSent = 0;
                let totalFailed = 0;
                const totalRecipients = subscribers.length;

                for (const [templateId, batchSubscriberIds] of Object.entries(grouped)) {
                    const template = templateMap[templateId];
                    if (!template) continue;

                    sendLog(controller, encoder, "info", `--- Batch: "${template.name}" (${batchSubscriberIds.length} recipients) ---`);

                    // Create child campaign to track this batch's analytics separately
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
                            workspace: template.workspace, // inherit so unsubscribe URLs resolve correctly
                            variable_values: (() => {
                                const { subscriber_id, subscriber_ids, ...rest } = template.variable_values || {};
                                return rest;
                            })(),
                        })
                        .select("id")
                        .single();

                    if (childError || !child) {
                        sendLog(controller, encoder, "error", `Failed to create child campaign for "${template.name}": ${childError?.message}`);
                        totalFailed += batchSubscriberIds.length;
                        continue;
                    }

                    sendLog(controller, encoder, "info", `Created child campaign ${child.id} — delegating to send-stream...`);

                    // Delegate actual send to /api/send-stream (single source of truth)
                    const response = await fetch(`${baseUrl}/api/send-stream`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            campaignId: child.id,
                            overrideSubscriberIds: batchSubscriberIds,
                            fromName: fromName || template.variable_values?.from_name,
                            fromEmail: fromEmail || template.variable_values?.from_email,
                            clickTracking,
                            openTracking,
                            resendClickTracking,
                            resendOpenTracking,
                        }),
                    });

                    // Pipe send-stream NDJSON logs through to this rotation stream
                    if (response.body) {
                        const reader = response.body.getReader();
                        const decoder = new TextDecoder();
                        let buffer = "";
                        let batchSent = 0;
                        let batchFailed = 0;

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split("\n");
                            buffer = lines.pop() || "";

                            for (const line of lines) {
                                if (!line.trim()) continue;
                                controller.enqueue(encoder.encode(line + "\n"));
                                // Count outcomes from send-stream log lines for final summary
                                try {
                                    const parsed = JSON.parse(line);
                                    if (parsed.level === "success" && parsed.message?.includes("✅ Sent")) batchSent++;
                                    if (parsed.level === "error" && parsed.message?.includes("❌ FAILED")) batchFailed++;
                                    if (parsed.done && parsed.stats) {
                                        batchSent = parsed.stats.sent ?? batchSent;
                                        batchFailed = parsed.stats.failed ?? batchFailed;
                                    }
                                } catch { /* skip */ }
                            }
                        }

                        totalSent += batchSent;
                        totalFailed += batchFailed;
                        sendLog(controller, encoder, "info", `Batch "${template.name}" done: ${batchSent} sent, ${batchFailed} failed`);
                    } else {
                        sendLog(controller, encoder, "warn", `send-stream returned no body for "${template.name}"`);
                        totalFailed += batchSubscriberIds.length;
                    }
                }

                // ── 6. Advance cursor ───────────────────────────────────────
                const newCursor = (rotation.cursor_position + subscribers.length) % totalCampaigns;
                await supabaseAdmin.from("rotations").update({
                    cursor_position: newCursor,
                    updated_at: new Date().toISOString(),
                }).eq("id", rotationId);

                // ── 7. Final summary ────────────────────────────────────────
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
