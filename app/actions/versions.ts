"use server"

import { createClient } from "@/lib/supabase/server"

export async function saveVersion(campaignId: string, html: string, prompt: string) {
    const supabase = await createClient()
    await supabase.from('campaign_versions').insert({
        campaign_id: campaignId,
        html_content: html,
        prompt: prompt
    })
}

export async function getVersions(campaignId: string) {
    const supabase = await createClient()
    const { data } = await supabase
        .from('campaign_versions')
        .select('*')
        .order('created_at', { ascending: false })
    return data
}
