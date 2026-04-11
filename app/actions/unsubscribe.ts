"use server"

import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

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

    await supabase.from("subscriber_events").insert({
        subscriber_id: subscriberId,
        campaign_id: campaignId || null,
        type: "unsubscribe",
    })

    return { success: true }
}

/**
 * Marks every workspace row for this email as unsubscribed.
 * Used when the subscriber clicks "Unsubscribe from all our emails".
 */
export async function unsubscribeFromAll(email: string, campaignId?: string) {
    const supabase = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY!
    )

    const { data: rows, error: fetchError } = await supabase
        .from("subscribers")
        .select("id")
        .eq("email", email.toLowerCase().trim())

    if (fetchError) {
        console.error("unsubscribeFromAll fetch error:", fetchError)
        return { success: false, error: fetchError.message }
    }

    if (!rows || rows.length === 0) {
        return { success: true, count: 0 }
    }

    const ids = rows.map(r => r.id)

    const { error: updateError } = await supabase
        .from("subscribers")
        .update({ status: "unsubscribed" })
        .in("id", ids)

    if (updateError) {
        console.error("unsubscribeFromAll update error:", updateError)
        return { success: false, error: updateError.message }
    }

    // Log an event for each row
    await supabase.from("subscriber_events").insert(
        ids.map(id => ({
            subscriber_id: id,
            campaign_id: campaignId || null,
            type: "unsubscribe",
        }))
    )

    return { success: true, count: ids.length }
}
