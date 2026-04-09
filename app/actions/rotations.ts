"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

// ─── List all rotations ───────────────────────────────────────────
export async function getRotations(workspace: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("rotations")
        .select("*")
        .eq("workspace", workspace)
        .order("created_at", { ascending: false })

    if (error) {
        console.error("Error fetching rotations:", error)
        return []
    }

    // Resolve campaign names for each rotation
    const allCampaignIds = [...new Set((data || []).flatMap((r: any) => r.campaign_ids || []))]
    let campaignMap: Record<string, string> = {}
    if (allCampaignIds.length > 0) {
        const { data: campaigns } = await supabase
            .from("campaigns")
            .select("id, name")
            .in("id", allCampaignIds)
        if (campaigns) {
            campaignMap = Object.fromEntries(campaigns.map((c: any) => [c.id, c.name]))
        }
    }

    return (data || []).map((r: any) => ({
        ...r,
        campaigns: (r.campaign_ids || []).map((id: string) => ({
            id,
            name: campaignMap[id] || "Unknown Campaign",
        })),
    }))
}

// ─── Get single rotation with analytics ──────────────────────────
export async function getRotation(id: string) {
    const supabase = await createClient()
    const { data: rotation, error } = await supabase
        .from("rotations")
        .select("*")
        .eq("id", id)
        .single()

    if (error || !rotation) {
        console.error("Error fetching rotation:", error)
        return null
    }

    // Resolve campaign details
    const campaignIds = rotation.campaign_ids || []
    let campaigns: any[] = []
    if (campaignIds.length > 0) {
        const { data } = await supabase
            .from("campaigns")
            .select("id, name, subject_line")
            .in("id", campaignIds)
        campaigns = data || []
    }

    // Preserve order from campaign_ids
    const campaignMap = Object.fromEntries(campaigns.map((c: any) => [c.id, c]))
    const orderedCampaigns = campaignIds.map((id: string) => campaignMap[id] || { id, name: "Unknown", subject_line: "" })

    return {
        ...rotation,
        campaigns: orderedCampaigns,
    }
}

// ─── Get rotation with full template content (for preview rendering) ──
export async function getRotationWithTemplates(id: string) {
    const supabase = await createClient()
    const { data: rotation, error } = await supabase
        .from("rotations")
        .select("*")
        .eq("id", id)
        .single()

    if (error || !rotation) {
        console.error("Error fetching rotation:", error)
        return null
    }

    const campaignIds = rotation.campaign_ids || []
    let campaigns: any[] = []
    if (campaignIds.length > 0) {
        const { data } = await supabase
            .from("campaigns")
            .select("id, name, subject_line, html_content, variable_values")
            .in("id", campaignIds)
        campaigns = data || []
    }

    // Preserve order from campaign_ids
    const campaignMap = Object.fromEntries(campaigns.map((c: any) => [c.id, c]))
    const orderedCampaigns = campaignIds.map((id: string) => campaignMap[id] || {
        id, name: "Unknown", subject_line: "", html_content: null, variable_values: null
    })

    return {
        ...rotation,
        campaigns: orderedCampaigns,
    }
}

// ─── Get rotation analytics (per-campaign stats from child campaigns) ──
export async function getRotationAnalytics(rotationId: string) {
    const supabase = await createClient()

    // Get rotation to know campaign_ids
    const { data: rotation } = await supabase
        .from("rotations")
        .select("campaign_ids")
        .eq("id", rotationId)
        .single()

    if (!rotation) return []

    // Get all child campaigns for this rotation
    const { data: children } = await supabase
        .from("campaigns")
        .select("id, name, parent_template_id, total_recipients, total_opens, total_clicks, created_at, status")
        .eq("rotation_id", rotationId)
        .order("created_at", { ascending: false })

    if (!children || children.length === 0) return []

    // Group by parent_template_id and aggregate
    const templateIds = rotation.campaign_ids || []
    const templateNames: Record<string, string> = {}

    // Fetch template names
    if (templateIds.length > 0) {
        const { data: templates } = await supabase
            .from("campaigns")
            .select("id, name")
            .in("id", templateIds)
        if (templates) {
            templates.forEach((t: any) => { templateNames[t.id] = t.name })
        }
    }

    // Aggregate per template
    const stats = templateIds.map((templateId: string) => {
        const templateChildren = children.filter((c: any) => c.parent_template_id === templateId)
        const totalRecipients = templateChildren.reduce((sum: number, c: any) => sum + (c.total_recipients || 0), 0)
        const totalOpens = templateChildren.reduce((sum: number, c: any) => sum + (c.total_opens || 0), 0)
        const totalClicks = templateChildren.reduce((sum: number, c: any) => sum + (c.total_clicks || 0), 0)

        return {
            templateId,
            templateName: templateNames[templateId] || "Unknown",
            sends: totalRecipients,
            opens: totalOpens,
            clicks: totalClicks,
            openRate: totalRecipients > 0 ? Math.round((totalOpens / totalRecipients) * 100) : 0,
            clickRate: totalRecipients > 0 ? Math.round((totalClicks / totalRecipients) * 100) : 0,
            childCampaigns: templateChildren,
        }
    })

    return stats
}

