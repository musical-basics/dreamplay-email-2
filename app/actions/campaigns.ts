"use server"

import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { revalidatePath, unstable_noStore as noStore } from "next/cache"
import { redirect } from "next/navigation"

export async function createCampaign(prevState: any, formData: FormData) {
    const supabase = await createClient()
    const name = formData.get("name") as string
    const emailType = (formData.get("email_type") as string) || "campaign"
    const workspace = (formData.get("workspace") as string) || "dreamplay_marketing"

    if (!name || name.trim() === "") {
        return { error: "Campaign name is required" }
    }

    const { data, error } = await supabase
        .from("campaigns")
        .insert([
            {
                name: name.trim(),
                status: "draft",
                subject_line: "",
                email_type: emailType,
                workspace,
            },
        ])
        .select()
        .single()

    if (error) {
        console.error("Error creating campaign:", error)
        return { error: error.message }
    }

    revalidatePath("/campaigns")
    revalidatePath("/automated-emails")
    return { data }
}

/**
 * Batched .in() helper — splits large ID arrays into chunks to avoid
 * Node.js HeadersOverflowError (16 KB default limit).
 */
async function batchedIn<T>(
    queryFn: (ids: string[]) => Promise<{ data: T[] | null; error: any }>,
    ids: string[],
    batchSize = 80
): Promise<T[]> {
    const results: T[] = []
    for (let i = 0; i < ids.length; i += batchSize) {
        const chunk = ids.slice(i, i + batchSize)
        const { data, error } = await queryFn(chunk)
        if (error) console.error("[batchedIn] chunk error:", error)
        if (data) results.push(...data)
    }
    return results
}

