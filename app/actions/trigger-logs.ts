"use server"

import { createClient } from "@/lib/supabase/server"

export interface TriggerLog {
    id: string
    level: "info" | "warn" | "error" | "success"
    event: string
    details: Record<string, any>
    created_at: string
}

export async function getTriggerLogs(limit = 100): Promise<TriggerLog[]> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("trigger_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit)

    if (error) {
        console.error("Error fetching trigger logs:", error)
        return []
    }

    return data || []
}

export async function clearTriggerLogs() {
    const supabase = await createClient()
    const { error } = await supabase
        .from("trigger_logs")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000") // delete all

    if (error) throw new Error(error.message)
    return { success: true }
}
