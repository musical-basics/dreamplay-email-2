"use server"

import { createClient } from "@/lib/supabase/server"

export async function getSubscriberHistory(subscriberId: string) {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('subscriber_events')
        .select(`
            *,
            campaigns ( name )
        `)
        .eq('subscriber_id', subscriberId)
        .order('created_at', { ascending: false })

    if (error) {
        console.error("Error fetching history:", error)
        return []
    }

    return data
}

export async function getSubscriberCampaigns(subscriberId: string) {
    const supabase = await createClient()

    // Get campaigns sent to this subscriber from sent_history
    const { data, error } = await supabase
        .from('sent_history')
        .select(`
            campaign_id,
            sent_at,
            campaigns ( id, name, status )
        `)
        .eq('subscriber_id', subscriberId)
        .order('sent_at', { ascending: false })

    if (error) {
        console.error("Error fetching subscriber campaigns:", error)
        return []
    }

    // Deduplicate by campaign_id, keep the most recent send
    const seen = new Set<string>()
    const unique = []
    for (const row of data || []) {
        if (row.campaign_id && !seen.has(row.campaign_id)) {
            seen.add(row.campaign_id)
            unique.push({ ...row, created_at: row.sent_at })
        }
    }
    return unique
}

export async function getSubscriberChains(subscriberId: string) {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('chain_processes')
        .select(`
            id,
            status,
            current_step_index,
            created_at,
            updated_at,
            email_chains!chain_processes_chain_id_fkey ( id, name, slug )
        `)
        .eq('subscriber_id', subscriberId)
        .order('created_at', { ascending: false })

    if (error) {
        console.error("Error fetching subscriber chains:", error)
        return []
    }

    return data || []
}

/**
 * Optimized: Get only the latest sent email per subscriber, scoped to a workspace.
 * Instead of fetching ALL sent_history rows (which grows with every campaign),
 * this fetches in batches and deduplicates server-side.
 *
 * `sent_history` has no `workspace` column directly — we scope through the
 * `subscribers!inner(workspace)` join. Without this, fresh/small workspaces
 * paid the cost of scanning every other workspace's history before the
 * "no new subscriber_ids" termination kicked in.
 */
export async function getLastSentPerSubscriber(workspace: string): Promise<Record<string, { subject: string; sentAt: string }>> {
    const supabase = await createClient()
    const lookup: Record<string, { subject: string; sentAt: string }> = {}

    // Fetch in batches of 1000 rows, ordered newest first
    // For ~500 subscribers, we typically need at most ~500 rows (1 per sub)
    // But subscribers may not have been emailed, so we fetch more to cover gaps
    let offset = 0
    const batchSize = 1000
    let allFound = false

    while (!allFound) {
        const { data, error } = await supabase
            .from("sent_history")
            .select("subscriber_id, sent_at, campaign_id, campaigns(subject_line), subscribers!inner(workspace)")
            .eq("subscribers.workspace", workspace)
            .order("sent_at", { ascending: false })
            .range(offset, offset + batchSize - 1)

        if (error || !data || data.length === 0) break

        let newEntriesThisBatch = 0
        for (const row of data as any[]) {
            if (!lookup[row.subscriber_id]) {
                const subject = row.campaigns?.subject_line
                if (subject) {
                    lookup[row.subscriber_id] = { subject, sentAt: row.sent_at }
                    newEntriesThisBatch++
                }
            }
        }

        // If this batch added no new subscribers, we've covered everyone
        if (newEntriesThisBatch === 0 || data.length < batchSize) {
            allFound = true
        }

        offset += batchSize
    }

    return lookup
}
/**
 * Get pending scheduled campaigns per subscriber, scoped to a workspace.
 * Returns a lookup of subscriber_id -> { subject, scheduledAt, campaignName }
 *
 * Both `campaigns` and `rotations` carry a `workspace` column. Without
 * filtering, fresh/small workspaces paid the cost of fetching every other
 * workspace's pending schedules.
 */
export async function getScheduledPerSubscriber(workspace: string): Promise<Record<string, { subject: string; scheduledAt: string; campaignName: string; scheduleId: string; scheduleType: 'campaign' | 'rotation' }>> {
    const supabase = await createClient()

    // Fetch scheduled campaigns AND scheduled rotations in parallel
    const [campaignResult, rotationResult] = await Promise.all([
        supabase
            .from("campaigns")
            .select("id, name, subject_line, scheduled_at, variable_values")
            .eq("workspace", workspace)
            .eq("scheduled_status", "pending")
            .not("scheduled_at", "is", null),
        supabase
            .from("rotations")
            .select("id, name, scheduled_at, scheduled_subscriber_ids")
            .eq("workspace", workspace)
            .eq("scheduled_status", "pending")
            .not("scheduled_at", "is", null),
    ])

    const lookup: Record<string, { subject: string; scheduledAt: string; campaignName: string; scheduleId: string; scheduleType: 'campaign' | 'rotation' }> = {}

    // Process scheduled campaigns
    const campaigns = campaignResult.data || []
    for (const campaign of campaigns) {
        const subjectLine = campaign.subject_line || campaign.name || "Untitled"
        const scheduledAt = campaign.scheduled_at

        const subscriberId = campaign.variable_values?.subscriber_id
        const subscriberIds: string[] | undefined = campaign.variable_values?.subscriber_ids

        if (subscriberIds && subscriberIds.length > 0) {
            // Multi-subscriber targeting
            for (const sid of subscriberIds) {
                if (!lookup[sid]) {
                    lookup[sid] = { subject: subjectLine, scheduledAt, campaignName: campaign.name, scheduleId: campaign.id, scheduleType: 'campaign' }
                }
            }
        } else if (subscriberId) {
            // Single-subscriber targeting
            if (!lookup[subscriberId]) {
                lookup[subscriberId] = { subject: subjectLine, scheduledAt, campaignName: campaign.name, scheduleId: campaign.id, scheduleType: 'campaign' }
            }
        }
        // Campaigns with no subscriber targeting are broadcast-scheduled
        // — don't show per-subscriber since it applies to everyone
    }

    // Process scheduled rotations
    const rotations = rotationResult.data || []
    for (const rotation of rotations) {
        const scheduledAt = rotation.scheduled_at
        const subscriberIds: string[] | undefined = rotation.scheduled_subscriber_ids

        if (subscriberIds && subscriberIds.length > 0) {
            for (const sid of subscriberIds) {
                if (!lookup[sid]) {
                    lookup[sid] = {
                        subject: `Rotation: ${rotation.name || "Untitled"}`,
                        scheduledAt,
                        campaignName: rotation.name || "Rotation",
                        scheduleId: rotation.id,
                        scheduleType: 'rotation',
                    }
                }
            }
        }
    }

    return lookup
}
