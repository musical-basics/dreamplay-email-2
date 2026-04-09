import { CampaignLaunchChecks } from "@/components/campaign/campaign-launch-checks"
import { createClient } from "@/lib/supabase/server"
import { Campaign } from "@/lib/types"
import { notFound } from "next/navigation"

interface DashboardPageProps {
    params: Promise<{ id: string }>
}

export default async function DashboardPage({ params }: DashboardPageProps) {
    const { id } = await params
    const supabase = await createClient()

    // Fetch Campaign
    const { data: campaign, error: campaignError } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", id)
        .single()

    if (campaignError || !campaign) {
        notFound()
    }

    // Check for single subscriber lock
    let targetSubscriber = null
    const lockedSubscriberId = campaign.variable_values?.subscriber_id

    if (lockedSubscriberId) {
        const { data: subscriber } = await supabase
            .from("subscribers")
            .select("*")
            .eq("id", lockedSubscriberId)
            .single()

        targetSubscriber = subscriber
    }

    // Fetch Subscriber Count
    // If locked, count is 1. Otherwise fetch total active.
    let subscriberCount = 0
    if (lockedSubscriberId) {
        subscriberCount = 1
    } else {
        const { count, error: countError } = await supabase
            .from("subscribers")
            .select("*", { count: 'exact', head: true })
            .eq("status", "active")
        subscriberCount = count || 0
    }

    const audience = {
        total_subscribers: subscriberCount,
        active_subscribers: subscriberCount
    }

    return (
        <CampaignLaunchChecks
            campaign={campaign as Campaign}
            audience={audience}
            targetSubscriber={targetSubscriber}
        />
    )
}
