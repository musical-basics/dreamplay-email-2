"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { startChainProcess } from "@/app/actions/chain-processes"

// ─── List all chain rotations ─────────────────────────────────────
export async function getChainRotations(workspace: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("chain_rotations")
        .select("*")
        .eq("workspace", workspace)
        .order("created_at", { ascending: false })

    if (error) {
        console.error("Error fetching chain rotations:", error)
        return []
    }

    // Resolve chain names
    const allChainIds = [...new Set((data || []).flatMap((r: any) => r.chain_ids || []))]
    let chainMap: Record<string, { name: string; stepsCount: number }> = {}
    if (allChainIds.length > 0) {
        const { data: chains } = await supabase
            .from("email_chains")
            .select("id, name, chain_steps ( id )")
            .in("id", allChainIds)
        if (chains) {
            chainMap = Object.fromEntries(
                chains.map((c: any) => [c.id, {
                    name: c.name,
                    stepsCount: c.chain_steps?.length || 0,
                }])
            )
        }
    }

    return (data || []).map((r: any) => ({
        ...r,
        chains: (r.chain_ids || []).map((id: string) => ({
            id,
            name: chainMap[id]?.name || "Unknown Chain",
            stepsCount: chainMap[id]?.stepsCount || 0,
        })),
    }))
}

// ─── Get single chain rotation with details ───────────────────────
export async function getChainRotation(id: string) {
    const supabase = await createClient()
    const { data: rotation, error } = await supabase
        .from("chain_rotations")
        .select("*")
        .eq("id", id)
        .single()

    if (error || !rotation) {
        console.error("Error fetching chain rotation:", error)
        return null
    }

    const chainIds = rotation.chain_ids || []
    let chains: any[] = []
    if (chainIds.length > 0) {
        const { data } = await supabase
            .from("email_chains")
            .select("id, name, slug, chain_steps ( id, position, label, template_key )")
            .in("id", chainIds)
        chains = data || []
    }

    // Preserve order from chain_ids
    const chainMap = Object.fromEntries(chains.map((c: any) => [c.id, c]))
    const orderedChains = chainIds.map((id: string) => chainMap[id] || { id, name: "Unknown", slug: "", chain_steps: [] })

    return {
        ...rotation,
        chains: orderedChains,
    }
}

// ─── Get chain rotation analytics ─────────────────────────────────
export async function getChainRotationAnalytics(rotationId: string) {
    const supabase = await createClient()

    // Get rotation to know chain_ids
    const { data: rotation } = await supabase
        .from("chain_rotations")
        .select("chain_ids")
        .eq("id", rotationId)
        .single()

    if (!rotation) return []

    const chainIds: string[] = rotation.chain_ids || []

    // Get chain names
    const chainNames: Record<string, string> = {}
    if (chainIds.length > 0) {
        const { data: chains } = await supabase
            .from("email_chains")
            .select("id, name")
            .in("id", chainIds)
        if (chains) {
            chains.forEach((c: any) => { chainNames[c.id] = c.name })
        }
    }

    // Get all chain_processes for this rotation (with original_chain_id)
    const { data: processes } = await supabase
        .from("chain_processes")
        .select("id, original_chain_id, subscriber_id, status, created_at")
        .eq("chain_rotation_id", rotationId)

    // Group processes by original_chain_id
    const processGroups: Record<string, { enrolled: number; completed: number }> = {}
    const subToChain: Record<string, string> = {}
    for (const chainId of chainIds) {
        processGroups[chainId] = { enrolled: 0, completed: 0 }
    }
    for (const proc of (processes || [])) {
        const masterChainId = proc.original_chain_id
        if (masterChainId && processGroups[masterChainId]) {
            processGroups[masterChainId].enrolled++
            if (proc.status === "completed") processGroups[masterChainId].completed++
            subToChain[proc.subscriber_id] = masterChainId
        }
    }

    // Get all completed campaign copies for this rotation
    const { data: campaignCopies } = await supabase
        .from("campaigns")
        .select("id")
        .eq("chain_rotation_id", rotationId)

    const copyCampaignIds = (campaignCopies || []).map((c: any) => c.id)

    // Initialize per-chain counters
    const sendsByChain: Record<string, number> = {}
    const opensByChain: Record<string, number> = {}
    const clicksByChain: Record<string, number> = {}
    for (const chainId of chainIds) {
        sendsByChain[chainId] = 0
        opensByChain[chainId] = 0
        clicksByChain[chainId] = 0
    }

    if (copyCampaignIds.length > 0) {
        // Count sends
        const { data: sentRows } = await supabase
            .from("sent_history")
            .select("campaign_id, subscriber_id")
            .in("campaign_id", copyCampaignIds)

        for (const row of (sentRows || [])) {
            const chainId = subToChain[row.subscriber_id]
            if (chainId && sendsByChain[chainId] !== undefined) {
                sendsByChain[chainId]++
            }
        }

        // Count unique opens (deduplicate by subscriber per chain)
        const { data: openEvents } = await supabase
            .from("subscriber_events")
            .select("campaign_id, subscriber_id")
            .eq("type", "open")
            .in("campaign_id", copyCampaignIds)

        const openSeen: Record<string, Set<string>> = {}
        for (const chainId of chainIds) openSeen[chainId] = new Set()
        for (const ev of (openEvents || [])) {
            const chainId = subToChain[ev.subscriber_id]
            if (chainId && openSeen[chainId] && !openSeen[chainId].has(ev.subscriber_id)) {
                openSeen[chainId].add(ev.subscriber_id)
                opensByChain[chainId]++
            }
        }

        // Count unique clicks (deduplicate by subscriber per chain)
        const { data: clickEvents } = await supabase
            .from("subscriber_events")
            .select("campaign_id, subscriber_id")
            .eq("type", "click")
            .in("campaign_id", copyCampaignIds)

        const clickSeen: Record<string, Set<string>> = {}
        for (const chainId of chainIds) clickSeen[chainId] = new Set()
        for (const ev of (clickEvents || [])) {
            const chainId = subToChain[ev.subscriber_id]
            if (chainId && clickSeen[chainId] && !clickSeen[chainId].has(ev.subscriber_id)) {
                clickSeen[chainId].add(ev.subscriber_id)
                clicksByChain[chainId]++
            }
        }
    }

    return chainIds.map((chainId: string) => ({
        chainId,
        chainName: chainNames[chainId] || "Unknown",
        enrolled: processGroups[chainId]?.enrolled || 0,
        completed: processGroups[chainId]?.completed || 0,
        sends: sendsByChain[chainId] || 0,
        opens: opensByChain[chainId] || 0,
        clicks: clicksByChain[chainId] || 0,
        openRate: sendsByChain[chainId] > 0 ? Math.round((opensByChain[chainId] / sendsByChain[chainId]) * 100) : 0,
        clickRate: sendsByChain[chainId] > 0 ? Math.round((clicksByChain[chainId] / sendsByChain[chainId]) * 100) : 0,
    }))
}

