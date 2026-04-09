"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export interface SavedView {
    id: string
    name: string
    search_query: string
    selected_tags: string[]
    excluded_tags: string[]
    status_filter: string[]
    show_test_only: boolean
    last_emailed_sort: string | null
    created_at?: string
    updated_at?: string
}

export async function getSavedViews(workspace: string): Promise<SavedView[]> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("audience_saved_views")
        .select("*")
        .eq("workspace", workspace)
        .order("created_at", { ascending: true })

    if (error) {
        console.error("Error fetching saved views:", error)
        return []
    }
    return data || []
}

export async function createSavedView(workspace: string, view: {
    name: string
    search_query: string
    selected_tags: string[]
    excluded_tags: string[]
    status_filter: string[]
    show_test_only: boolean
    last_emailed_sort: string | null
}): Promise<SavedView | null> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("audience_saved_views")
        .insert({ ...view, workspace })
        .select()
        .single()

    if (error) {
        console.error("Error creating saved view:", error)
        return null
    }
    revalidatePath("/audience")
    return data
}

export async function deleteSavedView(workspace: string, id: string): Promise<boolean> {
    const supabase = await createClient()
    const { error } = await supabase
        .from("audience_saved_views")
        .delete()
        .eq("id", id)
        .eq("workspace", workspace)

    if (error) {
        console.error("Error deleting saved view:", error)
        return false
    }
    revalidatePath("/audience")
    return true
}

export async function updateSavedView(
    workspace: string,
    id: string,
    updates: Partial<Omit<SavedView, "id" | "created_at" | "updated_at">>
): Promise<SavedView | null> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("audience_saved_views")
        .update(updates)
        .eq("id", id)
        .eq("workspace", workspace)
        .select()
        .single()

    if (error) {
        console.error("Error updating saved view:", error)
        return null
    }
    revalidatePath("/audience")
    return data
}
