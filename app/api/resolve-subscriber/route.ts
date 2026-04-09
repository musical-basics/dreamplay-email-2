import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

// Allowed origins for CORS
const allowedOrigins = [
    "https://dreamplaypianos.com",
    "https://www.dreamplaypianos.com",
    "https://crowdfund.dreamplaypianos.com",
    "https://data.dreamplaypianos.com",
];

function getCorsHeaders(request: Request) {
    const origin = request.headers.get("origin");
    const allowOrigin = (origin && allowedOrigins.some(o => origin === o || origin.endsWith(".dreamplaypianos.com")))
        ? origin
        : allowedOrigins[0];

    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}

export async function OPTIONS(request: Request) {
    return NextResponse.json({}, { headers: getCorsHeaders(request) });
}

/**
 * GET /api/resolve-subscriber?sid=<subscriber_id>&cid=<campaign_id>
 * 
 * Resolves a subscriber's real email from their ID.
 * If cid is provided, also logs a "click" event in subscriber_events.
 * Called by the website's AnalyticsTracker when a visitor arrives with ?sid=
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const sid = searchParams.get("sid");
    const cid = searchParams.get("cid");

    if (!sid) {
        return NextResponse.json(
            { error: "sid required" },
            { status: 400, headers: getCorsHeaders(request) }
        );
    }

    try {
        // Look up subscriber by ID
        const { data: subscriber, error } = await supabase
            .from("subscribers")
            .select("id, email, first_name")
            .eq("id", sid)
            .single();

        if (error || !subscriber) {
            return NextResponse.json(
                { error: "not_found" },
                { status: 404, headers: getCorsHeaders(request) }
            );
        }

        // If campaign ID provided, log a real click event
        // (This replaces the click that was previously tracked by the redirect,
        //  which was triggered by email security scanners, not real users)
        if (cid) {
            await supabase.from("subscriber_events").insert({
                type: "click",
                campaign_id: cid,
                subscriber_id: sid,
                url: request.headers.get("referer") || "website",
            });
        }

        return NextResponse.json(
            { email: subscriber.email, first_name: subscriber.first_name },
            { headers: getCorsHeaders(request) }
        );

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[Resolve Subscriber] Error:", message);
        return NextResponse.json(
            { error: message },
            { status: 500, headers: getCorsHeaders(request) }
        );
    }
}
