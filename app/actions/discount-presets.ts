"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export interface DiscountPreset {
    id: string
    name: string
    type: "percentage" | "fixed_amount"
    value: number
    duration_days: number
    expiry_mode: "duration" | "fixed_date"
    expires_on?: string | null
    code_prefix: string
    target_url_key: string
    usage_limit: number
    code_mode: "per_user" | "all_users"
    variant_id?: string | null
    is_active: boolean
    sort_order: number
    created_at: string
}

export async function getDiscountPresets(workspace: string): Promise<DiscountPreset[]> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("discount_presets")
        .select("*")
        .eq("workspace", workspace)
        .order("created_at", { ascending: true })

    if (error) throw new Error(error.message)
    return (data || []) as DiscountPreset[]
}

export async function getActiveDiscountPresets(workspace: string): Promise<DiscountPreset[]> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("discount_presets")
        .select("*")
        .eq("workspace", workspace)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })

    if (error) throw new Error(error.message)
    return (data || []) as DiscountPreset[]
}

export async function createDiscountPreset(workspace: string, preset: Omit<DiscountPreset, "id" | "created_at">) {
    const supabase = await createClient()
    const { error } = await supabase
        .from("discount_presets")
        .insert({ ...preset, workspace })

    if (error) throw new Error(error.message)
    revalidatePath("/discounts")
    return { success: true }
}

export async function updateDiscountPreset(workspace: string, id: string, preset: Partial<Omit<DiscountPreset, "id" | "created_at">>) {
    const supabase = await createClient()
    const { error } = await supabase
        .from("discount_presets")
        .update(preset)
        .eq("id", id)
        .eq("workspace", workspace)

    if (error) throw new Error(error.message)
    revalidatePath("/discounts")
    return { success: true }
}

export async function deleteDiscountPreset(workspace: string, id: string) {
    const supabase = await createClient()
    const { error } = await supabase
        .from("discount_presets")
        .delete()
        .eq("id", id)
        .eq("workspace", workspace)

    if (error) throw new Error(error.message)
    revalidatePath("/discounts")
    return { success: true }
}

export async function reorderDiscountPresets(workspace: string, orderedIds: string[]) {
    const supabase = await createClient()
    // Batch update sort_order for each preset
    for (let i = 0; i < orderedIds.length; i++) {
        const { error } = await supabase
            .from("discount_presets")
            .update({ sort_order: i })
            .eq("id", orderedIds[i])
            .eq("workspace", workspace)
        if (error) throw new Error(error.message)
    }
    revalidatePath("/discounts")
    return { success: true }
}