export async function getCampaigns(
    workspace: string,
    emailType?: string,
    opts?: { completedPage?: number; completedPageSize?: number }
) {
    // Opt out of Next.js's fetch/data cache so subscriber_events read fresh
    // every render. force-dynamic on the page route is not enough; without
    // this the supabase calls below (which go through fetch under the hood)
    // can return cached results, causing the Open Rate column to show 0%
    // even when events are present in the DB.
    noStore()

    const supabase = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY!
    )

    const completedPage = opts?.completedPage ?? 0
    const completedPageSize = opts?.completedPageSize ?? 25

    // Fetch campaigns (lightweight metadata only)
    let query = supabase
        .from("campaigns")
        .select("id, name, status, subject_line, created_at, updated_at, total_recipients, total_opens, total_clicks, average_read_time, resend_email_id, is_template, is_ready, variable_values, sent_from_email, email_type, scheduled_at, scheduled_status, category, is_starred_template, template_folder_id")
        .eq("workspace", workspace)
        .order("created_at", { ascending: false })

    if (emailType) {
        query = query.eq("email_type", emailType)
    }

    const { data: campaigns, error } = await query

    if (error) {
        console.error("Error fetching campaigns:", error)
        return { campaigns: [], totalCompleted: 0 }
    }

    if (!campaigns || campaigns.length === 0) return { campaigns: [], totalCompleted: 0 }

    // Separate completed campaigns (sorted by updated_at desc for the completed tab)
    const allCompletedIds = campaigns
        .filter(c => ["sent", "completed", "active"].includes(c.status) && !c.is_template)
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .map(c => c.id)

    const totalCompleted = allCompletedIds.length

    if (allCompletedIds.length === 0) return { campaigns, totalCompleted: 0 }

    // Only enrich the current page of completed campaigns
    const paginatedCompletedIds = allCompletedIds.slice(
        completedPage * completedPageSize,
        (completedPage + 1) * completedPageSize
    )

    // Fetch recipient emails for paginated completed campaigns
    const sentRows = await batchedIn<any>(
        async (ids) => await supabase
            .from("sent_history")
            .select("campaign_id, subscriber_id, variant_sent, subscribers ( email ), campaigns ( name )")
            .in("campaign_id", ids),
        paginatedCompletedIds
    )

    // Build map: campaign_id -> list of recipient emails
    const recipientMap: Record<string, string[]> = {}
    // Also build: campaign_id -> [{ subscriber_id, email, campaign_name }]
    const recipientDetailMap: Record<string, { subscriber_id: string; email: string; campaign_name?: string }[]> = {}
    sentRows.forEach((row: any) => {
        const email = row.subscribers?.email
        if (email && row.campaign_id) {
            if (!recipientMap[row.campaign_id]) recipientMap[row.campaign_id] = []
            if (!recipientDetailMap[row.campaign_id]) recipientDetailMap[row.campaign_id] = []
            if (!recipientMap[row.campaign_id].includes(email)) {
                recipientMap[row.campaign_id].push(email)
                recipientDetailMap[row.campaign_id].push({
                    subscriber_id: row.subscriber_id,
                    email,
                    campaign_name: row.campaigns?.name || row.variant_sent || undefined,
                })
            }
        }
    })

    // Fallback: for paginated campaigns with no sent_history rows, resolve emails from variable_values
    const missingIds = paginatedCompletedIds.filter(id => !recipientMap[id])
    if (missingIds.length > 0) {
        const subIdSet = new Set<string>()
        const campaignToSubIds: Record<string, string[]> = {}
        for (const c of campaigns) {
            if (!missingIds.includes(c.id)) continue
            const vv = c.variable_values || {}
            const ids: string[] = vv.subscriber_ids || (vv.subscriber_id ? [vv.subscriber_id] : [])
            if (ids.length > 0) {
                campaignToSubIds[c.id] = ids
                ids.forEach(id => subIdSet.add(id))
            }
        }
        if (subIdSet.size > 0) {
            const subs = await batchedIn<{ id: string; email: string }>(
                async (ids) => await supabase.from("subscribers").select("id, email").in("id", ids),
                Array.from(subIdSet)
            )
            const subEmailMap = new Map(subs.map(s => [s.id, s.email]))
            for (const [campId, subIds] of Object.entries(campaignToSubIds)) {
                for (const sid of subIds) {
                    const email = subEmailMap.get(sid)
                    if (email) {
                        if (!recipientMap[campId]) recipientMap[campId] = []
                        if (!recipientDetailMap[campId]) recipientDetailMap[campId] = []
                        if (!recipientMap[campId].includes(email)) {
                            recipientMap[campId].push(email)
                            recipientDetailMap[campId].push({ subscriber_id: sid, email })
                        }
                    }
                }
            }
        }
    }

    // Fetch events only for paginated completed campaigns.
    // batchSize=1 here intentionally: PostgREST + Supabase cap SELECT at
    // ~1000 rows server-side regardless of client .limit(). When .in()
    // bundles many campaigns, older high-volume sends saturate the cap and
    // newer campaigns get zero rows back. Querying one campaign at a time
    // keeps each call well under the cap. With ~25 paginated campaigns this
    // is 25 round-trips per query type, which is fine for a paginated view.
    const openEvents = await batchedIn<{ campaign_id: string; subscriber_id: string }>(
        async (ids) => await supabase
            .from("subscriber_events")
            .select("campaign_id, subscriber_id")
            .eq("type", "open")
            .in("campaign_id", ids),
        paginatedCompletedIds,
        1
    )

    const clickEvents = await batchedIn<{ campaign_id: string; subscriber_id: string }>(
        async (ids) => await supabase
            .from("subscriber_events")
            .select("campaign_id, subscriber_id")
            .eq("type", "click")
            .in("campaign_id", ids),
        paginatedCompletedIds,
        1
    )

    const conversionEvents = await batchedIn<{ campaign_id: string; subscriber_id: string; url?: string }>(
        async (ids) => await supabase
            .from("subscriber_events")
            .select("campaign_id, subscriber_id")
            .eq("type", "page_view")
            .ilike("url", "%/customize%")
            .in("campaign_id", ids),
        paginatedCompletedIds,
        1
    )

    // Count unique subscribers per campaign
    const uniqueOpens: Record<string, Set<string>> = {}
    const uniqueClicks: Record<string, Set<string>> = {}
    const uniqueConversions: Record<string, Set<string>> = {}

    openEvents.forEach(e => {
        if (!uniqueOpens[e.campaign_id]) uniqueOpens[e.campaign_id] = new Set()
        uniqueOpens[e.campaign_id].add(e.subscriber_id)
    })

    clickEvents.forEach(e => {
        if (!uniqueClicks[e.campaign_id]) uniqueClicks[e.campaign_id] = new Set()
        uniqueClicks[e.campaign_id].add(e.subscriber_id)
    })

    conversionEvents.forEach(e => {
        if (e.campaign_id) {
            if (!uniqueConversions[e.campaign_id]) uniqueConversions[e.campaign_id] = new Set()
            uniqueConversions[e.campaign_id].add(e.subscriber_id)
        }
    })

    // Enrich only paginated completed campaigns with analytics
    const enrichedSet = new Set(paginatedCompletedIds)
    const enrichedCampaigns = campaigns.map(c => {
        if (!enrichedSet.has(c.id)) return c

        const details = recipientDetailMap[c.id] || []
        const breakdown = details.length > 1
            ? details.map(d => ({
                subscriber_id: d.subscriber_id,
                email: d.email,
                campaign_name: d.campaign_name,
                opened: uniqueOpens[c.id]?.has(d.subscriber_id) ?? false,
                clicked: uniqueClicks[c.id]?.has(d.subscriber_id) ?? false,
                converted: uniqueConversions[c.id]?.has(d.subscriber_id) ?? false,
            }))
            : undefined

        return {
            ...c,
            total_opens: uniqueOpens[c.id]?.size ?? 0,
            total_clicks: uniqueClicks[c.id]?.size ?? 0,
            total_conversions: uniqueConversions[c.id]?.size ?? 0,
            sent_to_emails: recipientMap[c.id] || [],
            recipient_breakdown: breakdown,
        }
    })

    return { campaigns: enrichedCampaigns, totalCompleted }
}


