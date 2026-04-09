import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { type, rotationId, subscriberIds, scheduledAt } = body;

        if (!rotationId) {
            return NextResponse.json({ error: "rotationId is required" }, { status: 400 });
        }

        if (type === "schedule") {
            if (!scheduledAt) {
                return NextResponse.json({ error: "scheduledAt is required" }, { status: 400 });
            }

            const scheduledDate = new Date(scheduledAt);
            if (scheduledDate <= new Date()) {
                return NextResponse.json({ error: "Scheduled time must be in the future" }, { status: 400 });
            }

            if (!subscriberIds || subscriberIds.length === 0) {
                return NextResponse.json({ error: "subscriberIds are required" }, { status: 400 });
            }

            // Save schedule to rotation
            await supabaseAdmin
                .from("rotations")
                .update({
                    scheduled_at: scheduledDate.toISOString(),
                    scheduled_status: "pending",
                    scheduled_subscriber_ids: subscriberIds,
                })
                .eq("id", rotationId);

            // Send delayed Inngest event
            const { inngest } = await import("@/inngest/client");
            await inngest.send({
                name: "rotation.scheduled-send",
                data: {
                    rotationId,
                    subscriberIds,
                    scheduledAt: scheduledDate.toISOString(),
                },
            });

            return NextResponse.json({
                success: true,
                message: `Rotation scheduled for ${scheduledDate.toLocaleString()}`,
                scheduledAt: scheduledDate.toISOString(),
            });
        }

        else if (type === "cancel_schedule") {
            await supabaseAdmin
                .from("rotations")
                .update({
                    scheduled_at: null,
                    scheduled_status: "cancelled",
                    scheduled_subscriber_ids: null,
                })
                .eq("id", rotationId);

            return NextResponse.json({
                success: true,
                message: "Rotation schedule cancelled",
            });
        }

        return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    } catch (error: any) {
        console.error("Schedule rotation error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
