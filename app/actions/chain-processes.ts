"use server"

import { createClient } from "@/lib/supabase/server"
import { inngest } from "@/inngest/client"
import { revalidatePath } from "next/cache"
import type { ChainProcess } from "@/lib/types"
import { duplicateChain } from "@/app/actions/chains"

// ─── START A CHAIN PROCESS ─────────────────────────────────
export async function startChainProcess(
    subscriberId: string,
    chainId: string,
    rotationOptions?: { chainRotationId?: string; originalChainId?: string }
) {
    const supabase = await createClient()

    // Fetch subscriber details
    const { data: subscriber, error: subError } = await supabase
        .from("subscribers")
        .select("email, first_name")
        .eq("id", subscriberId)
        .single()

    if (subError || !subscriber) {
        return { success: false, error: "Subscriber not found" }
    }

    // ─── CANCEL EXISTING CHAINS FOR THIS SUBSCRIBER ───
    // Only one chain should run per subscriber at a time
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
                action: "Chain Cancelled — Replaced by new chain",
                timestamp: new Date().toISOString(),
            })

            await supabase
                .from("chain_processes")
                .update({
                    status: "cancelled",
                    history,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", proc.id)

            // Fire cancel event so Inngest stops the running function
            await inngest.send({ name: "chain.cancel", data: { processId: proc.id } })
        }
    }

    // Snapshot the master chain — clone it so edits to the master don't affect this run
    // Keep subscriber_id null so the snapshot doesn't appear in the Drafts tab
    const { data: clonedChain, error: cloneError } = await duplicateChain(chainId, {
        subscriber_id: null,
        is_snapshot: true,
    })

    if (cloneError || !clonedChain) {
        return { success: false, error: cloneError || "Failed to snapshot chain" }
    }

    const snapshotChainId = clonedChain.id

    // ─── SMART SKIP: Trim already-sent leading steps ───
    // Get snapshot's steps
    const { data: snapshotSteps } = await supabase
        .from("chain_steps")
        .select("id, position, template_key, label")
        .eq("chain_id", snapshotChainId)
        .order("position", { ascending: true })

    const steps = snapshotSteps || []

    // Check which campaigns this subscriber has already received
    const campaignIds = [...new Set(steps.map(s => s.template_key).filter(Boolean))]
    let alreadySentSet = new Set<string>()

    if (campaignIds.length > 0) {
        // Check direct matches (campaign_id IS the template_key)
        const { data: directSentRows } = await supabase
            .from("sent_history")
            .select("campaign_id")
            .eq("subscriber_id", subscriberId)
            .in("campaign_id", campaignIds)

        if (directSentRows) {
            directSentRows.forEach(r => alreadySentSet.add(r.campaign_id))
        }

        // Check copies (campaigns with parent_template_id = template_key)
        const { data: copies } = await supabase
            .from("campaigns")
            .select("id, parent_template_id")
            .in("parent_template_id", campaignIds)

        if (copies && copies.length > 0) {
            const copyIds = copies.map(c => c.id)
            const { data: copySentRows } = await supabase
                .from("sent_history")
                .select("campaign_id")
                .eq("subscriber_id", subscriberId)
                .in("campaign_id", copyIds)

            if (copySentRows) {
                const copyToParent = new Map(copies.map(c => [c.id, c.parent_template_id]))
                copySentRows.forEach(r => {
                    const parentId = copyToParent.get(r.campaign_id)
                    if (parentId) alreadySentSet.add(parentId)
                })
            }
        }
    }

    // Walk from the beginning — skip consecutive already-sent steps
    const skippedStepIds: string[] = []
    const skippedLabels: string[] = []
    let skipCount = 0

    for (const step of steps) {
        if (alreadySentSet.has(step.template_key)) {
            skippedStepIds.push(step.id)
            skippedLabels.push(step.label)
            skipCount++
        } else {
            break // Stop at the first unsent step
        }
    }

    // If ALL steps already sent, skip the chain entirely
    if (skipCount === steps.length) {
        // Clean up the snapshot since we won't use it
        await supabase.from("email_chains").delete().eq("id", snapshotChainId)
        return {
            success: false,
            error: `All ${steps.length} steps in this chain have already been sent to this subscriber.`,
        }
    }

    // Delete skipped steps from the snapshot and re-number
    if (skippedStepIds.length > 0) {
        await supabase.from("chain_steps").delete().in("id", skippedStepIds)

        // Re-number remaining steps starting from position 1
        const remainingSteps = steps.filter(s => !skippedStepIds.includes(s.id))
        for (let i = 0; i < remainingSteps.length; i++) {
            await supabase
                .from("chain_steps")
                .update({ position: i + 1 })
                .eq("id", remainingSteps[i].id)
        }
    }

    // Build history entries
    const historyEntries: any[] = []
    if (skippedLabels.length > 0) {
        historyEntries.push({
            step_name: "System",
            action: `Skipped ${skippedLabels.length} already-sent step(s)`,
            timestamp: new Date().toISOString(),
            details: `Skipped: ${skippedLabels.join(", ")}`,
        })
    }
    historyEntries.push({
        step_name: "System",
        action: "Chain Started",
        timestamp: new Date().toISOString(),
    })

    // Create process row pointing to the snapshot
    const { data: process, error: procError } = await supabase
        .from("chain_processes")
        .insert({
            chain_id: snapshotChainId,
            subscriber_id: subscriberId,
            status: "active",
            current_step_index: 0,
            history: historyEntries,
            ...(rotationOptions?.chainRotationId ? { chain_rotation_id: rotationOptions.chainRotationId } : {}),
            ...(rotationOptions?.originalChainId ? { original_chain_id: rotationOptions.originalChainId } : {}),
        })
        .select("id")
        .single()

    if (procError || !process) {
        console.error("Error creating chain process:", procError)
        return { success: false, error: procError?.message || "Failed to create process" }
    }

    // Fire Inngest event with the snapshot chain ID
    await inngest.send({
        name: "chain.run",
        data: {
            processId: process.id,
            chainId: snapshotChainId,
            subscriberId,
            email: subscriber.email,
            firstName: subscriber.first_name || "",
            ...(rotationOptions?.chainRotationId ? { chainRotationId: rotationOptions.chainRotationId } : {}),
        },
    })

    revalidatePath("/journeys")
    return { success: true, processId: process.id, skippedCount: skipCount }
}