export async function getCampaignList(workspace: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("campaigns")
        .select("id, name, status, subject_line, created_at, is_template, is_ready, category, is_starred_template, template_folder_id")
        .eq("workspace", workspace)
        .order("created_at", { ascending: false })

    if (error) {
        console.error("Error fetching campaign list:", error)
        return []
    }

    return data || []
}

export async function getTemplateList(workspace: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("campaigns")
        .select("id, name, created_at")
        .eq("workspace", workspace)
        .eq("is_template", true)
        .order("created_at", { ascending: false })

    if (error) {
        console.error("Error fetching template list:", error)
        return []
    }

    return data || []
}

export async function getCampaignHtml(campaignId: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from("campaigns")
        .select("html_content, variable_values")
        .eq("id", campaignId)
        .single()

    if (error) {
        console.error("Error fetching campaign HTML:", error)
        return null
    }

    return data
}

export async function duplicateCampaign(campaignId: string) {
    const supabase = await createClient()

    // 1. Fetch original campaign
    const { data: original, error: fetchError } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", campaignId)
        .single()

    if (fetchError || !original) {
        console.error("Error fetching campaign to duplicate:", fetchError)
        return { error: "Failed to fetch original campaign" }
    }

    // 2. Create new campaign with copied data (inherit workspace)
    const { data, error: insertError } = await supabase
        .from("campaigns")
        .insert([
            {
                name: original.name,
                status: "draft",
                email_type: original.email_type || "campaign",
                subject_line: original.subject_line,
                html_content: original.html_content,
                workspace: original.workspace,
                variable_values: (() => {
                    const { subscriber_id, ...rest } = original.variable_values || {};
                    return rest;
                })(),
                parent_template_id: original.is_template ? original.id : (original.parent_template_id || null),
            },
        ])
        .select()
        .single()

    if (insertError) {
        console.error("Error duplicating campaign:", insertError)
        return { error: insertError.message }
    }

    revalidatePath("/campaigns")
    revalidatePath("/automated-emails")
    return { data }
}

