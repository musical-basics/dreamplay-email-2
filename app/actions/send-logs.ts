"use server"

import { createClient } from "@/lib/supabase/server"

export interface SendLog {
    id: string
    campaign_id: string | null
    triggered_by: string
    status: string
    summary: { sent: number; failed: number; total: number } | null
    image_logs: Array<{ ts: string; level: string; message: string }> | null
    raw_log: string | null
    created_at: string
    campaigns?: { name: string } | null
}

export async function getSendLogs(limit = 100): Promise<SendLog[]> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("send_logs")
        .select("*, campaigns(name)")
        .order("created_at", { ascending: false })
        .limit(limit)

    if (error) {
        console.error("Error fetching send logs:", error)
        return []
    }

    return (data as SendLog[]) ?? []
}