// ─── GET ALL CHAIN PROCESSES ───────────────────────────────
export async function getChainProcesses(): Promise<{ data: ChainProcess[]; error: string | null }> {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from("chain_processes")
        .select(`
            *,
            email_chains!chain_processes_chain_id_fkey ( name, chain_steps ( * ), chain_branches ( * ) ),
            subscribers ( email, first_name )
        `)
        .order("created_at", { ascending: false })

    if (error) {
        console.error("Error fetching chain processes:", error)
        return { data: [], error: error.message }
    }

    const processes: ChainProcess[] = (data || []).map((row: any) => ({
        id: row.id,
        chain_id: row.chain_id,
        subscriber_id: row.subscriber_id,
        status: row.status,
        current_step_index: row.current_step_index,
        next_step_at: row.next_step_at,
        history: row.history || [],
        created_at: row.created_at,
        updated_at: row.updated_at,
        chain_name: row.email_chains?.name || "Unknown Chain",
        chain_steps: (row.email_chains?.chain_steps || []).sort((a: any, b: any) => a.position - b.position),
        chain_branches: (row.email_chains?.chain_branches || []).sort((a: any, b: any) => a.position - b.position),
        subscriber_email: row.subscribers?.email || "Unknown",
        subscriber_first_name: row.subscribers?.first_name || "",
    }))

    return { data: processes, error: null }
}

