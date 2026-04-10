import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { inngest } from "@/inngest/client";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

// Allow up to 2 minutes for chain setup + Inngest dispatch
export const maxDuration = 120;

// Verify the request actually came from Shopify using HMAC
function verifyShopifyWebhook(body: string, hmacHeader: string | null): boolean {
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!secret || !hmacHeader) return false;

    const hash = crypto
        .createHmac("sha256", secret)
        .update(body, "utf8")
        .digest("base64");

    return crypto.timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(hmacHeader)
    );
}

export async function POST(request: Request) {
    try {
        const rawBody = await request.text();
        const hmac = request.headers.get("x-shopify-hmac-sha256");

        // Verify HMAC signature (skip in dev if no secret configured)
        if (process.env.SHOPIFY_WEBHOOK_SECRET) {
            if (!verifyShopifyWebhook(rawBody, hmac)) {
                console.error("[Shopify Webhook] Invalid HMAC signature");
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }
        }

        const order = JSON.parse(rawBody);

        // Extract workspace from URL query params (default: dreamplay_marketing)
        const url = new URL(request.url);
        const workspace = url.searchParams.get('workspace') || 'dreamplay_marketing';

        // Extract customer info from the order
        const customer = order.customer || {};
        const shippingAddress = order.shipping_address || order.billing_address || {};

        const email = (customer.email || order.email || order.contact_email || "").trim().toLowerCase();

        if (!email) {
            console.warn("[Shopify Webhook] Order received with no email, skipping");
            return NextResponse.json({ success: true, skipped: true, reason: "no_email" });
        }

        const firstName = customer.first_name || shippingAddress.first_name || "";
        const lastName = customer.last_name || shippingAddress.last_name || "";
        const phone = customer.phone || shippingAddress.phone || order.phone || null;
        const city = shippingAddress.city || null;
        const province = shippingAddress.province || null;
        const country = shippingAddress.country || shippingAddress.country_name || null;
        const countryCode = shippingAddress.country_code || null;
        const address1 = shippingAddress.address1 || null;
        const address2 = shippingAddress.address2 || null;
        const zip = shippingAddress.zip || null;

        // Extract order details for logging
        const orderName = order.name || order.order_number || "Unknown";
        const totalPrice = order.total_price || "0.00";
        const currency = order.currency || "USD";

        console.log(`[Shopify Webhook] Processing order ${orderName} for ${email} ($${totalPrice} ${currency})`);

        // Check if subscriber already exists (workspace-scoped)
        const { data: existingUser } = await supabase
            .from("subscribers")
            .select("id, tags")
            .eq("email", email)
            .eq("workspace", workspace)
            .single();

        // Track previous tags so we know which ones are newly added
        const previousTags: string[] = existingUser?.tags || [];

        // Merge the "Purchased" tag
        const newTag = "Purchased";
        let mergedTags: string[] = [newTag];
        if (existingUser?.tags) {
            mergedTags = Array.from(new Set([...existingUser.tags, newTag]));
        }

        // Upsert subscriber with actual table columns
        const { data, error } = await supabase
            .from("subscribers")
            .upsert({
                email,
                first_name: firstName,
                last_name: lastName,
                tags: mergedTags,
                status: "active",
                country: country,
                country_code: countryCode,
                phone_number: phone,
                shipping_address1: address1,
                shipping_address2: address2,
                shipping_city: city,
                shipping_zip: zip,
                shipping_province: province,
                workspace,
            }, { onConflict: "email, workspace" })
            .select()
            .single();

        if (error) {
            console.error("[Shopify Webhook] Supabase error:", error);
            throw error;
        }

        console.log(`[Shopify Webhook] ${existingUser ? "Updated" : "Created"} subscriber ${email} with Purchased tag (Order: ${orderName})`);

        // ─── MOVE SUBSCRIBER TO dreamplay_support ────────────────────
        // Purchasers are moved out of dreamplay_marketing into the support workspace.
        // Since email is the unique key, this is a simple workspace column update.
        const { error: moveErr } = await supabase
            .from("subscribers")
            .update({ workspace: "dreamplay_support", updated_at: new Date().toISOString() })
            .eq("id", data.id);

        if (moveErr) {
            console.error("[Shopify Webhook] Failed to move subscriber to dreamplay_support:", moveErr.message);
        } else {
            console.log(`[Shopify Webhook] Moved ${email} from dreamplay_marketing → dreamplay_support`);

            // Cancel any active marketing chains — they belong to the old workspace context
            const { data: marketingProcesses } = await supabase
                .from("chain_processes")
                .select("id, history")
                .eq("subscriber_id", data.id)
                .in("status", ["active", "paused"]);

            if (marketingProcesses && marketingProcesses.length > 0) {
                for (const proc of marketingProcesses) {
                    const history = proc.history || [];
                    history.push({
                        step_name: "System",
                        action: "Chain Cancelled — Subscriber moved to dreamplay_support on purchase",
                        timestamp: new Date().toISOString(),
                    });
                    await supabase
                        .from("chain_processes")
                        .update({ status: "cancelled", history, updated_at: new Date().toISOString() })
                        .eq("id", proc.id);
                    await inngest.send({ name: "chain.cancel", data: { processId: proc.id } });
                }
                console.log(`[Shopify Webhook] Cancelled ${marketingProcesses.length} marketing chain(s) for ${email}`);
            }
        }

        // Trigger evaluation runs in the subscriber's new workspace (dreamplay_support if move succeeded)
        const activeSubscriberId = data.id; // same row, just workspace updated
        const activeWorkspace = moveErr ? workspace : "dreamplay_support";

        // ─── EVALUATE TRIGGERS FOR NEWLY ADDED TAGS ─────────────────
        const addedTags = mergedTags.filter(t => !previousTags.includes(t));
        let triggersFireCount = 0;

        if (addedTags.length > 0) {
            console.log(`[Shopify Webhook] Evaluating triggers for newly added tags:`, addedTags);

            const { data: triggers, error: tErr } = await supabase
                .from("email_triggers")
                .select("*")
                .eq("trigger_type", "subscriber_tag")
                .eq("is_active", true)
                .eq("workspace", activeWorkspace)
                .in("trigger_value", addedTags);

            if (tErr) {
                console.error("[Shopify Webhook] Error fetching triggers:", tErr.message);
            } else if (triggers && triggers.length > 0) {
                console.log(`[Shopify Webhook] Found ${triggers.length} matching trigger(s)`);

                for (const trigger of triggers) {
                    try {
                        // ─── CHAIN DISPATCH ─────────────────────
                        if (trigger.chain_id) {
                            console.log(`[Shopify Webhook] Trigger "${trigger.name}" → starting chain ${trigger.chain_id}`);

                            // Fetch master chain
                            const { data: masterChain } = await supabase
                                .from("email_chains")
                                .select("*")
                                .eq("id", trigger.chain_id)
                                .single();

                            if (!masterChain) {
                                console.error(`[Shopify Webhook] Chain ${trigger.chain_id} not found`);
                                continue;
                            }

                            // Cancel existing active chains for this subscriber
                            const { data: existingProcesses } = await supabase
                                .from("chain_processes")
                                .select("id, history")
                                .eq("subscriber_id", activeSubscriberId)
                                .in("status", ["active", "paused"]);

                            if (existingProcesses && existingProcesses.length > 0) {
                                for (const proc of existingProcesses) {
                                    const history = proc.history || [];
                                    history.push({
                                        step_name: "System",
                                        action: "Chain Cancelled — Replaced by Shopify purchase trigger",
                                        timestamp: new Date().toISOString(),
                                    });
                                    await supabase
                                        .from("chain_processes")
                                        .update({ status: "cancelled", history, updated_at: new Date().toISOString() })
                                        .eq("id", proc.id);
                                    await inngest.send({ name: "chain.cancel", data: { processId: proc.id } });
                                }
                            }

                            // Snapshot the chain
                            const { data: snapshot, error: snapErr } = await supabase
                                .from("email_chains")
                                .insert({
                                    name: `${masterChain.name} (snapshot)`,
                                    slug: `${masterChain.slug}-snap-${Date.now()}`,
                                    description: masterChain.description,
                                    trigger_label: masterChain.trigger_label,
                                    trigger_event: masterChain.trigger_event,
                                    subscriber_id: null,
                                    is_snapshot: true,
                                    workspace: masterChain.workspace,
                                })
                                .select("id")
                                .single();

                            if (snapErr || !snapshot) {
                                console.error("[Shopify Webhook] Failed to create chain snapshot:", snapErr?.message);
                                continue;
                            }

                            // Clone steps
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

                            // Clone branches
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
                            const { data: proc, error: procErr } = await supabase
                                .from("chain_processes")
                                .insert({
                                    chain_id: snapshot.id,
                                    subscriber_id: activeSubscriberId,
                                    status: "active",
                                    current_step_index: 0,
                                    history: [{
                                        step_name: "System",
                                        action: `Chain started via Shopify purchase trigger "${trigger.name}" (Order: ${orderName})`,
                                        timestamp: new Date().toISOString(),
                                    }],
                                })
                                .select("id")
                                .single();

                            if (procErr || !proc) {
                                console.error("[Shopify Webhook] Failed to create process:", procErr?.message);
                                continue;
                            }

                            // Fire Inngest event
                            await inngest.send({
                                name: "chain.run",
                                data: {
                                    processId: proc.id,
                                    chainId: snapshot.id,
                                    subscriberId: activeSubscriberId,
                                    email,
                                    firstName: firstName || "",
                                },
                            });

                            console.log(`[Shopify Webhook] ✅ Chain "${masterChain.name}" started for ${email}, process: ${proc.id}`);
                            triggersFireCount++;
                            continue;
                        }

                        // ─── EMAIL DISPATCH ─────────────────────
                        if (trigger.campaign_id) {
                            console.log(`[Shopify Webhook] Trigger "${trigger.name}" → sending email ${trigger.campaign_id}`);

                            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "http://localhost:3001";
                            const webhookUrl = `${baseUrl}/api/webhooks/subscribe`;

                            await fetch(webhookUrl, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    email,
                                    first_name: firstName || "",
                                    last_name: lastName || "",
                                    tags: mergedTags,
                                    workspace,
                                }),
                            });

                            console.log(`[Shopify Webhook] ✅ Webhook called for email trigger "${trigger.name}"`);
                            triggersFireCount++;
                            continue;
                        }

                        console.log(`[Shopify Webhook] ⚠️ Trigger "${trigger.name}" has no campaign_id or chain_id`);
                    } catch (triggerErr: any) {
                        console.error(`[Shopify Webhook] Error processing trigger "${trigger.name}":`, triggerErr.message);
                    }
                }
            } else {
                console.log("[Shopify Webhook] No matching triggers for tags:", addedTags);
            }
        }

        return NextResponse.json({
            success: true,
            subscriber_id: activeSubscriberId,
            workspace: activeWorkspace,
            is_new: !existingUser,
            order_name: orderName,
            triggers_fired: triggersFireCount,
        });

    } catch (error: any) {
        console.error("[Shopify Webhook] Error:", error);
        // Always return 200 to Shopify so they don't retry endlessly
        return NextResponse.json(
            { error: error.message },
            { status: 200 }
        );
    }
}
