export type CampaignStatus = 'draft' | 'active' | 'completed'

export interface Campaign {
    id: string
    created_at: string
    updated_at: string
    name: string
    subject_line: string | null
    html_content?: string | null
    variable_values: Record<string, any> | null
    status: CampaignStatus

    // Analytics
    total_recipients: number
    total_opens: number
    total_clicks: number
    total_conversions?: number
    average_read_time: number
    resend_email_id?: string | null
    is_template?: boolean
    is_ready?: boolean
    category?: string | null
    is_starred_template?: boolean
    template_folder_id?: string | null
    email_type?: string
    workspace?: string
    sent_from_email?: string | null
    sent_to_emails?: string[]
    parent_template_id?: string | null
    scheduled_at?: string | null
    scheduled_status?: string | null
    recipient_breakdown?: {
        subscriber_id: string
        email: string
        campaign_name?: string
        opened: boolean
        clicked: boolean
        converted: boolean
    }[]
}

export interface Subscriber {
    id: string
    email: string
    first_name: string
    last_name: string
    country: string
    country_code: string
    phone_code: string
    phone_number: string
    shipping_address1: string
    shipping_address2: string
    shipping_city: string
    shipping_zip: string
    shipping_province: string
    tags: string[] | null
    status: 'active' | 'inactive' | 'unsubscribed' | 'bounced'
    created_at: string
    workspace?: string
}

export type ChainProcessStatus = 'active' | 'paused' | 'cancelled' | 'completed'

export interface ChainProcessHistoryEntry {
    step_name: string
    action: string
    timestamp: string
    details?: string
}

export interface ChainProcess {
    id: string
    chain_id: string
    subscriber_id: string
    status: ChainProcessStatus
    current_step_index: number
    next_step_at: string | null
    history: ChainProcessHistoryEntry[]
    created_at: string
    updated_at: string
    // Joined fields for UI
    chain_name?: string
    chain_steps?: any[]
    chain_branches?: any[]
    subscriber_email?: string
    subscriber_first_name?: string
}
