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

    let dbgInsertOutcome = "skipped";
    let dbgInsertErr = "";
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
            dbgInsertErr = msg.slice(0, 80);
            if (/ip_address|user_agent/i.test(msg)) {
                console.warn("[track/click] subscriber_events missing ip/ua columns, falling back. Run the migration in dp-email-3/_work/migrations/.");
                await supabase.from("subscriber_events").insert(baseRow);
                dbgInsertOutcome = "fallback";
            } else {
                console.error("[track/click] insert failed:", enrichedInsert.error);
                dbgInsertOutcome = "error-no-fallback";
            }
        } else {
            dbgInsertOutcome = "enriched-ok";
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

    const res = NextResponse.redirect(destination.toString());
    // Deploy marker so we can confirm which build is actually serving.
    res.headers.set("x-track-click-version", "ip-ua-2026-05-02");
    // Debug: surface what we actually saw on the request side, so we can
    // tell whether NULL ip/ua is a header-not-passed issue or an
    // insert-not-writing-it issue.
    const dbgUa = request.headers.get("user-agent");
    const dbgXff = request.headers.get("x-forwarded-for");
    res.headers.set("x-debug-ua-len", String(dbgUa?.length ?? 0));
    res.headers.set("x-debug-xff-len", String(dbgXff?.length ?? 0));
    res.headers.set("x-debug-insert", dbgInsertOutcome);
    if (dbgInsertErr) res.headers.set("x-debug-insert-err", encodeURIComponent(dbgInsertErr));
    return res;
}
