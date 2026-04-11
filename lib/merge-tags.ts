/**
 * Unified Merge Tags — centralized variable replacement for all email sends.
 *
 * Three categories of merge tags:
 *
 * 1. SUBSCRIBER — pulled from the subscriber row (e.g. first_name, email)
 *    Falls back to the configured default_value if the field is empty.
 *
 * 2. GLOBAL — shared values across all emails (e.g. privacy_url, homepage_url)
 *    Always uses the default_value from the merge_tags table.
 *
 * 3. DYNAMIC — generated at send time and injected via the `dynamicVars` argument
 *    (e.g. discount_code, unsubscribe_url). These are documented in the table
 *    but their values come from runtime, not the database.
 *
 * Used by all send paths:
 *   - app/api/test-send/route.ts (test/preview send)
 *   - inngest/functions/api-send.ts (Hermes-triggered background send)
 *   - app/api/webhooks/subscribe/route.ts (trigger execution)
 *   - lib/chains/sender.ts (chain sender)
 */

import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

export interface MergeTag {
    id: string
    tag: string            // e.g. "first_name", "privacy_url", "discount_code"
    field_label: string    // e.g. "First Name", "Privacy Policy", "Discount Code"
    subscriber_field: string // subscriber column name (only for category=subscriber)
    default_value: string  // fallback or static value
    category: "subscriber" | "global" | "dynamic"
    created_at: string
}

// ── Cache merge tag defaults so we don't hit the DB on every email ────
let _cache: { data: MergeTag[]; ts: number } | null = null
const CACHE_TTL = 60_000 // 1 minute

/**
 * Fetch all merge tags from the database (cached for 1 minute).
 */
export async function getAllMergeTags(): Promise<MergeTag[]> {
    const now = Date.now()
    if (_cache && now - _cache.ts < CACHE_TTL) return _cache.data

    try {
        const { data, error } = await supabase
            .from("merge_tags")
            .select("*")
            .order("created_at", { ascending: true })

        if (error || !data || data.length === 0) {
            return BUILT_IN_FALLBACK
        }

        _cache = { data, ts: now }
        return data
    } catch {
        return BUILT_IN_FALLBACK
    }
}

/**
 * Apply ALL merge tags to HTML content.
 *
 * @param html       — raw HTML with {{variable}} placeholders
 * @param subscriber — subscriber row data (for category=subscriber tags)
 * @param dynamicVars — runtime values like { discount_code, unsubscribe_url }
 */
export async function applyAllMergeTags(
    html: string,
    subscriber: Record<string, any> = {},
    dynamicVars: Record<string, string> = {}
): Promise<string> {
    const { html: rendered } = await applyAllMergeTagsWithLog(html, subscriber, dynamicVars)
    return rendered
}

export interface MergeTagLogEntry {
    tag: string          // e.g. "first_name"
    category: string     // "subscriber" | "global" | "dynamic" | "alias"
    resolved: boolean
    value: string        // the value it resolved to (or "" if unresolved)
    source: string       // e.g. "subscriber.first_name", "default", "dynamicVars"
}

export interface MergeTagLog {
    tags_found: string[]
    tags_resolved: Record<string, string>
    tags_unresolved: string[]
    entries: MergeTagLogEntry[]
}

/**
 * Apply ALL merge tags to HTML content AND return an audit log.
 */
