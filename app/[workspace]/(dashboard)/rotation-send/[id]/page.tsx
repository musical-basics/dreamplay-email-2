import { getRotationWithTemplates } from "@/app/actions/rotations"
import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import { RotationLaunch } from "@/components/rotation/rotation-launch"

interface RotationSendPageProps {
    params: Promise<{ id: string }>
    searchParams: Promise<{ subscriberIds?: string }>
}

export default async function RotationSendPage({ params, searchParams }: RotationSendPageProps) {
    const { id } = await params
    const { subscriberIds } = await searchParams

    // Fetch rotation with full template content
    const rotation = await getRotationWithTemplates(id)
    if (!rotation) {
        notFound()
    }

    const campaignIds: string[] = rotation.campaign_ids || []
    const totalCampaigns = campaignIds.length

    if (totalCampaigns === 0) {
        notFound()
    }

    // Parse subscriber IDs
    const allSubscriberIds = subscriberIds
        ? subscriberIds.split(",").filter(Boolean)
        : []

    if (allSubscriberIds.length === 0) {
        notFound()
    }

    // Fetch subscriber data
    const supabase = await createClient()
    const { data: subscribers } = await supabase
        .from("subscribers")
        .select("id, email, first_name, last_name, tags, status")
        .in("id", allSubscriberIds)
        .eq("status", "active")

    if (!subscribers || subscribers.length === 0) {
        notFound()
    }

    // Compute round-robin assignments using cursor_position
    let cursor = rotation.cursor_position || 0
    const assignments: { subscriberId: string; campaignId: string }[] = []

    for (const sub of subscribers) {
        const assignedCampaignId = campaignIds[cursor % totalCampaigns]
        assignments.push({ subscriberId: sub.id, campaignId: assignedCampaignId })
        cursor++
    }

    // Build campaign lookup map from the rotation's ordered campaigns
    const campaignMap: Record<string, any> = {}
    for (const c of rotation.campaigns) {
        campaignMap[c.id] = c
    }

    return (
        <RotationLaunch
            rotation={rotation}
            subscribers={subscribers}
            assignments={assignments}
            campaignMap={campaignMap}
        />
    )
}
