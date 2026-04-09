"use server"

import { createClient } from "@/lib/supabase/server"
import { renderTemplate } from "@/lib/render-template"
import { applyAllMergeTagsWithLog, MergeTagLog } from "@/lib/merge-tags"

export interface MergeTagLogData {
    subscriber_id: string
    subscriber_email: string
    sent_at: string
    merge_tag_log: MergeTagLog | null
}

/**
 * Fetch post-send merge tag logs from sent_history.
 */
export async function getMergeTagLogs(campaignId: string): Promise<MergeTagLogData[]> {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from("sent_history")
        .select("subscriber_id, sent_at, merge_tag_log, subscribers ( email )")
        .eq("campaign_id", campaignId)
        .not("merge_tag_log", "is", null)
        .order("sent_at", { ascending: false })
        .limit(50)

    if (error || !data) {
        console.error("Error fetching merge tag logs:", error)
        return []
    }

    return data.map((row: any) => ({
        subscriber_id: row.subscriber_id,
        subscriber_email: (row.subscribers as any)?.email || "Unknown",
        sent_at: row.sent_at,
        merge_tag_log: row.merge_tag_log,
    }))
}

/**
 * Dry-run merge tag resolution WITHOUT sending.
 * Simulates the full pipeline: renderTemplate → applyAllMergeTagsWithLog
 * Uses the locked subscriber (or first active) to produce realistic values.
 */
export async function dryRunMergeTags(campaignId: string): Promise<{
    log: MergeTagLog
    subscriber_email: string
} | null> {
    const supabase = await createClient()

    // 1. Fetch the campaign
    const { data: campaign, error: campErr } = await supabase
        .from("campaigns")
        .select("html_content, variable_values, subject_line")
        .eq("id", campaignId)
        .single()

    if (campErr || !campaign || !campaign.html_content) {
        console.error("dryRunMergeTags: campaign fetch failed", campErr)
        return null
    }

    // 2. Find a subscriber to simulate against
    const lockedSubscriberIds: string[] | undefined = campaign.variable_values?.subscriber_ids
    const lockedSubscriberId = campaign.variable_values?.subscriber_id
    let subscriber: any = null

    if (lockedSubscriberIds?.length) {
        const { data } = await supabase
            .from("subscribers")
            .select("*")
            .eq("id", lockedSubscriberIds[0])
            .single()
        subscriber = data
    } else if (lockedSubscriberId) {
        const { data } = await supabase
            .from("subscribers")
            .select("*")
            .eq("id", lockedSubscriberId)
            .single()
        subscriber = data
    } else {
        const { data } = await supabase
            .from("subscribers")
            .select("*")
            .eq("status", "active")
            .limit(1)
            .single()
        subscriber = data
    }

    if (!subscriber) {
        console.error("dryRunMergeTags: no subscriber found for simulation")
        return null
    }

    // 3. Pre-scan raw HTML for ALL {{tag}} patterns BEFORE renderTemplate eats them
    const rawTagRegex = /\{\{(\w+)\}\}/g
    const allRawTags = new Set<string>()
    let rawMatch: RegExpExecArray | null
    while ((rawMatch = rawTagRegex.exec(campaign.html_content)) !== null) {
        allRawTags.add(rawMatch[1])
    }

    // 4. Render template variables (same as send route)
    const subscriberVarNames = ["first_name", "last_name", "email", "unsubscribe_url", "unsubscribe_link_url", "unsubscribe_link"]
    const globalAssets = Object.fromEntries(
        Object.entries(campaign.variable_values || {}).filter(([key]) => !subscriberVarNames.includes(key))
    ) as Record<string, string>
    const renderedHtml = renderTemplate(campaign.html_content, globalAssets)

    // 5. Figure out which tags were consumed by renderTemplate (template-level)
    const postRenderTags = new Set<string>()
    const postRenderRegex = /\{\{(\w+)\}\}/g
    let prMatch: RegExpExecArray | null
    while ((prMatch = postRenderRegex.exec(renderedHtml)) !== null) {
        postRenderTags.add(prMatch[1])
    }
    // Tags that renderTemplate replaced = rawTags minus postRenderTags
    const templateResolvedTags = new Set<string>()
    for (const tag of allRawTags) {
        if (!postRenderTags.has(tag)) {
            templateResolvedTags.add(tag)
        }
    }

    // 6. Append unsubscribe footer (exactly what send route does for every recipient)
    const unsubscribeFooter = `
<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; font-family: sans-serif;">
  <p style="margin: 0;">
    No longer want to receive these emails? 
    <a href="{{unsubscribe_url}}" style="color: #6b7280; text-decoration: underline;">Unsubscribe here</a>.
  </p>
</div>
`;
    const htmlWithFooter = renderedHtml + unsubscribeFooter

    // 7. Build dynamic vars (simulated)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://email.dreamplaypianos.com"
    const unsubscribeUrl = `${baseUrl}/unsubscribe?s=${subscriber.id}&c=${campaignId}`

    const dynamicVars: Record<string, string> = {
        unsubscribe_url: unsubscribeUrl,
    }

    // Simulate discount code if configured
    const discountCode = campaign.variable_values?.discount_code
    if (discountCode) {
        dynamicVars.discount_code = discountCode
    }

    // 8. Run the merge tag resolution on the remaining tags
    const { log } = await applyAllMergeTagsWithLog(htmlWithFooter, subscriber, dynamicVars)

    // 9. Merge template-level tags into the log (these were resolved BEFORE merge tag engine)
    for (const tag of templateResolvedTags) {
        const value = String(globalAssets[tag] || campaign.variable_values?.[tag] || "")
        log.tags_found.unshift(tag)
        if (value) {
            log.tags_resolved[tag] = value
        } else {
            log.tags_unresolved.push(tag)
        }
        log.entries.unshift({
            tag,
            category: "template",
            resolved: !!value,
            value,
            source: value ? "variable_values" : "empty",
        })
    }

    return {
        log,
        subscriber_email: subscriber.email,
    }
}
