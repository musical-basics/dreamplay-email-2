"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export interface EmailTrigger {
    id: string
    name: string
    trigger_type: string
    trigger_value: string
    action_type: string          // "send_automated_email" | "start_chain"
    campaign_id: string | null
    chain_id: string | null
    generate_discount: boolean
    discount_config: {
        type: "percentage" | "fixed_amount"
        value: number
        durationDays: number
        codePrefix: string
        usageLimit: number
    } | null
    is_active: boolean
    created_at: string
    // Joined
    campaign_name?: string
    chain_name?: string
}

export async function getTriggers(workspace: string): Promise<EmailTrigger[]> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("email_triggers")
        .select("*, campaigns(name), email_chains(name)")
        .eq("workspace", workspace)
        .order("created_at", { ascending: true })

    if (error) {
        console.error("Error fetching triggers:", error)
        return []
    }

    return (data || []).map((t: any) => ({
        ...t,
        campaign_name: t.campaigns?.name || null,
        chain_name: t.email_chains?.name || null,
    }))
}

export async function createTrigger(workspace: string, trigger: Omit<EmailTrigger, "id" | "created_at" | "campaign_name" | "chain_name">) {
    const supabase = await createClient()
    const { error } = await supabase
        .from("email_triggers")
        .insert({
            name: trigger.name,
            trigger_type: trigger.trigger_type,
            trigger_value: trigger.trigger_value,
            action_type: trigger.action_type,
            campaign_id: trigger.campaign_id,
            chain_id: trigger.chain_id,
            generate_discount: trigger.generate_discount,
            discount_config: trigger.discount_config,
            is_active: trigger.is_active,
            workspace,
        })

    if (error) throw new Error(error.message)
    revalidatePath("/triggers")
    return { success: true }
}

export async function updateTrigger(workspace: string, id: string, updates: Partial<Omit<EmailTrigger, "id" | "created_at" | "campaign_name" | "chain_name">>) {
    const supabase = await createClient()
    const { error } = await supabase
        .from("email_triggers")
        .update(updates)
        .eq("id", id)
        .eq("workspace", workspace)

    if (error) throw new Error(error.message)
    revalidatePath("/triggers")
    return { success: true }
}

export async function deleteTrigger(workspace: string, id: string) {
    const supabase = await createClient()
    const { error } = await supabase
        .from("email_triggers")
        .delete()
        .eq("id", id)
        .eq("workspace", workspace)

    if (error) throw new Error(error.message)
    revalidatePath("/triggers")
    return { success: true }
}