export async function createCampaignForTag(workspace: string, tagName: string) {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from("campaigns")
        .insert([
            {
                name: `Campaign for ${tagName}`,
                status: "draft",
                subject_line: `(Draft) Update for ${tagName}`,
                html_content: "",
                variable_values: { target_tag: tagName },
                workspace,
            },
        ])
        .select()
        .single()

    if (error) {
        console.error("Error creating campaign for tag:", error)
        return { error: error.message }
    }

    revalidatePath("/campaigns")
    return { data }
}

export async function createCampaignForSubscriber(workspace: string, subscriberId: string, email: string, name: string) {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from("campaigns")
        .insert([
            {
                name: `Campaign for ${name || email}`,
                status: "draft",
                subject_line: `(Draft) Message for ${name || email}`,
                html_content: "",
                workspace,
                variable_values: {
                    subscriber_id: subscriberId // Store this to lock targeting later if needed
                }
            },
        ])
        .select()
        .single()

    if (error) {
        console.error("Error creating campaign for subscriber:", error)
        return { error: error.message }
    }

    revalidatePath("/campaigns")
    return { data }
}

export async function duplicateCampaignForSubscriber(campaignId: string, subscriberId: string, subscriberEmail: string) {
    const supabase = await createClient()

    // 1. Fetch original campaign
    const { data: original, error: fetchError } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", campaignId)
        .single()

    if (fetchError || !original) {
        console.error("Error fetching campaign to duplicate:", fetchError)
        return { error: "Failed to fetch original campaign" }
    }

    // 2. Build variable_values for the duplicate
    const newVars = {
        ...original.variable_values,
        subscriber_id: subscriberId
    }

    // 3. Multi-discount slots: generate unique codes for each slot
    const discountSlots: any[] = newVars.discount_slots || []
    const legacyConfig = newVars.discount_preset_config
    if (discountSlots.length === 0 && newVars.discount_preset_id && legacyConfig) {
        discountSlots.push({
            config: legacyConfig,
            preview_code: newVars.discount_code || "",
            target_url_key: legacyConfig.targetUrlKey || "",
            code_mode: "per_user",
        })
        newVars.discount_slots = discountSlots
    }

    // Resolve default links for URL variable fallback
    let defaultLinks: Record<string, string> = {};
    try {
        const { getDefaultLinks } = await import("@/app/actions/settings");
        defaultLinks = await getDefaultLinks("dreamplay") as unknown as Record<string, string>;
    } catch { }

    for (const slot of discountSlots) {
        if ((slot.code_mode || "per_user") !== "per_user") continue
        try {
            const { createShopifyDiscount } = await import("@/app/actions/shopify-discount")
            const res = await createShopifyDiscount({
                type: slot.config.type,
                value: slot.config.value,
                durationDays: slot.config.durationDays,
                codePrefix: slot.config.codePrefix,
                usageLimit: 1,
                ...(slot.config.expiresOn ? { expiresOn: slot.config.expiresOn } : {}),
            })
            if (res.success && res.code) {
                // Update the slot's preview code with the new code
                slot.preview_code = res.code
                // Update the target URL with the new code
                const targetUrlKey = slot.target_url_key
                // Fall back to default links if URL not in variable_values
                if (targetUrlKey && !newVars[targetUrlKey] && defaultLinks[targetUrlKey]) {
                    newVars[targetUrlKey] = defaultLinks[targetUrlKey];
                }
                if (targetUrlKey && newVars[targetUrlKey]) {
                    const baseUrl = newVars[targetUrlKey]
                    newVars[targetUrlKey] = baseUrl.includes("discount=")
                        ? baseUrl.replace(/discount=[^&]+/, `discount=${res.code}`)
                        : `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}discount=${res.code}`
                }
                // Write code to the slot's mapped code_variable
                if (slot.code_variable) {
                    newVars[slot.code_variable] = res.code
                }
                // Also set legacy discount_code for backward compat template rendering
                newVars.discount_code = res.code
            }
        } catch (e) {
            console.error("Failed to generate per-user discount code:", e)
        }
    }

    // 4. Create new campaign copy with subscriber lock (inherit workspace)
    const { data, error: insertError } = await supabase
        .from("campaigns")
        .insert([
            {
                // Clean up the name to avoid stacking "Copy of Copy of... (for ...)"
                name: `${original.name.replace(/^(Copy of\s+)+/, "").replace(/\s+\(for\s+.*\)$/, "")} (for ${subscriberEmail})`,
                status: "draft",
                subject_line: original.subject_line,
                html_content: original.html_content,
                variable_values: newVars,
                workspace: original.workspace,
                parent_template_id: original.is_template ? original.id : (original.parent_template_id || null),
            },
        ])
        .select()
        .single()

    if (insertError) {
        console.error("Error duplicating campaign for subscriber:", insertError)
        return { error: insertError.message }
    }

    revalidatePath("/campaigns")
    return { data }
}

