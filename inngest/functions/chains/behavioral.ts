import { inngest } from "@/inngest/client";
import { createClient } from "@supabase/supabase-js";
import { sendChainEmail } from "@/lib/chains/sender";
import { generateJITDraft } from "@/app/actions/jit-actions";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

/**
 * Customize Page Abandonment — HITL Workflow (Admin Approval Required)
 * 
 * Flow:
 *   1. Wait 2 hours
 *   2. Purchase check → halt if already converted (all-time)
 *   3. Generate AI draft for ALL engagement levels
 *   4. Wait up to 24h for admin approval on /approvals
 *   5. If approved → send. If rejected/timeout → discard (NO auto-send).
 */
export const customizeAbandonment = inngest.createFunction(
    {
        id: "chain-customize-abandonment",
        name: "Behavioral: Customize Abandonment (HITL)",
        idempotency: "event.data.subscriberId",
    },
    { event: "chain.abandon.customize" },
    async ({ event, step }) => {
        const { subscriberId, duration } = event.data;

        // ─── STEP 1: Wait 2 hours ───────────────────────
        await step.sleep("wait-for-purchase", "2h");

        // ─── STEP 2: Purchase Check (all-time) ──────────
        const purchased = await step.run("check-purchase", async () => {
            const { data } = await supabase
                .from("subscriber_events")
                .select("id")
                .eq("subscriber_id", subscriberId)
                .in("type", ["conversion_t3", "conversion_t2"])
                .limit(1);

            return (data && data.length > 0);
        });

        if (purchased) {
            return { status: "halted", reason: "already_purchased" };
        }

        // ─── STEP 3: Fetch subscriber ───────────────────
        const subscriber = await step.run("fetch-subscriber", async () => {
            const { data } = await supabase
                .from("subscribers")
                .select("id, email, first_name, smart_tags, tags")
                .eq("id", subscriberId)
                .eq("status", "active")
                .single();
            return data;
        });

        if (!subscriber) {
            return { status: "halted", reason: "subscriber_not_found" };
        }

        const engagement = subscriber.smart_tags?.engagement || "low";

        // ─── STEP 4: Generate AI Draft (all engagement levels) ─
        const draft = await step.run("generate-ai-draft", async () => {
            return generateJITDraft(
                subscriberId,
                `Cart abandonment: spent ${duration}s on /customize (engagement: ${engagement}). Offer to answer questions about the 15/16th size, mention Founder's Batch pricing ending soon.`
            );
        });

        if ("error" in draft) {
            // AI draft failed — do NOT auto-send anything, just halt
            return {
                status: "halted",
                reason: "draft_generation_failed",
                engagement,
                error: draft.error,
            };
        }

        // ─── STEP 5: Wait up to 24h for admin approval ─
        const approval = await step.waitForEvent("wait-for-admin-approval", {
            event: "jit.decision",
            timeout: "24h",
            match: "data.campaignId",
        });

        // ─── STEP 6: Execute or Discard ─────────────────
        if (approval?.data?.decision === "approved") {
            // Admin approved → send the AI draft
            const result = await step.run("send-approved-draft", async () => {
                return sendChainEmail(
                    subscriber.id,
                    subscriber.email,
                    subscriber.first_name || "there",
                    draft.campaignId
                );
            });

            await step.run("mark-draft-completed", async () => {
                await supabase
                    .from("campaigns")
                    .update({ status: "completed" })
                    .eq("id", draft.campaignId);
            });

            return {
                status: "sent_approved",
                engagement,
                campaignId: draft.campaignId,
                body: result,
            };
        }

        // Rejected or timeout → discard, do NOT send any fallback
        await step.run("mark-draft-expired", async () => {
            const newStatus = approval?.data?.decision === "rejected" ? "rejected" : "expired";
            await supabase
                .from("campaigns")
                .update({ status: newStatus })
                .eq("id", draft.campaignId);
        });

        return {
            status: approval?.data?.decision === "rejected" ? "discarded_rejected" : "discarded_timeout",
            engagement,
            campaignId: draft.campaignId,
        };
    }
);
