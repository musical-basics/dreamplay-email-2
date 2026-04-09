"use server"

import { createClient } from "@/lib/supabase/server"

export async function unsubscribeUser(subscriberId: string, campaignId?: string) {
    const supabase = await createClient()

    const { error } = await supabase
        .from("subscribers")
        .update({ status: "unsubscribed" })
        .eq("id", subscriberId)

    if (error) {
        console.error("Unsubscribe error:", error)
        return { success: false, error: error.message }
    }

    // Log the unsubscribe event for attribution tracking
    await supabase.from("subscriber_events").insert({
        subscriber_id: subscriberId,
        campaign_id: campaignId || null,
        type: "unsubscribe",
    })

    return { success: true }
}