// ─── UPDATE PROCESS STATUS ─────────────────────────────────
export async function updateProcessStatus(processId: string, newStatus: "active" | "paused" | "cancelled") {
    const supabase = await createClient()

    // Fetch current process to append to history
    const { data: current } = await supabase
        .from("chain_processes")
        .select("history")
        .eq("id", processId)
        .single()

    const history = current?.history || []
    const actionMap = { active: "Chain Resumed", paused: "Chain Paused", cancelled: "Chain Cancelled" }
    history.push({
        step_name: "System",
        action: actionMap[newStatus],
        timestamp: new Date().toISOString(),
    })

    const { error } = await supabase
        .from("chain_processes")
        .update({
            status: newStatus,
            history,
            updated_at: new Date().toISOString(),
        })
        .eq("id", processId)

    if (error) {
        console.error("Error updating process status:", error)
        return { success: false, error: error.message }
    }

    // Fire Inngest events for cancel/resume
    if (newStatus === "cancelled") {
        await inngest.send({ name: "chain.cancel", data: { processId } })
    } else if (newStatus === "active") {
        // "active" means resume
        await inngest.send({ name: "chain.resume", data: { processId } })
    }

    revalidatePath("/journeys")
    return { success: true }
}

// ─── PAUSE ALL ACTIVE PROCESSES ───────────────────────────
export async function pauseAllActiveProcesses() {
    const supabase = await createClient()

    const { data: processes, error: fetchError } = await supabase
        .from("chain_processes")
        .select("id, history")
        .eq("status", "active")

    if (fetchError) {
        console.error("Error loading active processes:", fetchError)
        return { success: false, error: fetchError.message, pausedCount: 0 }
    }

    if (!processes || processes.length === 0) {
        return { success: true, pausedCount: 0 }
    }

    const timestamp = new Date().toISOString()

    for (const process of processes) {
        const history = process.history || []
        history.push({
            step_name: "System",
            action: "Chain Paused",
            timestamp,
        })

        const { error: updateError } = await supabase
            .from("chain_processes")
            .update({
                status: "paused",
                history,
                updated_at: timestamp,
            })
            .eq("id", process.id)

        if (updateError) {
            console.error("Error pausing process:", process.id, updateError)
            return { success: false, error: updateError.message, pausedCount: 0 }
        }
    }

    revalidatePath("/journeys")
    return { success: true, pausedCount: processes.length }
}

// ─── RESUME ALL PAUSED PROCESSES ──────────────────────────
export async function resumeAllPausedProcesses() {
    const supabase = await createClient()

    const { data: processes, error: fetchError } = await supabase
        .from("chain_processes")
        .select("id, history")
        .eq("status", "paused")

    if (fetchError) {
        console.error("Error loading paused processes:", fetchError)
        return { success: false, error: fetchError.message, resumedCount: 0 }
    }

    if (!processes || processes.length === 0) {
        return { success: true, resumedCount: 0 }
    }

    const timestamp = new Date().toISOString()

    for (const process of processes) {
        const history = process.history || []
        history.push({
            step_name: "System",
            action: "Chain Resumed",
            timestamp,
        })

        const { error: updateError } = await supabase
            .from("chain_processes")
            .update({
                status: "active",
                history,
                updated_at: timestamp,
            })
            .eq("id", process.id)

        if (updateError) {
            console.error("Error resuming process:", process.id, updateError)
            return { success: false, error: updateError.message, resumedCount: 0 }
        }

        await inngest.send({ name: "chain.resume", data: { processId: process.id } })
    }

    revalidatePath("/journeys")
    return { success: true, resumedCount: processes.length }
}

