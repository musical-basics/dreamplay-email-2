import { inngest } from "@/inngest/client";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://dreamplay-email-2.vercel.app";

/**
 * Inngest function: api-send (event: campaign.send)
 *
 * Triggered by the Hermes API to initiate an immediate campaign broadcast.
 * NOTE: This is NOT related to the SendCampaignModal UI component (which lets
 * users manually send a campaign to a subscriber from the Audience/CRM pages).
 * This function is the background Inngest runner for Hermes-initiated sends.
 *
 * Acts as a thin Inngest wrapper around /api/send-stream — all actual send
 * logic (image proxy, video overlay, CSS inlining, merge tags, tracking,
 * per-user discounts, Resend delivery, history inserts) lives in send-stream.
 *
 * Using step.run() gives Inngest-native retry/checkpoint semantics on the
 * send step without duplicating any pipeline logic here.
 *
 * Event data:
 *   campaignId          — required
 *   fromName            — optional (falls back to campaign.variable_values.from_name)
 *   fromEmail           — optional (falls back to campaign.variable_values.from_email)
 *   clickTracking       — optional (defaults true in send-stream)
 *   openTracking        — optional (defaults true in send-stream)
 *   resendClickTracking — optional (defaults false)
 *   resendOpenTracking  — optional (defaults false)
 */
export const apiSend = inngest.createFunction(
    { id: "api-send" },
    { event: "campaign.send" },
    async ({ event, step }) => {
        const {
            campaignId,
            fromName,
            fromEmail,
            clickTracking,
            openTracking,
            resendClickTracking,
            resendOpenTracking,
        } = event.data;

        // Delegate all send logic to /api/send-stream (single source of truth).
        // step.run() gives automatic Inngest retry + checkpoint on the send step.
        const result = await step.run("send-via-stream", async () => {
            const response = await fetch(`${baseUrl}/api/send-stream`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    campaignId,
                    fromName: fromName ?? null,
                    fromEmail: fromEmail ?? null,
                    clickTracking: clickTracking ?? true,
                    openTracking: openTracking ?? true,
                    resendClickTracking: resendClickTracking ?? false,
                    resendOpenTracking: resendOpenTracking ?? false,
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`send-stream responded ${response.status}: ${errText}`);
            }

            // send-stream returns NDJSON lines; parse the final stats line
            const text = await response.text();
            const lines = text.trim().split("\n").filter(Boolean);
            const lastLine = lines[lines.length - 1];
            try {
                return JSON.parse(lastLine);
            } catch {
                return { done: true, stats: {} };
            }
        });

        return {
            event: "campaign.send.completed",
            body: {
                campaignId,
                stats: result.stats || {},
            },
        };
    }
);