// ─── Enroll subscribers into a chain rotation ─────────────────────
export async function enrollInChainRotation(
    rotationId: string,
    subscriberIds: string[]
) {
    const supabase = await createClient()

    // Fetch rotation
    const { data: rotation, error: rotError } = await supabase
        .from("chain_rotations")
        .select("*")
        .eq("id", rotationId)
        .single()

    if (rotError || !rotation) {
        return { success: false, error: "Chain rotation not found" }
    }

    const chainIds: string[] = rotation.chain_ids
    const totalChains = chainIds.length
    if (totalChains === 0) {
        return { success: false, error: "No chains in this rotation" }
    }

    let cursor = rotation.cursor_position || 0
    const results: { subscriberId: string; chainId: string; success: boolean; error?: string }[] = []

    for (const subscriberId of subscriberIds) {
        const assignedChainId = chainIds[cursor % totalChains]

        // Start the chain process with rotation tracking
        const result = await startChainProcess(subscriberId, assignedChainId, {
            chainRotationId: rotationId,
            originalChainId: assignedChainId,
        })

        results.push({
            subscriberId,
            chainId: assignedChainId,
            success: result.success,
            error: result.error,
        })

        if (result.success) {
            cursor++
        }
    }

    // Update cursor position
    await supabase
        .from("chain_rotations")
        .update({
            cursor_position: cursor % totalChains,
            updated_at: new Date().toISOString(),
        })
        .eq("id", rotationId)

    revalidatePath("/chain-rotations")
    return {
        success: true,
        results,
        newCursorPosition: cursor % totalChains,
    }
}

// ─── Create chain rotation ────────────────────────────────────────
export async function createChainRotation(workspace: string, name: string, chainIds: string[]) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("chain_rotations")
        .insert({
            name,
            chain_ids: chainIds,
            cursor_position: 0,
            workspace,
        })
        .select()
        .single()

    if (error) {
        console.error("Error creating chain rotation:", error)
        return { success: false, error: error.message }
    }

    revalidatePath("/chain-rotations")
    return { success: true, data }
}

// ─── Update chain rotation ────────────────────────────────────────
export async function updateChainRotation(workspace: string, id: string, name: string, chainIds: string[]) {
    const supabase = await createClient()

    const { data: current } = await supabase
        .from("chain_rotations")
        .select("chain_ids")
        .eq("id", id)
        .single()

    const orderChanged = JSON.stringify(current?.chain_ids) !== JSON.stringify(chainIds)

    const updateData: any = {
        name,
        chain_ids: chainIds,
        updated_at: new Date().toISOString(),
    }

    if (orderChanged) {
        updateData.cursor_position = 0
    }

    const { error } = await supabase
        .from("chain_rotations")
        .update(updateData)
        .eq("id", id)

    if (error) {
        console.error("Error updating chain rotation:", error)
        return { success: false, error: error.message }
    }

    revalidatePath("/chain-rotations")
    revalidatePath(`/chain-rotations/${id}`)
    return { success: true }
}

// ─── Delete chain rotation ────────────────────────────────────────
export async function deleteChainRotation(workspace: string, id: string) {
    const supabase = await createClient()

    // Null out chain_rotation_id on campaigns
    await supabase
        .from("campaigns")
        .update({ chain_rotation_id: null })
        .eq("chain_rotation_id", id)

    // Null out chain_rotation_id on chain_processes
    await supabase
        .from("chain_processes")
        .update({ chain_rotation_id: null })
        .eq("chain_rotation_id", id)

    const { error } = await supabase
        .from("chain_rotations")
        .delete()
        .eq("id", id)

    if (error) {
        console.error("Error deleting chain rotation:", error)
        return { success: false, error: error.message }
    }

    revalidatePath("/chain-rotations")
    return { success: true }
}
