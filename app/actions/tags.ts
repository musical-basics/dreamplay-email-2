"use server"

import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

export interface TagDefinition {
    id: string
    name: string
    color: string
    is_starred: boolean
    created_at: string
    updated_at: string
    subscriber_count?: number
}

export async function getTags(workspace: string): Promise<{ tags: TagDefinition[]; error?: string }> {
    const { data, error } = await supabase
        .from("tag_definitions")
        .select("*")
        .eq("workspace", workspace)
        .order("name", { ascending: true })

    if (error) return { tags: [], error: error.message }

    // Count subscribers per tag (workspace-scoped)
    const { data: subscribers } = await supabase
        .from("subscribers")
        .select("tags")
        .eq("workspace", workspace)
        .not("tags", "is", null)

    const tagCounts: Record<string, number> = {}
    for (const sub of subscribers || []) {
        for (const tag of sub.tags || []) {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1
        }
    }

    const tagsWithCounts = (data || []).map((t: any) => ({
        ...t,
        subscriber_count: tagCounts[t.name] || 0,
    }))

    return { tags: tagsWithCounts }
}

export async function createTag(workspace: string, name: string, color: string): Promise<{ tag?: TagDefinition; error?: string }> {
    const trimmed = name.trim()
    if (!trimmed) return { error: "Tag name is required" }

    const { data, error } = await supabase
        .from("tag_definitions")
        .insert({ name: trimmed, color, workspace })
        .select()
        .single()

    if (error) return { error: error.message }
    return { tag: data }
}

export async function updateTag(workspace: string, id: string, updates: { name?: string; color?: string }): Promise<{ success: boolean; error?: string }> {
    // If renaming, also update all subscriber tags arrays
    if (updates.name) {
        const { data: existing } = await supabase
            .from("tag_definitions")
            .select("name")
            .eq("id", id)
            .eq("workspace", workspace)
            .single()

        if (existing && existing.name !== updates.name) {
            const oldName = existing.name
            const newName = updates.name.trim()

            // Find all subscribers with the old tag (workspace-scoped)
            const { data: subs } = await supabase
                .from("subscribers")
                .select("id, tags")
                .eq("workspace", workspace)
                .contains("tags", [oldName])

            // Update each subscriber's tags array
            for (const sub of subs || []) {
                const newTags = (sub.tags || []).map((t: string) => t === oldName ? newName : t)
                await supabase
                    .from("subscribers")
                    .update({ tags: newTags })
                    .eq("id", sub.id)
                    .eq("workspace", workspace)
            }

            updates.name = newName
        }
    }

    const { error } = await supabase
        .from("tag_definitions")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("workspace", workspace)

    if (error) return { success: false, error: error.message }
    return { success: true }
}

export async function toggleTagStar(workspace: string, id: string, isStarred: boolean): Promise<{ success: boolean; error?: string }> {
    const { error } = await supabase
        .from("tag_definitions")
        .update({ is_starred: isStarred, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("workspace", workspace)

    if (error) return { success: false, error: error.message }
    return { success: true }
}

export async function deleteTag(workspace: string, id: string): Promise<{ success: boolean; error?: string }> {
    // Get the tag name first
    const { data: tag } = await supabase
        .from("tag_definitions")
        .select("name")
        .eq("id", id)
        .eq("workspace", workspace)
        .single()

    if (!tag) return { success: false, error: "Tag not found" }

    // Remove the tag from all subscribers (workspace-scoped)
    const { data: subs } = await supabase
        .from("subscribers")
        .select("id, tags")
        .eq("workspace", workspace)
        .contains("tags", [tag.name])

    for (const sub of subs || []) {
        const newTags = (sub.tags || []).filter((t: string) => t !== tag.name)
        await supabase
            .from("subscribers")
            .update({ tags: newTags })
            .eq("id", sub.id)
            .eq("workspace", workspace)
    }

    // Delete the definition
    const { error } = await supabase
        .from("tag_definitions")
        .delete()
        .eq("id", id)
        .eq("workspace", workspace)

    if (error) return { success: false, error: error.message }
    return { success: true }
}

/**
 * Ensures that every tag name in the array has a corresponding row in tag_definitions.
 * Tags that already exist are skipped. New ones get a random default color.
 */
export async function ensureTagDefinitions(workspace: string, tagNames: string[]): Promise<{ error?: string }> {
    if (!tagNames || tagNames.length === 0) return {}

    const unique = [...new Set(tagNames.map(t => t.trim()).filter(Boolean))]
    if (unique.length === 0) return {}

    // Fetch existing definitions (workspace-scoped)
    const { data: existing, error: fetchError } = await supabase
        .from("tag_definitions")
        .select("name")
        .eq("workspace", workspace)

    if (fetchError) return { error: fetchError.message }

    const existingNames = new Set((existing || []).map((t: any) => t.name))
    const missing = unique.filter(name => !existingNames.has(name))

    if (missing.length === 0) return {}

    // Generate a default color for each missing tag
    const defaultColors = ["#6b7280", "#9ca3af", "#78716c", "#a1a1aa", "#737373"]
    const rows = missing.map((name, i) => ({
        name,
        color: defaultColors[i % defaultColors.length],
        workspace,
    }))

    const { error: insertError } = await supabase
        .from("tag_definitions")
        .insert(rows)

    if (insertError) return { error: insertError.message }
    return {}
}

/**
 * One-time sync: scans all subscriber tags and creates missing tag_definitions.
 */
export async function syncAllSubscriberTags(workspace: string): Promise<{ created: string[]; error?: string }> {
    // Get all subscriber tags (workspace-scoped)
    const { data: subscribers, error: fetchError } = await supabase
        .from("subscribers")
        .select("tags")
        .eq("workspace", workspace)
        .not("tags", "is", null)

    if (fetchError) return { created: [], error: fetchError.message }

    const allTags = new Set<string>()
    for (const sub of subscribers || []) {
        for (const tag of sub.tags || []) {
            if (tag.trim()) allTags.add(tag.trim())
        }
    }

    if (allTags.size === 0) return { created: [] }

    // Get existing definitions (workspace-scoped)
    const { data: existing } = await supabase
        .from("tag_definitions")
        .select("name")
        .eq("workspace", workspace)

    const existingNames = new Set((existing || []).map((t: any) => t.name))
    const missing = [...allTags].filter(name => !existingNames.has(name))

    if (missing.length === 0) return { created: [] }

    const defaultColors = ["#6b7280", "#9ca3af", "#78716c", "#a1a1aa", "#737373"]
    const rows = missing.map((name, i) => ({
        name,
        color: defaultColors[i % defaultColors.length],
        workspace,
    }))

    const { error: insertError } = await supabase
        .from("tag_definitions")
        .insert(rows)

    if (insertError) return { created: [], error: insertError.message }
    return { created: missing }
}
