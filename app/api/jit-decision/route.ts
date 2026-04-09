import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { sendChainEmail } from "@/lib/chains/sender";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

/**
 * Handles admin approval or rejection of AI-generated drafts.
 * 
 * On APPROVE: directly sends the email via sendChainEmail, marks campaign
 * as completed, and fires the Inngest event (in case a function is waiting).
 * 
 * On REJECT: marks campaign as rejected and fires the Inngest event.
 * 
 * The direct send ensures the email goes out even if no Inngest function
 * is currently waiting for the decision event.
 */
export async function POST(req: Request) {
    try {
        const { campaignId, decision } = await req.json();

        if (!campaignId || !["approved", "rejected"].includes(decision)) {
            return NextResponse.json(
                { error: "Invalid request. Need campaignId and decision (approved|rejected)." },
                { status: 400 }
            );
        }

        if (decision === "approved") {
            // Fetch the campaign draft to get subscriber details
            const { data: campaign, error: campaignError } = await supabase
                .from("campaigns")
                .select("*")
                .eq("id", campaignId)
                .single();

            if (campaignError || !campaign) {
                return NextResponse.json(
                    { error: "Campaign not found." },
                    { status: 404 }
                );
            }

            const subscriberId = campaign.variable_values?.subscriber_id;
            if (!subscriberId) {
                return NextResponse.json(
                    { error: "No subscriber_id found in campaign." },
                    { status: 400 }
                );
            }

            // Fetch subscriber
            const { data: subscriber } = await supabase
                .from("subscribers")
                .select("id, email, first_name")
                .eq("id", subscriberId)
                .eq("status", "active")
                .single();

            if (!subscriber) {
                return NextResponse.json(
                    { error: "Subscriber not found or inactive." },
                    { status: 404 }
                );
            }

            // Send the email directly
            const sendResult = await sendChainEmail(
                subscriber.id,
                subscriber.email,
                subscriber.first_name || "there",
                campaignId
            );

            if (!sendResult.success) {
                return NextResponse.json(
                    { error: `Send failed: ${sendResult.error}` },
                    { status: 500 }
                );
            }

            // Mark campaign as completed
            await supabase
                .from("campaigns")
                .update({ status: "completed" })
                .eq("id", campaignId);

        } else {
            // Rejected — mark campaign
            await supabase
                .from("campaigns")
                .update({ status: "rejected" })
                .eq("id", campaignId);
        }

        // Also fire Inngest event in case a behavioral function is waiting
        await inngest.send({
            name: "jit.decision",
            data: { campaignId, decision },
        });

        return NextResponse.json({ success: true, decision });
    } catch (error: any) {
        console.error("JIT Decision error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

