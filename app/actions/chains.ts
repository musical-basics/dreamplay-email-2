"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

// ─── Types ─────────────────────────────────────────────────
export interface ChainStepRow {
    id?: string
    chain_id?: string
    position: number
    label: string
    template_key: string
    wait_after: string | null
}

export interface ChainBranchRow {
    id?: string
    chain_id?: string
    description: string
    position: number
    label: string
    condition: string
    action: string
}

export interface ChainRow {
    id: string
    slug: string
    name: string
    description: string | null
    trigger_label: string | null
    trigger_event: string
    subscriber_id: string | null
    created_at: string
    updated_at: string
    chain_steps: ChainStepRow[]
    chain_branches: ChainBranchRow[]
    // Joined subscriber info (only for drafts)
    subscribers?: { id: string; email: string; first_name: string; last_name: string } | null
}

export interface ChainFormData {
    name: string
    slug: string
    description: string
    trigger_label: string
    trigger_event: string
    subscriber_id?: string | null
    steps: Omit<ChainStepRow, "id" | "chain_id">[]
    branches: Omit<ChainBranchRow, "id" | "chain_id">[]
}

// ─── GET MASTER CHAINS (subscriber_id is null, not snapshots) ────────────
export async function getChains(workspace: string): Promise<{ data: ChainRow[] | null; error: string | null }> {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from("email_chains")
        .select(`
            *,
            chain_steps ( * ),
            chain_branches ( * )
        `)
        .eq("workspace", workspace)
        .is("subscriber_id", null)
        .or("is_snapshot.is.null,is_snapshot.eq.false")
        .order("created_at", { ascending: true })

    if (error) return { data: null, error: error.message }

    const sorted = (data || []).map((chain: any) => ({
        ...chain,
        chain_steps: (chain.chain_steps || []).sort((a: any, b: any) => a.position - b.position),
        chain_branches: (chain.chain_branches || []).sort((a: any, b: any) => a.position - b.position),
    }))

    return { data: sorted, error: null }
}

// ─── GET DRAFT CHAINS (subscriber_id is set, not snapshots) ──────────────
export async function getDraftChains(workspace: string): Promise<{ data: ChainRow[] | null; error: string | null }> {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from("email_chains")
        .select(`
            *,
            chain_steps ( * ),
            chain_branches ( * ),
            subscribers ( id, email, first_name, last_name )
        `)
        .eq("workspace", workspace)
        .not("subscriber_id", "is", null)
        .or("is_snapshot.is.null,is_snapshot.eq.false")
        .order("created_at", { ascending: false })

    if (error) return { data: null, error: error.message }

    const sorted = (data || []).map((chain: any) => ({
        ...chain,
        chain_steps: (chain.chain_steps || []).sort((a: any, b: any) => a.position - b.position),
        chain_branches: (chain.chain_branches || []).sort((a: any, b: any) => a.position - b.position),
    }))

    return { data: sorted, error: null }
}

// ─── GET DRAFT CHAINS FOR A SPECIFIC SUBSCRIBER ────────────
export async function getDraftChainsForSubscriber(subscriberId: string): Promise<{ data: ChainRow[] | null; error: string | null }> {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from("email_chains")
        .select(`
            *,
            chain_steps ( * ),
            chain_branches ( * ),
            subscribers ( id, email, first_name, last_name )
        `)
        .eq("subscriber_id", subscriberId)
        .order("created_at", { ascending: false })

    if (error) return { data: null, error: error.message }

    const sorted = (data || []).map((chain: any) => ({
        ...chain,
        chain_steps: (chain.chain_steps || []).sort((a: any, b: any) => a.position - b.position),
        chain_branches: (chain.chain_branches || []).sort((a: any, b: any) => a.position - b.position),
    }))

    return { data: sorted, error: null }
}

export async function createChain(workspace: string, formData: ChainFormData): Promise<{ data: { id: string } | null; error: string | null }> {
    const supabase = await createClient()

    // 1. Insert the chain
    const { data: chain, error: chainError } = await supabase
        .from("email_chains")
        .insert({
            slug: formData.slug,
            name: formData.name,
            description: formData.description || null,
            trigger_label: formData.trigger_label || null,
            trigger_event: formData.trigger_event,
            subscriber_id: formData.subscriber_id || null,
            workspace,
        })
        .select("id")
        .single()

    if (chainError) return { data: null, error: chainError.message }

    // 2. Insert steps
    if (formData.steps.length > 0) {
        const stepsToInsert = formData.steps.map((step, i) => ({
            chain_id: chain.id,
            position: i + 1,
            label: step.label,
            template_key: step.template_key,
            wait_after: step.wait_after || null,
        }))

        const { error: stepsError } = await supabase.from("chain_steps").insert(stepsToInsert)
        if (stepsError) return { data: null, error: stepsError.message }
    }

    // 3. Insert branches
    if (formData.branches.length > 0) {
        const branchesToInsert = formData.branches.map((branch, i) => ({
            chain_id: chain.id,
            description: branch.description,
            position: i + 1,
            label: branch.label,
            condition: branch.condition,
            action: branch.action,
        }))

        const { error: branchError } = await supabase.from("chain_branches").insert(branchesToInsert)
        if (branchError) return { data: null, error: branchError.message }
    }

    revalidatePath("/journeys")
    return { data: { id: chain.id }, error: null }
}