export async function applyAllMergeTagsWithLog(
    html: string,
    subscriber: Record<string, any> = {},
    dynamicVars: Record<string, string> = {}
): Promise<{ html: string; log: MergeTagLog }> {
    const tags = await getAllMergeTags()
    let result = html

    // 1. Detect all {{tag}} patterns in the raw HTML before replacement
    const foundSet = new Set<string>()
    const foundRegex = /\{\{(\w+)\}\}/g
    let m: RegExpExecArray | null
    while ((m = foundRegex.exec(html)) !== null) {
        foundSet.add(m[1])
    }

    const entries: MergeTagLogEntry[] = []
    const resolvedMap: Record<string, string> = {}
    const processedTags = new Set<string>()

    // 2. Process registered merge tags
    for (const tag of tags) {
        const regex = new RegExp(`\\{\\{${tag.tag}\\}\\}`, "g")
        const wasInHtml = foundSet.has(tag.tag)

        let value: string
        let source: string

        switch (tag.category) {
            case "subscriber":
                if (subscriber[tag.subscriber_field]) {
                    value = subscriber[tag.subscriber_field]
                    source = `subscriber.${tag.subscriber_field}`
                } else {
                    value = tag.default_value
                    source = value ? "default" : "empty"
                }
                break

            case "global":
                value = tag.default_value
                source = "global_default"
                break

            case "dynamic":
                if (dynamicVars[tag.tag]) {
                    value = dynamicVars[tag.tag]
                    source = "dynamicVars"
                } else {
                    value = tag.default_value
                    source = value ? "default" : "empty"
                }
                break

            default:
                value = tag.default_value
                source = "default"
        }

        result = result.replace(regex, value)
        processedTags.add(tag.tag)

        if (wasInHtml) {
            const resolved = value !== "" && value !== undefined
            entries.push({
                tag: tag.tag,
                category: tag.category,
                resolved,
                value: resolved ? value : "",
                source: resolved ? source : "missing",
            })
            if (resolved) {
                resolvedMap[tag.tag] = value
            }
        }
    }

    // 3. Handle unsubscribe URL aliases
    const aliases = ["unsubscribe_link_url", "unsubscribe_link"]
    if (dynamicVars.unsubscribe_url) {
        for (const alias of aliases) {
            const aliasRegex = new RegExp(`\\{\\{${alias}\\}\\}`, "g")
            if (foundSet.has(alias)) {
                result = result.replace(aliasRegex, dynamicVars.unsubscribe_url)
                processedTags.add(alias)
                entries.push({
                    tag: alias,
                    category: "alias",
                    resolved: true,
                    value: dynamicVars.unsubscribe_url,
                    source: "dynamicVars.unsubscribe_url",
                })
                resolvedMap[alias] = dynamicVars.unsubscribe_url
            }
        }
    }

    // 3.5. Catch-all: apply any dynamicVars that weren't handled by registered tags
    //      (e.g. discount_code1, discount_code2, discount_code3 which may not be in the DB)
    for (const [dvKey, dvValue] of Object.entries(dynamicVars)) {
        if (processedTags.has(dvKey) || !dvValue) continue
        if (foundSet.has(dvKey)) {
            const dvRegex = new RegExp(`\\{\\{${dvKey}\\}\\}`, "g")
            result = result.replace(dvRegex, dvValue)
            processedTags.add(dvKey)
            entries.push({
                tag: dvKey,
                category: "dynamic",
                resolved: true,
                value: dvValue,
                source: "dynamicVars",
            })
            resolvedMap[dvKey] = dvValue
        }
    }

    // 4. Detect any leftover unresolved tags
    const unresolvedTags: string[] = []
    for (const tag of foundSet) {
        if (!processedTags.has(tag)) {
            unresolvedTags.push(tag)
            entries.push({
                tag,
                category: "unknown",
                resolved: false,
                value: "",
                source: "not_registered",
            })
        }
    }

    return {
        html: result,
        log: {
            tags_found: Array.from(foundSet),
            tags_resolved: resolvedMap,
            tags_unresolved: unresolvedTags,
            entries,
        },
    }
}

// ── Backwards-compatible wrapper (used by send/route.ts and subscribe/route.ts) ──
export function applyMergeTags(
    html: string,
    subscriber: Record<string, any>,
    _mergeDefaults: Record<string, string>
): string {
    // This is a sync wrapper — the callers that use this need updating to async.
    // For now, kept for compilation but callers should migrate to applyAllMergeTags.
    let result = html
    for (const [tag, defaultValue] of Object.entries(_mergeDefaults)) {
        const subscriberField = BUILT_IN_FALLBACK.find(t => t.tag === tag)?.subscriber_field || tag
        const value = subscriber[subscriberField] || defaultValue
        result = result.replace(new RegExp(`\\{\\{${tag}\\}\\}`, "g"), value)
    }
    if (subscriber._unsubscribe_url) {
        result = result
            .replace(/\{\{unsubscribe_url\}\}/g, subscriber._unsubscribe_url)
            .replace(/\{\{unsubscribe_link_url\}\}/g, subscriber._unsubscribe_url)
            .replace(/\{\{unsubscribe_link\}\}/g, subscriber._unsubscribe_url)
    }
    return result
}

/** Legacy sync helper - still used by getMergeTagDefaults callers */
export async function getMergeTagDefaults(): Promise<Record<string, string>> {
    const tags = await getAllMergeTags()
    const defaults: Record<string, string> = {}
    for (const t of tags) {
        if (t.category === "subscriber") {
            defaults[t.tag] = t.default_value
        }
    }
    return defaults
}

// ── Fallback if DB is empty ──────────────────────────────────────────
const BUILT_IN_FALLBACK: MergeTag[] = [
    { id: "", tag: "first_name", field_label: "First Name", subscriber_field: "first_name", default_value: "Musical Family", category: "subscriber", created_at: "" },
    { id: "", tag: "last_name", field_label: "Last Name", subscriber_field: "last_name", default_value: "", category: "subscriber", created_at: "" },
    { id: "", tag: "email", field_label: "Email Address", subscriber_field: "email", default_value: "", category: "subscriber", created_at: "" },
    { id: "", tag: "subscriber_id", field_label: "Subscriber ID", subscriber_field: "id", default_value: "", category: "subscriber", created_at: "" },
    { id: "", tag: "location_city", field_label: "City", subscriber_field: "location_city", default_value: "", category: "subscriber", created_at: "" },
    { id: "", tag: "location_country", field_label: "Country", subscriber_field: "location_country", default_value: "", category: "subscriber", created_at: "" },
    { id: "", tag: "discount_code", field_label: "Discount Code", subscriber_field: "", default_value: "", category: "dynamic", created_at: "" },
    { id: "", tag: "unsubscribe_url", field_label: "Unsubscribe URL", subscriber_field: "", default_value: "", category: "dynamic", created_at: "" },
]
