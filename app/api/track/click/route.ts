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
        // Capture IP + User-Agent so a read-time filter can exclude email
        // security scanners (Microsoft ATP Safe Links, Mimecast, Proofpoint,
        // Slack/Discord link unfurlers, etc.) from real human clicks.
        // Vercel forwards the client IP as x-forwarded-for; first hop is the
        // real client.
        const xff = request.headers.get("x-forwarded-for") || "";
        const ipAddress = xff.split(",")[0].trim() || null;
        const userAgent = request.headers.get("user-agent") || null;

        const baseRow = {
            type: "click",
            campaign_id: campaignId,
            subscriber_id: subscriberId,
            url: url,
        };
        // Defensive: try the new shape first; if the columns don't exist
        // yet (migration not run), fall back so the redirect still works.
        const enrichedInsert = await supabase.from("subscriber_events").insert({
            ...baseRow,
            ip_address: ipAddress,
            user_agent: userAgent,
        });
        if (enrichedInsert.error) {
            const msg = enrichedInsert.error.message || "";
            if (/ip_address|user_agent/i.test(msg)) {
                console.warn("[track/click] subscriber_events missing ip/ua columns, falling back.");
                await supabase.from("subscriber_events").insert(baseRow);
            } else {
                console.error("[track/click] insert failed:", enrichedInsert.error);
            }
        }
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