// ─── UPDATE ────────────────────────────────────────────────
export async function updateChain(workspace: string, chainId: string, formData: ChainFormData): Promise<{ error: string | null }> {
    const supabase = await createClient()

    // 1. Update chain metadata
    const { error: chainError } = await supabase
        .from("email_chains")
        .update({
            slug: formData.slug,
            name: formData.name,
            description: formData.description || null,
            trigger_label: formData.trigger_label || null,
            trigger_event: formData.trigger_event,
            updated_at: new Date().toISOString(),
        })
        .eq("id", chainId)
        .eq("workspace", workspace)

    if (chainError) return { error: chainError.message }

    // 2. Replace steps: delete all, re-insert
    await supabase.from("chain_steps").delete().eq("chain_id", chainId)

    if (formData.steps.length > 0) {
        const stepsToInsert = formData.steps.map((step, i) => ({
            chain_id: chainId,
            position: i + 1,
            label: step.label,
            template_key: step.template_key,
            wait_after: step.wait_after || null,
        }))

        const { error: stepsError } = await supabase.from("chain_steps").insert(stepsToInsert)
        if (stepsError) return { error: stepsError.message }
    }

    // 3. Replace branches: delete all, re-insert
    await supabase.from("chain_branches").delete().eq("chain_id", chainId)

    if (formData.branches.length > 0) {
        const branchesToInsert = formData.branches.map((branch, i) => ({
            chain_id: chainId,
            description: branch.description,
            position: i + 1,
            label: branch.label,
            condition: branch.condition,
            action: branch.action,
        }))

        const { error: branchError } = await supabase.from("chain_branches").insert(branchesToInsert)
        if (branchError) return { error: branchError.message }
    }

    revalidatePath("/journeys")
    return { error: null }
}

// ─── DELETE ────────────────────────────────────────────────
export async function deleteChain(workspace: string, chainId: string): Promise<{ error: string | null }> {
    const supabase = await createClient()

    const { error } = await supabase
        .from("email_chains")
        .delete()
        .eq("id", chainId)
        .eq("workspace", workspace)

    if (error) return { error: error.message }

    revalidatePath("/journeys")
    return { error: null }
}

// ─── DUPLICATE CHAIN (deep copy) ───────────────────────────
// Creates a full copy of a chain including its steps and branches.
// Accepts optional overrides for the new chain's metadata.
export async function duplicateChain(
    chainId: string,
    overrides?: { subscriber_id?: string | null; name?: string; slug?: string; is_snapshot?: boolean }
): Promise<{ data: { id: string } | null; error: string | null }> {
    const supabase = await createClient()

    // 1. Fetch the source chain
    const { data: source, error: fetchError } = await supabase
        .from("email_chains")
        .select("*")
        .eq("id", chainId)
        .single()

    if (fetchError || !source) return { data: null, error: fetchError?.message || "Chain not found" }

    // 2. Fetch steps + branches
    const { data: steps } = await supabase
        .from("chain_steps")
        .select("*")
        .eq("chain_id", chainId)
        .order("position", { ascending: true })

    const { data: branches } = await supabase
        .from("chain_branches")
        .select("*")
        .eq("chain_id", chainId)
        .order("position", { ascending: true })

    // 3. Insert the new chain (inherit workspace from source)
    const { data: newChain, error: insertError } = await supabase
        .from("email_chains")
        .insert({
            slug: overrides?.slug || `${source.slug}-copy-${Date.now()}`,
            name: overrides?.name || source.name,
            description: source.description,
            trigger_label: source.trigger_label,
            trigger_event: source.trigger_event,
            subscriber_id: overrides?.subscriber_id !== undefined ? overrides.subscriber_id : source.subscriber_id,
            is_snapshot: overrides?.is_snapshot || false,
            workspace: source.workspace,
        })
        .select("id")
        .single()

    if (insertError || !newChain) return { data: null, error: insertError?.message || "Failed to create chain copy" }

    // 4. Copy steps
    if (steps && steps.length > 0) {
        const stepsToInsert = steps.map((step: any) => ({
            chain_id: newChain.id,
            position: step.position,
            label: step.label,
            template_key: step.template_key,
            wait_after: step.wait_after,
        }))
        const { error: stepsError } = await supabase.from("chain_steps").insert(stepsToInsert)
        if (stepsError) return { data: null, error: stepsError.message }
    }

    // 5. Copy branches
    if (branches && branches.length > 0) {
        const branchesToInsert = branches.map((branch: any) => ({
            chain_id: newChain.id,
            description: branch.description,
            position: branch.position,
            label: branch.label,
            condition: branch.condition,
            action: branch.action,
        }))
        const { error: branchError } = await supabase.from("chain_branches").insert(branchesToInsert)
        if (branchError) return { data: null, error: branchError.message }
    }

    revalidatePath("/journeys")
    return { data: { id: newChain.id }, error: null }
}

