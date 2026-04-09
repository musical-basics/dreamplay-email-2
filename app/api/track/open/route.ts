import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get("c");
    const subscriberId = searchParams.get("s");

    console.log(`[Open Pixel] Hit — c=${campaignId}, s=${subscriberId}`);

    if (campaignId && subscriberId) {
        const { error } = await supabase.from("subscriber_events").insert({
            type: "open",
            campaign_id: campaignId,
            subscriber_id: subscriberId,
        });
        if (error) {
            console.error(`[Open Pixel] Insert FAILED — c=${campaignId}, s=${subscriberId}:`, error.message, error.details, error.code);
        } else {
            console.log(`[Open Pixel] Insert OK — c=${campaignId}, s=${subscriberId}`);
        }
    } else {
        console.warn(`[Open Pixel] Missing params — c=${campaignId}, s=${subscriberId}`);
    }

    // Return a 1x1 transparent GIF
    const pixel = Buffer.from(
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        "base64"
    );

    return new NextResponse(pixel, {
        headers: {
            "Content-Type": "image/gif",
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    });
}
