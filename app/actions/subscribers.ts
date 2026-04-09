"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

// ─── SOFT-DELETE SUBSCRIBER ────────────────────────────────
// Sets status to "deleted" instead of physically removing the row.
export async function softDeleteSubscriber(workspace: string, id: string): Promise<{ error: string | null }> {
    console.log("[softDeleteSubscriber] Starting soft-delete for subscriber:", id)
    const supabase = await createClient()

    console.log("[softDeleteSubscriber] Attempting to update status to 'deleted'...")
    const { data, error } = await supabase
        .from("subscribers")
        .update({ status: "deleted" })
        .eq("id", id)
        .eq("workspace", workspace)
        .select("id, status")

    if (error) {
        console.error("[softDeleteSubscriber] ERROR:", JSON.stringify(error, null, 2))
        return { error: error.message }
    }

    console.log("[softDeleteSubscriber] Success! Updated row:", JSON.stringify(data))
    revalidatePath("/audience")
    return { error: null }
}

// ─── BULK SOFT-DELETE SUBSCRIBERS ──────────────────────────
export async function bulkSoftDeleteSubscribers(workspace: string, ids: string[]): Promise<{ error: string | null }> {
    if (ids.length === 0) return { error: null }

    const supabase = await createClient()

    const { error } = await supabase
        .from("subscribers")
        .update({ status: "deleted" })
        .in("id", ids)
        .eq("workspace", workspace)

    if (error) return { error: error.message }

    revalidatePath("/audience")
    return { error: null }
}