// ─── PROMOTE DRAFT TO MASTER ───────────────────────────────
// Creates a COPY of the draft chain as a master chain (subscriber_id = null).
// The original draft is left untouched.
export async function promoteDraftToMaster(chainId: string): Promise<{ error: string | null }> {
    const result = await duplicateChain(chainId, { subscriber_id: null })
    return { error: result.error }
}

// ─── ENRICHED CHAIN TYPES ──────────────────────────────────
export interface ChainStepWithCampaign extends ChainStepRow {
    campaign_name: string | null
    campaign_subject: string | null
    campaign_html: string | null
    campaign_variable_values: Record<string, any> | null
}

export interface ChainWithDetails {
    id: string
    slug: string
    name: string
    description: string | null
    trigger_label: string | null
    trigger_event: string
    subscriber_id: string | null
    created_at: string
    updated_at: string
    steps: ChainStepWithCampaign[]
    branches: ChainBranchRow[]
}

// ─── GET CHAIN WITH CAMPAIGN DETAILS ───────────────────────
// Fetches a chain and enriches each step with campaign data (name, subject, html).
export async function getChainWithCampaignDetails(
    chainId: string
): Promise<{ data: ChainWithDetails | null; error: string | null }> {
    const supabase = await createClient()

    // 1. Fetch chain + steps + branches
    const { data: chain, error: chainError } = await supabase
        .from("email_chains")
        .select(`
            *,
            chain_steps ( * ),
            chain_branches ( * )
        `)
        .eq("id", chainId)
        .single()

    if (chainError || !chain) {
        return { data: null, error: chainError?.message || "Chain not found" }
    }

    const sortedSteps = (chain.chain_steps || []).sort(
        (a: any, b: any) => a.position - b.position
    )
    const sortedBranches = (chain.chain_branches || []).sort(
        (a: any, b: any) => a.position - b.position
    )

    // 2. Gather unique campaign IDs from steps
    const campaignIds = [
        ...new Set(sortedSteps.map((s: any) => s.template_key).filter(Boolean)),
    ]

    // 3. Batch-fetch campaigns
    let campaignMap: Record<string, { name: string; subject_line: string | null; html_content: string | null; variable_values: Record<string, any> | null }> = {}

    if (campaignIds.length > 0) {
        const { data: campaigns } = await supabase
            .from("campaigns")
            .select("id, name, subject_line, html_content, variable_values")
            .in("id", campaignIds)

        if (campaigns) {
            for (const c of campaigns) {
                campaignMap[c.id] = {
                    name: c.name,
                    subject_line: c.subject_line,
                    html_content: c.html_content,
                    variable_values: c.variable_values,
                }
            }
        }
    }

    // 4. Enrich steps
    const enrichedSteps: ChainStepWithCampaign[] = sortedSteps.map((step: any) => {
        const campaign = campaignMap[step.template_key]
        return {
            ...step,
            campaign_name: campaign?.name || null,
            campaign_subject: campaign?.subject_line || null,
            campaign_html: campaign?.html_content || null,
            campaign_variable_values: campaign?.variable_values || null,
        }
    })

    return {
        data: {
            id: chain.id,
            slug: chain.slug,
            name: chain.name,
            description: chain.description,
            trigger_label: chain.trigger_label,
            trigger_event: chain.trigger_event,
            subscriber_id: chain.subscriber_id,
            created_at: chain.created_at,
            updated_at: chain.updated_at,
            steps: enrichedSteps,
            branches: sortedBranches,
        },
        error: null,
    }
}
