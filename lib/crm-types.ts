export interface CRMLead {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    tags: string[]
    status: string
    engagement_score: number
    last_seen_at: string | null
    recent_pages: string[] | null
}

export interface CRMScoringConfig {
    // Base points per event type
    points_conversion: number
    points_checkout_page: number
    points_click: number
    points_page_view: number
    points_open: number
    points_session_max: number // max points from session duration

    // Time decay multipliers
    decay_recent_days: number       // "recent" window in days
    decay_recent_multiplier: number // multiplier for events within recent window
    decay_mid_days: number          // "mid" window in days
    decay_mid_multiplier: number    // multiplier for events within mid window
    decay_old_multiplier: number    // multiplier for older events

    // Tag boosts
    tag_boosts: { tag: string; boost: number }[]

    // Filtering
    min_score: number
    max_score: number | null        // null = no upper limit
    exclude_tags: string[]
    include_hot_tags: string[]      // always include if they have these tags, regardless of score

    // Display
    event_lookback_days: number     // how far back to look for events
}

export const DEFAULT_CRM_CONFIG: CRMScoringConfig = {
    points_conversion: 50,
    points_checkout_page: 20,
    points_click: 10,
    points_page_view: 2,
    points_open: 1,
    points_session_max: 20,

    decay_recent_days: 3,
    decay_recent_multiplier: 2.0,
    decay_mid_days: 14,
    decay_mid_multiplier: 1.0,
    decay_old_multiplier: 0.2,

    tag_boosts: [
        { tag: "VIP Account", boost: 30 },
        { tag: "$300 Off Lead", boost: 40 },
    ],

    min_score: 5,
    max_score: null,
    exclude_tags: ["Purchased", "Test Account"],
    include_hot_tags: ["VIP Account", "$300 Off Lead", "Free Shipping Lead", "Hesitated at Checkout"],

    event_lookback_days: 30,
}