export async function deleteCampaign(campaignId: string) {
    const supabase = await createClient()

    // Delete related records first (foreign key constraints)
    await supabase.from("subscriber_events").delete().eq("campaign_id", campaignId)
    await supabase.from("sent_history").delete().eq("campaign_id", campaignId)

    const { error } = await supabase
        .from("campaigns")
        .delete()
        .eq("id", campaignId)

    if (error) {
        console.error("Error deleting campaign:", error)
        return { error: error.message }
    }

    revalidatePath("/campaigns")
    return { success: true }
}

export async function toggleTemplateStatus(campaignId: string, isTemplate: boolean) {
    const supabase = await createClient()
    const { error } = await supabase
        .from("campaigns")
        .update({ is_template: isTemplate })
        .eq("id", campaignId)

    if (error) {
        console.error("Error toggling template status:", error)
        return { success: false, error: error.message }
    }

    revalidatePath("/campaigns")
    return { success: true }
}

export async function toggleReadyStatus(campaignId: string, isReady: boolean) {
    const supabase = await createClient()
    const { error } = await supabase
        .from("campaigns")
        .update({ is_ready: isReady })
        .eq("id", campaignId)

    if (error) {
        console.error("Error toggling ready status:", error)
        return { success: false, error: error.message }
    }

    revalidatePath("/campaigns")
    return { success: true }
}

export async function updateCampaignCategory(campaignId: string, category: string | null) {
    const supabase = await createClient()
    const { error } = await supabase
        .from("campaigns")
        .update({ category: category || null })
        .eq("id", campaignId)

    if (error) {
        console.error("Error updating campaign category:", error)
        return { success: false, error: error.message }
    }

    revalidatePath("/campaigns")
    return { success: true }
}

export async function toggleCampaignStarred(campaignId: string, isStarred: boolean) {
    const supabase = await createClient()
    const { error } = await supabase
        .from("campaigns")
        .update({ is_starred_template: isStarred })
        .eq("id", campaignId)

    if (error) {
        console.error("Error toggling campaign starred:", error)
        return { success: false, error: error.message }
    }

    revalidatePath("/campaigns")
    return { success: true }
}

