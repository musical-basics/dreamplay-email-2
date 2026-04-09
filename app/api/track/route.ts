import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

// 1. Smart CORS (Allow your website to talk to this API)
const allowedOrigins = [
    "https://dreamplaypianos.com",
    "https://www.dreamplaypianos.com",
    "http://localhost:3000",
    "http://localhost:3002",
];

function getCorsHeaders(request: Request) {
    const origin = request.headers.get("origin") || "";
    const isAllowed = allowedOrigins.includes(origin) || origin.endsWith(".vercel.app") || origin.includes("localhost");
    const allow = isAllowed ? origin : allowedOrigins[0];
    return {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}

export async function OPTIONS(request: Request) {
    return NextResponse.json({}, { headers: getCorsHeaders(request) });
}

export async function POST(request: Request) {
    try {
        const { subscriber_id, campaign_id, type, url, duration, ip, temp_session_id } = await request.json();

        // 2. Validate — need at least subscriber_id or temp_session_id
        if (!subscriber_id && !temp_session_id) return NextResponse.json({ error: "No ID" }, { status: 400 });

        // Extract IP from request headers (server-side, reliable)
        const forwarded = request.headers.get("x-forwarded-for");
        const serverIP = forwarded ? forwarded.split(",")[0].trim() : request.headers.get("x-real-ip") || ip || null;

        // 3. Log the Event
        const metadata: Record<string, any> = {};
        if (duration) metadata.duration_seconds = duration;
        if (temp_session_id) metadata.temp_session_id = temp_session_id;

        await supabase.from("subscriber_events").insert({
            subscriber_id: subscriber_id || null,
            campaign_id,
            type,
            url,
            ip_address: serverIP,
            metadata: Object.keys(metadata).length > 0 ? metadata : {},
        });

        // 4. Browse Abandonment Triggers
        if (type === "session_end" && duration > 10 && subscriber_id) {
            if (url?.includes("/customize")) {
                await inngest.send({
                    name: "chain.abandon.customize",
                    data: { subscriberId: subscriber_id, url, duration },
                });
            }
        }

        return NextResponse.json({ success: true }, { headers: getCorsHeaders(request) });

    } catch (error) {
        return NextResponse.json({ error: "Track failed" }, { status: 500 });
    }
}
