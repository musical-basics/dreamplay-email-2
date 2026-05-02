import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("u");
    const campaignId = searchParams.get("c");
    const subscriberId = searchParams.get("s");
    const email = searchParams.get("em");

    if (!url) return new NextResponse("Missing URL", { status: 400 });

    if (campaignId && subscriberId) {
        // Just log the event — rates are computed from unique events at read time
        await supabase.from("subscriber_events").insert({
            type: "click",
            campaign_id: campaignId,
            subscriber_id: subscriberId,
            url: url
        });
    }

    // Prepare the destination URL
    let destination: URL;
    try {
        destination = new URL(url);

        // 1. DEFINE ALLOWED DOMAINS (Whitelist)
        const allowedDomains = [
            "dreamplaypianos.com",
            "www.dreamplaypianos.com",
            "musicalbasics.com",
            "ultimatepianist.com",
            "youtube.com",
            "youtu.be",
            "instagram.com",
            "localhost" // Keep for dev
        ];

        // 2. CHECK IF DOMAIN IS ALLOWED
        // We check if the hostname matches or ends with our allowed domains to catch subdomains
        const isAllowed = allowedDomains.some(d =>
            destination.hostname === d || destination.hostname.endsWith(`.${d}`)
        );

        if (!isAllowed) {
            // BLOCK SUSPICIOUS REDIRECTS
            console.error(`Blocked open redirect attempt to: ${destination.hostname}`);
            return new NextResponse("Invalid destination", { status: 400 });
        }

        // 3. Add tracking params for our own domains
        const ownDomains = ["dreamplaypianos.com", "musicalbasics.com", "ultimatepianist.com"];
        const isOwnDomain =
            ownDomains.some((d) => destination.hostname === d || destination.hostname.endsWith(`.${d}`)) ||
            destination.hostname === "localhost";
        if (isOwnDomain) {
            if (subscriberId) destination.searchParams.set("sid", subscriberId);
            if (campaignId) destination.searchParams.set("cid", campaignId);
        }
    } catch (e) {
        // Fallback for relative URLs or malformed URLs
        // If it's a relative URL, it will redirect to the same domain which is safe,
        // but let's be extra cautious and just block it if it's not a valid absolute URL.
        return new NextResponse("Invalid URL", { status: 400 });
    }

    return NextResponse.redirect(destination.toString());
}
