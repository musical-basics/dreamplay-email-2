"use server"

import { createClient } from "@/lib/supabase/server"

// ─── Subscriber list with journey summary (for Customer Journeys tab) ─────
export async function getSubscribersWithJourneySummary() {
    const supabase = await createClient()

    // 1. Fetch all subscribers
    const { data: subscribers, error } = await supabase
        .from("subscribers")
        .select("id, email, first_name, last_name, tags, status, created_at")
        .order("created_at", { ascending: false })

    if (error || !subscribers) {
        console.error("Error fetching subscribers:", error)
        return []
    }

    const subIds = subscribers.map(s => s.id)
    if (subIds.length === 0) return []

    // 2. Count sent emails per subscriber (from sent_history — the actual send log)
    const { data: sentCounts } = await supabase
        .from("sent_history")
        .select("subscriber_id")
        .in("subscriber_id", subIds)

    const sentCountMap: Record<string, number> = {}
    for (const row of sentCounts || []) {
        sentCountMap[row.subscriber_id] = (sentCountMap[row.subscriber_id] || 0) + 1
    }

    // 3. Count active chain processes per subscriber
    const { data: activeChains } = await supabase
        .from("chain_processes")
        .select("subscriber_id, status")
        .in("subscriber_id", subIds)
        .in("status", ["active", "paused"])

    const chainCountMap: Record<string, number> = {}
    for (const row of activeChains || []) {
        chainCountMap[row.subscriber_id] = (chainCountMap[row.subscriber_id] || 0) + 1
    }

    // 4. Combine
    return subscribers.map(sub => ({
        ...sub,
        emails_received: sentCountMap[sub.id] || 0,
        active_chains: chainCountMap[sub.id] || 0,
    }))
}

// ─── Subscriber journey detail (for the inline drawer) ───────────────────
export interface JourneyCampaignEntry {
    campaign_id: string
    campaign_name: string
    subject_line: string
    sent_at: string
    was_opened: boolean
    was_clicked: boolean
    clicked_urls: string[]
}

export async function getSubscriberJourneyDetail(subscriberId: string) {
    const supabase = await createClient()

    // 1. Get all sends from sent_history (the actual record of emails delivered)
    const { data: sentRows } = await supabase
        .from("sent_history")
        .select(`
            campaign_id,
            sent_at,
            campaigns ( id, name, subject_line, status )
        `)
        .eq("subscriber_id", subscriberId)
        .order("sent_at", { ascending: false })

    // 2. Get all opens for this subscriber (from subscriber_events)
    const { data: openEvents } = await supabase
        .from("subscriber_events")
        .select("campaign_id")
        .eq("subscriber_id", subscriberId)
        .eq("type", "open")

    const openedCampaigns = new Set((openEvents || []).map(e => e.campaign_id).filter(Boolean))

    // 3. Get all clicks for this subscriber
    const { data: clickEvents } = await supabase
        .from("subscriber_events")
        .select("campaign_id, url")
        .eq("subscriber_id", subscriberId)
        .eq("type", "click")

    const clickedCampaigns = new Set<string>()
    const clickedUrlsByCampaign: Record<string, string[]> = {}
    for (const e of clickEvents || []) {
        if (e.campaign_id) {
            clickedCampaigns.add(e.campaign_id)
            if (e.url) {
                if (!clickedUrlsByCampaign[e.campaign_id]) clickedUrlsByCampaign[e.campaign_id] = []
                if (!clickedUrlsByCampaign[e.campaign_id].includes(e.url)) {
                    clickedUrlsByCampaign[e.campaign_id].push(e.url)
                }
            }
        }
    }

    // 4. Build campaign entries (deduplicate by campaign_id)
    const seen = new Set<string>()
    const campaigns: JourneyCampaignEntry[] = []
    for (const row of sentRows || []) {
        if (!row.campaign_id || seen.has(row.campaign_id)) continue
        seen.add(row.campaign_id)
        const c = row.campaigns as any
        campaigns.push({
            campaign_id: row.campaign_id,
            campaign_name: c?.name || "Unknown Campaign",
            subject_line: c?.subject_line || "",
            sent_at: row.sent_at,
            was_opened: openedCampaigns.has(row.campaign_id),
            was_clicked: clickedCampaigns.has(row.campaign_id),
            clicked_urls: clickedUrlsByCampaign[row.campaign_id] || [],
        })
    }

    // 5. Get chain processes
    const { data: chainProcesses } = await supabase
        .from("chain_processes")
        .select(`
            id,
            status,
            current_step_index,
            created_at,
            email_chains ( id, name, slug, chain_steps ( position, label ) )
        `)
        .eq("subscriber_id", subscriberId)
        .order("created_at", { ascending: false })

    return {
        campaigns,
        chains: (chainProcesses || []).map((cp: any) => ({
            id: cp.id,
            status: cp.status,
            current_step_index: cp.current_step_index,
            created_at: cp.created_at,
            chain_name: cp.email_chains?.name || "Unknown",
            chain_slug: cp.email_chains?.slug || "",
            total_steps: cp.email_chains?.chain_steps?.length || 0,
        })),
        summary: {
            total_sent: campaigns.length,
            total_opened: campaigns.filter(c => c.was_opened).length,
            total_clicked: campaigns.filter(c => c.was_clicked).length,
        },
    }
}
