import { inngest } from "@/inngest/client";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

// EU + UK country codes (ISO 3166-1 alpha-2)
const EU_COUNTRIES = new Set([
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
    "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
    "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB",
    // common full names from GeoIP
    "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic",
    "Denmark", "Estonia", "Finland", "France", "Germany", "Greece",
    "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg",
    "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia",
    "Slovenia", "Spain", "Sweden", "United Kingdom",
]);

interface SmartTags {
    engagement: "high" | "medium" | "low";
    intents: string[];
    region?: string;
}

/**
 * Nightly Audience Enrichment Engine
 * 
 * Runs at 2 AM every day. For each active subscriber:
 * 1. Counts opens/clicks in the last 30 days → engagement level
 * 2. Checks session_end events for /customize and /shipping → intent signals
 * 3. Checks location_country for EU/UK → region tag
 * 
 * Writes to `smart_tags` jsonb column (NOT the manual `tags` array).
 */
export const audienceEnrichment = inngest.createFunction(
    {
        id: "audience-enrichment",
        name: "Nightly Audience Enrichment",
    },
    { cron: "0 2 * * *" }, // 2 AM daily
    async ({ step }) => {
        // 1. Fetch all active subscribers
        const subscribers = await step.run("fetch-subscribers", async () => {
            const { data, error } = await supabase
                .from("subscribers")
                .select("id, location_country")
                .eq("status", "active");

            if (error) throw error;
            return data || [];
        });

        if (subscribers.length === 0) {
            return { message: "No active subscribers to enrich" };
        }

        // 2. Fetch all events from the last 30 days (one bulk query)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const allEvents = await step.run("fetch-events", async () => {
            const { data, error } = await supabase
                .from("subscriber_events")
                .select("subscriber_id, type, url, metadata")
                .gte("created_at", thirtyDaysAgo.toISOString())
                .in("type", ["open", "click", "session_end"]);

            if (error) throw error;
            return data || [];
        });

        // 3. Group events by subscriber
        const eventsBySubscriber: Record<string, typeof allEvents> = {};
        for (const event of allEvents) {
            if (!eventsBySubscriber[event.subscriber_id]) {
                eventsBySubscriber[event.subscriber_id] = [];
            }
            eventsBySubscriber[event.subscriber_id].push(event);
        }

        // 4. Calculate smart tags and batch update
        const result = await step.run("calculate-and-update", async () => {
            let enrichedCount = 0;

            // Process in chunks of 100 to avoid overwhelming the DB
            const CHUNK_SIZE = 100;
            for (let i = 0; i < subscribers.length; i += CHUNK_SIZE) {
                const chunk = subscribers.slice(i, i + CHUNK_SIZE);
                const updates: Array<{ id: string; smart_tags: SmartTags }> = [];

                for (const sub of chunk) {
                    const events = eventsBySubscriber[sub.id] || [];

                    // --- Engagement Level ---
                    const openClickCount = events.filter(
                        e => e.type === "open" || e.type === "click"
                    ).length;

                    let engagement: SmartTags["engagement"] = "low";
                    if (openClickCount >= 3) engagement = "high";
                    else if (openClickCount >= 1) engagement = "medium";

                    // --- Intent Signals ---
                    const intents: string[] = [];
                    const sessionEndEvents = events.filter(e => e.type === "session_end");

                    for (const se of sessionEndEvents) {
                        const url = se.url || "";
                        const duration = se.metadata?.duration_seconds || 0;

                        if (url.includes("/customize") && duration > 10) {
                            if (!intents.includes("customize")) intents.push("customize");
                        }
                        if (url.includes("/shipping") && duration > 5) {
                            if (!intents.includes("shipping")) intents.push("shipping");
                        }
                    }

                    // --- Region ---
                    const smartTags: SmartTags = { engagement, intents };
                    if (sub.location_country && EU_COUNTRIES.has(sub.location_country)) {
                        smartTags.region = "europe";
                    }

                    updates.push({ id: sub.id, smart_tags: smartTags });
                }

                // Batch update using individual updates (Supabase doesn't support bulk upsert on non-PK)
                for (const update of updates) {
                    await supabase
                        .from("subscribers")
                        .update({ smart_tags: update.smart_tags })
                        .eq("id", update.id);
                }

                enrichedCount += updates.length;
            }

            return { enrichedCount };
        });

        return {
            event: "audience.enrichment.completed",
            body: {
                subscribersProcessed: result.enrichedCount,
                totalSubscribers: subscribers.length,
            },
        };
    }
);