export async function getRecentlyUsedTemplateIds(workspace: string): Promise<string[]> {
    const supabase = await createClient()

    // Find the 5 most recently used templates by looking at child campaigns
    const { data, error } = await supabase
        .from("campaigns")
        .select("parent_template_id, created_at")
        .eq("workspace", workspace)
        .not("parent_template_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(50)

    if (error || !data) {
        console.error("Error fetching recently used templates:", error)
        return []
    }

    // Deduplicate by parent_template_id, keeping only the most recent per template
    const seen = new Set<string>()
    const recentIds: string[] = []
    for (const row of data) {
        if (row.parent_template_id && !seen.has(row.parent_template_id)) {
            seen.add(row.parent_template_id)
            recentIds.push(row.parent_template_id)
            if (recentIds.length >= 5) break
        }
    }

    return recentIds
}

// ─── Version History ────────────────────────────────────────────────

export async function saveCampaignBackup(
    campaignId: string,
    htmlContent: string,
    variableValues: Record<string, any>,
    subjectLine: string
) {
    const supabase = await createClient()

    // Insert new backup
    const { error: insertError } = await supabase
        .from("campaign_backups")
        .insert({
            campaign_id: campaignId,
            html_content: htmlContent,
            variable_values: variableValues,
            subject_line: subjectLine,
        })

    if (insertError) {
        console.error("Error saving backup:", insertError)
        return { error: insertError.message }
    }

    // Keep only the newest 10 backups — delete the rest
    const { data: backups } = await supabase
        .from("campaign_backups")
        .select("id")
        .eq("campaign_id", campaignId)
        .order("saved_at", { ascending: false })

    if (backups && backups.length > 10) {
        const idsToDelete = backups.slice(10).map((b) => b.id)
        await supabase
            .from("campaign_backups")
            .delete()
            .in("id", idsToDelete)
    }

    return { success: true }
}

export async function getCampaignBackups(campaignId: string) {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from("campaign_backups")
        .select("id, saved_at, subject_line")
        .eq("campaign_id", campaignId)
        .order("saved_at", { ascending: false })
        .limit(10)

    if (error) {
        console.error("Error fetching backups:", error)
        return []
    }

    return data || []
}

export async function restoreCampaignBackup(campaignId: string, backupId: string) {
    const supabase = await createClient()

    // Fetch backup
    const { data: backup, error: fetchError } = await supabase
        .from("campaign_backups")
        .select("html_content, variable_values, subject_line")
        .eq("id", backupId)
        .single()

    if (fetchError || !backup) {
        console.error("Error fetching backup:", fetchError)
        return { error: "Backup not found" }
    }

    // Restore into campaign
    const { error: updateError } = await supabase
        .from("campaigns")
        .update({
            html_content: backup.html_content,
            variable_values: backup.variable_values,
            subject_line: backup.subject_line,
        })
        .eq("id", campaignId)

    if (updateError) {
        console.error("Error restoring backup:", updateError)
        return { error: updateError.message }
    }

    return {
        success: true,
        data: {
            html_content: backup.html_content,
            variable_values: backup.variable_values,
            subject_line: backup.subject_line,
        }
    }
}

/**
 * Create a campaign copy for bulk sending to specific subscribers.
 * Stores the subscriber IDs in variable_values so the broadcast page
 * sends only to those people.
 */
export async function createBulkCampaign(
    campaignId: string,
    subscriberIds: string[]
): Promise<{ data?: { id: string }; error?: string }> {
    if (!subscriberIds.length) {
        return { error: "No subscribers selected" }
    }

    const supabase = await createClient()

    // 1. Fetch original template
    const { data: original, error: fetchError } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", campaignId)
        .single()

    if (fetchError || !original) {
        console.error("Error fetching campaign for bulk send:", fetchError)
        return { error: "Failed to fetch campaign" }
    }

    // 2. Build variable_values with subscriber_ids array
    const newVars = {
        ...original.variable_values,
        subscriber_ids: subscriberIds,
    }
    // Remove any single subscriber_id lock
    delete newVars.subscriber_id

    // 3. Create child campaign (inherit workspace)
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    const { data, error: insertError } = await supabase
        .from("campaigns")
        .insert([{
            name: `${original.name} — Bulk Send ${today} (${subscriberIds.length} recipients)`,
            status: "draft",
            subject_line: original.subject_line,
            html_content: original.html_content,
            variable_values: newVars,
            workspace: original.workspace,
            parent_template_id: original.is_template ? original.id : (original.parent_template_id || null),
        }])
        .select("id")
        .single()

    if (insertError) {
        console.error("Error creating bulk send campaign:", insertError)
        return { error: insertError.message }
    }

    revalidatePath("/campaigns")
    return { data }
}
