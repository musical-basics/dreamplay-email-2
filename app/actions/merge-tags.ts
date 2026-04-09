"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export interface MergeTagRow {
    id: string
    tag: string
    field_label: string
    subscriber_field: string
    default_value: string
    category: "subscriber" | "global" | "dynamic"
    created_at: string
}

export async function getMergeTags(): Promise<MergeTagRow[]> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("merge_tags")
        .select("*")
        .order("created_at", { ascending: true })

    if (error) {
        console.error("Error fetching merge tags:", error)
        return []
    }

    return data || []
}

export async function updateMergeTagDefault(id: string, defaultValue: string) {
    const supabase = await createClient()
    const { error } = await supabase
        .from("merge_tags")
        .update({ default_value: defaultValue })
        .eq("id", id)

    if (error) throw new Error(error.message)
    revalidatePath("/merge-tags")
    return { success: true }
}
