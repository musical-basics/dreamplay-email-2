import { inngest } from "@/inngest/client";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

export const scheduledRotationSend = inngest.createFunction(
    { id: "scheduled-rotation-send" },
    { event: "rotation.scheduled-send" },
    async ({ event, step }) => {
        const { rotationId, subscriberIds, scheduledAt } = event.data;

        // Wait until the scheduled time
        await step.sleepUntil("wait-for-schedule", new Date(scheduledAt));

        // Re-check rotation status (may have been cancelled)
        const rotation = await step.run("check-rotation", async () => {
            const { data, error } = await supabase
                .from("rotations")
                .select("id, scheduled_status")
                .eq("id", rotationId)
                .single();

            if (error || !data) throw new Error("Rotation not found");
            return data;
        });

        // Abort if cancelled
        if (rotation.scheduled_status === "cancelled") {
            return { message: "Rotation schedule was cancelled", rotationId };
        }
        if (rotation.scheduled_status === "sent") {
            return { message: "Rotation already sent", rotationId };
        }

        // Fire the actual send via the existing streaming API
        const result = await step.run("send-rotation", async () => {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://email.dreamplaypianos.com";
            const response = await fetch(`${baseUrl}/api/send-rotation`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    rotationId,
                    subscriberIds,
                }),
            });

            // The response is a stream, consume it fully
            const text = await response.text();
            const lines = text.trim().split("\n").filter(Boolean);
            const lastLine = lines[lines.length - 1];
            try {
                const parsed = JSON.parse(lastLine);
                if (parsed.done) {
                    return { success: true, message: parsed.message, stats: parsed.stats };
                }
            } catch {
                // Fall through
            }

            if (!response.ok) {
                throw new Error(`Rotation send failed: ${text.slice(0, 200)}`);
            }

            return { success: true, message: "Rotation send completed" };
        });

        // Update rotation scheduled status
        await step.run("update-status", async () => {
            await supabase
                .from("rotations")
                .update({
                    scheduled_status: "sent",
                    scheduled_at: null,
                    scheduled_subscriber_ids: null,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", rotationId);
        });

        return {
            message: "Scheduled rotation sent successfully",
            rotationId,
            result,
        };
    }
);
