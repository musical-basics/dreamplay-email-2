import { inngest } from "@/inngest/client";
import { createClient } from "@supabase/supabase-js";
import { proxyEmailImages } from "@/lib/image-proxy";
import { addPlayButtonsToVideoThumbnails } from "@/lib/video-overlay";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

export const scheduledRotationSend = inngest.createFunction(
    { id: "scheduled-rotation-send" },
    { event: "rotation.scheduled-send" },
    async ({ event, step }) => {
        const { rotationId, subscriberIds, scheduledAt, fromName, fromEmail, clickTracking, openTracking, resendClickTracking, resendOpenTracking } = event.data;

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
        // PRE-PROCESS: proxy images on all template campaigns before sending
        await step.run("pre-process-images", async () => {
            // Fetch the rotation to get its campaign IDs
            const { data: rot } = await supabase
                .from("rotations")
                .select("campaign_ids")
                .eq("id", rotationId)
                .single();

            if (!rot?.campaign_ids?.length) {
                console.log("[scheduled-rotation] No campaigns to pre-process, skipping.");
                return;
            }

            const { data: templates } = await supabase
                .from("campaigns")
                .select("id, html_content")
                .in("id", rot.campaign_ids);

            if (!templates?.length) return;

            for (const template of templates) {
                if (!template.html_content) continue;
                try {
                    console.log("[scheduled-rotation] Pre-processing images for template", template.id);
                    const withOverlay = await addPlayButtonsToVideoThumbnails(template.html_content);
                    const optimized = await proxyEmailImages(withOverlay);
                    if (optimized !== template.html_content) {
                        await supabase
                            .from("campaigns")
                            .update({ html_content: optimized })
                            .eq("id", template.id);
                        console.log("[scheduled-rotation] ✅ Pre-optimized HTML saved for template", template.id);
                    }
                } catch (err: any) {
                    console.error("[scheduled-rotation] ⚠️ Image pre-processing failed for", template.id, ":", err.message);
                }
            }
        });

        // Fire the actual send via the existing streaming API
        const result = await step.run("send-rotation", async () => {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://email.dreamplaypianos.com";
            const response = await fetch(`${baseUrl}/api/send-rotation`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    rotationId,
                    subscriberIds,
                    fromName: fromName || null,
                    fromEmail: fromEmail || null,
                    clickTracking: clickTracking ?? true,
                    openTracking: openTracking ?? true,
                    resendClickTracking: resendClickTracking ?? false,
                    resendOpenTracking: resendOpenTracking ?? false,
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
