"use server"

import { createClient } from "@/lib/supabase/server"

export async function exportToBlog(campaignId: string): Promise<{ postId?: string; error?: string }> {
    const supabase = await createClient()

    // 1. Fetch campaign data
    const { data: campaign, error: fetchError } = await supabase
        .from("campaigns")
        .select("name, html_content, variable_values")
        .eq("id", campaignId)
        .single()

    if (fetchError || !campaign) {
        console.error("Error fetching campaign for blog export:", fetchError)
        return { error: "Failed to fetch campaign" }
    }

    if (!campaign.html_content) {
        return { error: "Campaign has no HTML content to export" }
    }

    // 2. Generate slug from campaign name
    const slug = (campaign.name || "untitled")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")

    // 3. Insert into the blog's posts table as a draft
    const { data: post, error: insertError } = await supabase
        .from("posts")
        .insert({
            title: campaign.name || "Untitled Export",
            slug,
            html_content: campaign.html_content,
            variable_values: campaign.variable_values || {},
            status: "draft",
        })
        .select("id")
        .single()

    if (insertError) {
        console.error("Error creating blog post:", insertError)
        return { error: insertError.message }
    }

    return { postId: post.id }
}