// ─── Create rotation ─────────────────────────────────────────────
export async function createRotation(workspace: string, name: string, campaignIds: string[]) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("rotations")
        .insert({
            name,
            campaign_ids: campaignIds,
            cursor_position: 0,
            workspace,
        })
        .select()
        .single()

    if (error) {
        console.error("Error creating rotation:", error)
        return { success: false, error: error.message }
    }

    revalidatePath("/rotations")
    return { success: true, data }
}

// ─── Update rotation ─────────────────────────────────────────────
export async function updateRotation(workspace: string, id: string, name: string, campaignIds: string[]) {
    const supabase = await createClient()

    // Get current rotation to check if order changed
    const { data: current } = await supabase
        .from("rotations")
        .select("campaign_ids")
        .eq("id", id)
        .single()

    const orderChanged = JSON.stringify(current?.campaign_ids) !== JSON.stringify(campaignIds)

    const updateData: any = {
        name,
        campaign_ids: campaignIds,
        updated_at: new Date().toISOString(),
    }

    // Reset cursor if campaign order changed
    if (orderChanged) {
        updateData.cursor_position = 0
    }

    const { error } = await supabase
        .from("rotations")
        .update(updateData)
        .eq("id", id)
        .eq("workspace", workspace)

    if (error) {
        console.error("Error updating rotation:", error)
        return { success: false, error: error.message }
    }

    revalidatePath("/rotations")
    revalidatePath(`/rotations/${id}`)
    return { success: true }
}

// ─── Delete rotation ─────────────────────────────────────────────
export async function deleteRotation(workspace: string, id: string) {
    const supabase = await createClient()

    // Null out rotation_id on child campaigns
    await supabase
        .from("campaigns")
        .update({ rotation_id: null })
        .eq("rotation_id", id)

    const { error } = await supabase
        .from("rotations")
        .delete()
        .eq("id", id)

    if (error) {
        console.error("Error deleting rotation:", error)
        return { success: false, error: error.message }
    }

    revalidatePath("/rotations")
    return { success: true }
}

// ─── Advance cursor (called after rotation send) ─────────────────
export async function advanceRotationCursor(id: string, advanceBy: number) {
    const supabase = await createClient()

    const { data: rotation } = await supabase
        .from("rotations")
        .select("campaign_ids, cursor_position")
        .eq("id", id)
        .single()

    if (!rotation) return { success: false, error: "Rotation not found" }

    const total = rotation.campaign_ids.length
    const newPosition = (rotation.cursor_position + advanceBy) % total

    const { error } = await supabase
        .from("rotations")
        .update({
            cursor_position: newPosition,
            updated_at: new Date().toISOString(),
        })
        .eq("id", id)

    if (error) {
        console.error("Error advancing cursor:", error)
        return { success: false, error: error.message }
    }

    return { success: true, newPosition }
}

// ─── Get subscribers who already received from this rotation ──────
export async function getRotationReceivedSubscribers(rotationId: string): Promise<Set<string>> {
    const supabase = await createClient()

    // Get all child campaign IDs for this rotation
    const { data: children } = await supabase
        .from("campaigns")
        .select("id")
        .eq("rotation_id", rotationId)

    if (!children || children.length === 0) return new Set()

    const childIds = children.map((c: any) => c.id)

    // Get all subscriber IDs who received any of these campaigns
    const { data: history } = await supabase
        .from("sent_history")
        .select("subscriber_id")
        .in("campaign_id", childIds)

    if (!history) return new Set()

    return new Set(history.map((h: any) => h.subscriber_id))
}
