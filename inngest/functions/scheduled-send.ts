import { inngest } from "@/inngest/client";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

export const scheduledCampaignSend = inngest.createFunction(
    { id: "scheduled-campaign-send" },
    { event: "campaign.scheduled-send" },
    async ({ event, step }) => {
        const { campaignId, scheduledAt, fromName, fromEmail, clickTracking, openTracking, resendClickTracking, resendOpenTracking } = event.data;

        // Wait until the scheduled time
        await step.sleepUntil("wait-for-schedule", new Date(scheduledAt));

        // Re-check campaign status (may have been cancelled)
        const campaign = await step.run("check-campaign", async () => {
            const { data, error } = await supabase
                .from("campaigns")
                .select("id, scheduled_status, status")
                .eq("id", campaignId)
                .single();

            if (error || !data) throw new Error("Campaign not found");
            return data;
        });

        // Abort if cancelled or already sent
        if (campaign.scheduled_status === "cancelled") {
            return { message: "Schedule was cancelled", campaignId };
        }
        if (campaign.scheduled_status === "sent" || campaign.status === "completed") {
            return { message: "Campaign already sent", campaignId };
        }

        // Fire the actual send via send-stream (source of truth — same route as the "Send Campaign" button)
        const result = await step.run("send-broadcast", async () => {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://email.dreamplaypianos.com";
            const response = await fetch(`${baseUrl}/api/send-stream`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    campaignId,
                    fromName: fromName || "Lionel Yu",
                    fromEmail: fromEmail || "lionel@email.dreamplaypianos.com",
                    clickTracking: clickTracking ?? true,
                    openTracking: openTracking ?? true,
                    resendClickTracking: resendClickTracking ?? false,
                    resendOpenTracking: resendOpenTracking ?? false,
                    triggeredBy: "scheduled",
                }),
            });

            // send-stream returns an NDJSON stream — consume it fully and parse the final summary line
            const text = await response.text();
            const lines = text.trim().split("\n").filter(Boolean);
            const lastLine = lines[lines.length - 1];
            try {
                const parsed = JSON.parse(lastLine);
                if (parsed.done) {
                    return { success: true, message: parsed.message, stats: parsed.stats };
                }
            } catch {
                // Fall through to generic success
            }

            if (!response.ok) throw new Error(`Broadcast failed: ${text.slice(0, 200)}`);
            // Stream completed without a done:true marker — connection was severed mid-flight
            throw new Error(`Broadcast stream truncated. Last output: ${text.slice(-300)}`);
        });

        // Update scheduled status
        await step.run("update-status", async () => {
            await supabase
                .from("campaigns")
                .update({ scheduled_status: "sent", updated_at: new Date().toISOString() })
                .eq("id", campaignId);
        });

        return {
            message: "Scheduled campaign sent successfully",
            campaignId,
            result,
        };
    }
);