// ─── KICK CHAIN STEP (advance immediately) ─────────────────
// Manually trigger the next pending step without waiting for the timer.
// Cancels the current Inngest run, sends the email, and restarts from the new position.
export async function kickChainStep(processId: string) {
    const supabase = await createClient()

    // 1. Fetch the process
    const { data: proc, error: procError } = await supabase
        .from("chain_processes")
        .select("*")
        .eq("id", processId)
        .single()

    if (procError || !proc) {
        return { success: false, error: "Process not found" }
    }

    if (proc.status !== "active") {
        return { success: false, error: `Process is ${proc.status}, not active` }
    }

    // 2. Fetch chain steps
    const { data: steps } = await supabase
        .from("chain_steps")
        .select("*")
        .eq("chain_id", proc.chain_id)
        .order("position", { ascending: true })

    if (!steps || steps.length === 0) {
        return { success: false, error: "No steps found for this chain" }
    }

    const currentIndex = proc.current_step_index || 0
    if (currentIndex >= steps.length) {
        return { success: false, error: "Chain already completed all steps" }
    }

    const stepDef = steps[currentIndex]

    // 3. Fetch subscriber details
    const { data: subscriber } = await supabase
        .from("subscribers")
        .select("email, first_name")
        .eq("id", proc.subscriber_id)
        .single()

    if (!subscriber) {
        return { success: false, error: "Subscriber not found" }
    }

    // 4. Cancel the current Inngest run
    await inngest.send({ name: "chain.cancel", data: { processId } })

    // 5. Send the email directly
    const { sendChainEmail } = await import("@/lib/chains/sender")
    const sendResult = await sendChainEmail(
        proc.subscriber_id,
        subscriber.email,
        subscriber.first_name || "",
        stepDef.template_key
    )

    // 6. Update DB — advance current_step_index, log to history
    const history = proc.history || []
    history.push({
        step_name: stepDef.label,
        action: "Manual Kick — Email Sent",
        timestamp: new Date().toISOString(),
        details: `Campaign: ${sendResult?.campaignId || "N/A"}`,
    })

    const newIndex = currentIndex + 1
    const isCompleted = newIndex >= steps.length

    // Check if the next step needs a wait
    let nextStepAt: string | null = null
    let inngestDuration: string | null = null
    if (!isCompleted && stepDef.wait_after) {
        // Parse wait duration for the next_step_at display
        const cleaned = stepDef.wait_after.replace(/\(.*\)/, "").trim().toLowerCase()
        const match = cleaned.match(/^(\d+)\s*(day|days|d|hour|hours|h|minute|minutes|min|m|week|weeks|w)$/)
        if (match) {
            const num = parseInt(match[1])
            const unit = match[2]
            let ms = num * 86400000 // default days
            inngestDuration = `${num}d`
            
            if (unit.startsWith("min") || unit === "m") { ms = num * 60000; inngestDuration = `${num}m`; }
            else if (unit.startsWith("hour") || unit === "h") { ms = num * 3600000; inngestDuration = `${num}h`; }
            else if (unit.startsWith("week") || unit === "w") { ms = num * 7 * 86400000; inngestDuration = `${num * 7}d`; }
            
            nextStepAt = new Date(Date.now() + ms).toISOString()
        }
    }

    await supabase
        .from("chain_processes")
        .update({
            current_step_index: newIndex,
            status: isCompleted ? "completed" : "active",
            next_step_at: isCompleted ? null : nextStepAt,
            history,
            updated_at: new Date().toISOString(),
        })
        .eq("id", processId)

    // 7. If not completed, fire a new chain.run starting from the NEW index
    if (!isCompleted) {
        await inngest.send({
            name: "chain.run",
            data: {
                processId: proc.id,
                chainId: proc.chain_id,
                subscriberId: proc.subscriber_id,
                email: subscriber.email,
                firstName: subscriber.first_name || "",
                startIndex: newIndex, // skip already-sent steps
                ...(inngestDuration ? { initialSleep: inngestDuration } : {}),
                ...(proc.chain_rotation_id ? { chainRotationId: proc.chain_rotation_id } : {}),
            },
        })
    }

    revalidatePath("/journeys")
    return { success: true, completed: isCompleted, stepLabel: stepDef.label }
}
