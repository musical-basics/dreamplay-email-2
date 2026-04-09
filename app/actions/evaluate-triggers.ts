"use server"

import { createClient } from "@/lib/supabase/server"
import { inngest } from "@/inngest/client"

/**
 * Evaluate triggers for a subscriber when their tags change.
 * This fires the same logic as the webhook subscribe route but for
 * tags applied from the UI (audience page, etc.).
 * 
 * @param subscriberId - The subscriber's UUID
 * @param newTags - The new set of tags (after the change)
 * @param previousTags - The old set of tags (before the change) — so we only fire for newly added tags
 */
export async function evaluateTriggersForSubscriber(
    subscriberId: string,
    newTags: string[],
    previousTags: string[] = [],
    workspace: string = 'dreamplay_marketing'
) {
    const addedTags = newTags.filter(t => !previousTags.includes(t))

    if (addedTags.length === 0) {
        console.log("[evaluateTriggers] No new tags added, skipping")
        return { fired: 0 }
    }

    console.log("[evaluateTriggers] New tags added:", addedTags, "for subscriber:", subscriberId)

    const supabase = await createClient()

    // Fetch the subscriber
    const { data: subscriber, error: subErr } = await supabase
        .from("subscribers")
        .select("id, email, first_name, last_name, tags")
        .eq("id", subscriberId)
        .single()

    if (subErr || !subscriber) {
        console.error("[evaluateTriggers] Subscriber not found:", subErr?.message)
        return { fired: 0, error: "Subscriber not found" }
    }

    // Find active triggers matching the newly added tags (workspace-scoped)
    const { data: triggers, error: tErr } = await supabase
        .from("email_triggers")
        .select("*")
        .eq("trigger_type", "subscriber_tag")
        .eq("is_active", true)
        .eq("workspace", workspace)
        .in("trigger_value", addedTags)

    if (tErr) {
        console.error("[evaluateTriggers] Error fetching triggers:", tErr.message)
        return { fired: 0, error: tErr.message }
    }

    if (!triggers || triggers.length === 0) {
        console.log("[evaluateTriggers] No matching triggers for tags:", addedTags)
        return { fired: 0 }
    }

    console.log("[evaluateTriggers] Found", triggers.length, "matching trigger(s)")

    let firedCount = 0

    for (const trigger of triggers) {
        try {
            // ─── CHAIN DISPATCH ─────────────────────────────────
            if (trigger.chain_id) {
                console.log(`[evaluateTriggers] Trigger "${trigger.name}" → starting chain ${trigger.chain_id}`)

                // Fetch master chain
                const { data: masterChain } = await supabase
                    .from("email_chains")
                    .select("*")
                    .eq("id", trigger.chain_id)
                    .single()

                if (!masterChain) {
                    console.error(`[evaluateTriggers] Chain ${trigger.chain_id} not found`)
                    continue
                }

                // Cancel existing active chains for this subscriber
                const { data: existingProcesses } = await supabase
                    .from("chain_processes")
                    .select("id, history")
                    .eq("subscriber_id", subscriberId)
                    .in("status", ["active", "paused"])

                if (existingProcesses && existingProcesses.length > 0) {
                    for (const proc of existingProcesses) {
                        const history = proc.history || []
                        history.push({
                            step_name: "System",
                            action: "Chain Cancelled — Replaced by trigger-launched chain",
                            timestamp: new Date().toISOString(),
                        })
                        await supabase
                            .from("chain_processes")
                            .update({ status: "cancelled", history, updated_at: new Date().toISOString() })
                            .eq("id", proc.id)
                        await inngest.send({ name: "chain.cancel", data: { processId: proc.id } })
                    }
                }

                // Snapshot the chain (inherit workspace)
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
                    .single()

                if (snapErr || !snapshot) {
                    console.error("[evaluateTriggers] Failed to create chain snapshot:", snapErr?.message)
                    continue
                }

                // Clone steps
                const { data: steps } = await supabase
                    .from("chain_steps")
                    .select("*")
                    .eq("chain_id", trigger.chain_id)
                    .order("position", { ascending: true })

                if (steps && steps.length > 0) {
                    await supabase.from("chain_steps").insert(
                        steps.map(s => ({
                            chain_id: snapshot.id,
                            position: s.position,
                            label: s.label,
                            template_key: s.template_key,
                            wait_after: s.wait_after,
                        }))
                    )
                }

                // Clone branches
                const { data: branches } = await supabase
                    .from("chain_branches")
                    .select("*")
                    .eq("chain_id", trigger.chain_id)

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
                    )
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
                    .single()

                if (procErr || !process) {
                    console.error("[evaluateTriggers] Failed to create process:", procErr?.message)
                    continue
                }

                // Fire Inngest event
                await inngest.send({
                    name: "chain.run",
                    data: {
                        processId: process.id,
                        chainId: snapshot.id,
                        subscriberId,
                        email: subscriber.email,
                        firstName: subscriber.first_name || "",
                    },
                })

                console.log(`[evaluateTriggers] ✅ Chain "${masterChain.name}" started for ${subscriber.email}, process: ${process.id}`)
                firedCount++
                continue
            }

            // ─── EMAIL DISPATCH ─────────────────────────────────
            if (trigger.campaign_id) {
                console.log(`[evaluateTriggers] Trigger "${trigger.name}" → sending email ${trigger.campaign_id}`)

                // For email triggers from the UI, call the webhook
                // We'll call the same endpoint internally
                const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "http://localhost:3111"
                const webhookUrl = `${baseUrl}/api/webhooks/subscribe`

                await fetch(webhookUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email: subscriber.email,
                        first_name: subscriber.first_name || "",
                        last_name: subscriber.last_name || "",
                        tags: newTags,
                        workspace,
                    }),
                })

                console.log(`[evaluateTriggers] ✅ Webhook called for email trigger "${trigger.name}"`)
                firedCount++
                continue
            }

            console.log(`[evaluateTriggers] ⚠️ Trigger "${trigger.name}" has no campaign_id or chain_id`)
        } catch (err: any) {
            console.error(`[evaluateTriggers] Error processing trigger "${trigger.name}":`, err.message)
        }
    }

    return { fired: firedCount }
}
