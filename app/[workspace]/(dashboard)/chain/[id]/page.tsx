import { getChainWithCampaignDetails } from "@/app/actions/chains"
import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import { ChainLaunchChecks } from "@/components/chain/chain-launch-checks"

interface ChainPageProps {
    params: Promise<{ id: string }>
    searchParams: Promise<{ subscriberId?: string; subscriberIds?: string }>
}

// Helper: find already-sent template_keys for a subscriber
async function getAlreadySentForSubscriber(
    supabase: any,
    subscriberId: string,
    templateKeys: string[]
): Promise<string[]> {
    if (templateKeys.length === 0) return []

    const [directSentResult, copiesResult] = await Promise.all([
        supabase
            .from("sent_history")
            .select("campaign_id")
            .eq("subscriber_id", subscriberId)
            .in("campaign_id", templateKeys),
        supabase
            .from("campaigns")
            .select("id, parent_template_id")
            .in("parent_template_id", templateKeys),
    ])

    const sentTemplateKeys = new Set<string>()

    if (directSentResult.data) {
        directSentResult.data.forEach((r: any) => sentTemplateKeys.add(r.campaign_id))
    }

    if (copiesResult.data && copiesResult.data.length > 0) {
        const copyIds = copiesResult.data.map((c: any) => c.id)
        const { data: copySentRows } = await supabase
            .from("sent_history")
            .select("campaign_id")
            .eq("subscriber_id", subscriberId)
            .in("campaign_id", copyIds)

        if (copySentRows) {
            const copyToParent = new Map(copiesResult.data.map((c: any) => [c.id, c.parent_template_id]))
            copySentRows.forEach((r: any) => {
                const parentId = copyToParent.get(r.campaign_id)
                if (parentId) sentTemplateKeys.add(parentId as string)
            })
        }
    }

    return [...sentTemplateKeys]
}

export default async function ChainPage({ params, searchParams }: ChainPageProps) {
    const { id } = await params
    const { subscriberId, subscriberIds } = await searchParams

    // Fetch chain with enriched campaign details
    const { data: chain, error } = await getChainWithCampaignDetails(id)

    if (error || !chain) {
        notFound()
    }

    const templateKeys = chain.steps.map(s => s.template_key).filter(Boolean)

    // Determine subscriber IDs — single or bulk
    const allSubscriberIds: string[] = subscriberIds
        ? subscriberIds.split(",").filter(Boolean)
        : subscriberId
            ? [subscriberId]
            : []

    const isBulkMode = allSubscriberIds.length > 1

    // Fetch all subscribers
    let subscribers: Array<{
        id: string
        email: string
        first_name: string | null
        last_name: string | null
        tags: string[] | null
        status: string
    }> = []

    // Map: subscriberId → already-sent template_keys
    let sentMap: Record<string, string[]> = {}

    if (allSubscriberIds.length > 0) {
        const supabase = await createClient()

        // Fetch all subscribers in one query
        const { data: subRows } = await supabase
            .from("subscribers")
            .select("id, email, first_name, last_name, tags, status")
            .in("id", allSubscriberIds)

        subscribers = subRows || []

        // Fetch already-sent data per subscriber
        // For bulk mode, we fetch copies once and reuse
        const { data: copies } = await supabase
            .from("campaigns")
            .select("id, parent_template_id")
            .in("parent_template_id", templateKeys)

        const copyIds = (copies || []).map(c => c.id)
        const copyToParent = new Map((copies || []).map(c => [c.id, c.parent_template_id]))

        for (const subId of allSubscriberIds) {
            const sentTemplateKeys = new Set<string>()

            // Direct matches
            const { data: directRows } = await supabase
                .from("sent_history")
                .select("campaign_id")
                .eq("subscriber_id", subId)
                .in("campaign_id", templateKeys)

            if (directRows) {
                directRows.forEach(r => sentTemplateKeys.add(r.campaign_id))
            }

            // Copy matches
            if (copyIds.length > 0) {
                const { data: copySentRows } = await supabase
                    .from("sent_history")
                    .select("campaign_id")
                    .eq("subscriber_id", subId)
                    .in("campaign_id", copyIds)

                if (copySentRows) {
                    copySentRows.forEach(r => {
                        const parentId = copyToParent.get(r.campaign_id)
                        if (parentId) sentTemplateKeys.add(parentId)
                    })
                }
            }

            sentMap[subId] = [...sentTemplateKeys]
        }
    }

    return (
        <ChainLaunchChecks
            chain={chain}
            subscriber={!isBulkMode && subscribers.length === 1 ? subscribers[0] : null}
            alreadySentCampaignIds={!isBulkMode && subscribers.length === 1 ? sentMap[subscribers[0]?.id] || [] : []}
            subscribers={isBulkMode ? subscribers : undefined}
            sentMap={isBulkMode ? sentMap : undefined}
        />
    )
}
