import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
    const supabase = await createClient()
    const { subscriberId, firstName, lastName, email, campaignId } = await request.json()

    if (!subscriberId || !email) {
        return NextResponse.json({ error: "subscriberId and email are required" }, { status: 400 })
    }

    // Check if there's already a subscriber with this email (different from current)
    const { data: existing } = await supabase
        .from("subscribers")
        .select("id, first_name, last_name, email")
        .eq("email", email.trim().toLowerCase())
        .neq("id", subscriberId)
        .maybeSingle()

    if (existing) {
        // Email belongs to another subscriber — switch the campaign to that person
        if (campaignId) {
            // Get current variable_values, update subscriber_id
            const { data: campaign } = await supabase
                .from("campaigns")
                .select("variable_values")
                .eq("id", campaignId)
                .single()

            const updatedVars = { ...(campaign?.variable_values || {}), subscriber_id: existing.id }

            await supabase
                .from("campaigns")
                .update({ variable_values: updatedVars })
                .eq("id", campaignId)
        }

        return NextResponse.json({
            success: true,
            switched: true,
            subscriber: existing,
        })
    }

    // Normal update — no collision
    const { error } = await supabase
        .from("subscribers")
        .update({
            first_name: firstName,
            last_name: lastName,
            email: email.trim().toLowerCase(),
        })
        .eq("id", subscriberId)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}
