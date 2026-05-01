import { createClient as createServiceClient } from "@supabase/supabase-js"
import { UnsubscribeConfirm } from "./unsubscribe-confirm"

const WORKSPACE_LABELS: Record<string, string> = {
    dreamplay_marketing: "DreamPlay Marketing",
    dreamplay_support: "DreamPlay Support",
    musicalbasics: "MusicalBasics",
    crossover: "Crossover",
    concert_marketing: "Concert Marketing",
}

// Where to send a recipient who clicks "Keep me subscribed" — i.e. they
// landed on the unsubscribe page by mistake and want to bounce back to the
// brand site, not the internal admin dashboard at email.dreamplaypianos.com.
const WORKSPACE_HOME_URLS: Record<string, string> = {
    dreamplay_marketing: "https://dreamplaypianos.com",
    dreamplay_support: "https://dreamplaypianos.com",
    crossover: "https://dreamplaypianos.com",
    musicalbasics: "https://www.musicalbasics.com",
    concert_marketing: "https://www.musicalbasics.com",
}
const DEFAULT_HOME_URL = "https://dreamplaypianos.com"

export default async function UnsubscribePage({
    searchParams,
}: {
    searchParams: Promise<{ s?: string; c?: string; w?: string }>
}) {
    const { s: subscriberId, c: campaignId, w: workspace } = await searchParams

    if (!subscriberId) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-50">
                <div className="text-center p-8 bg-white rounded-lg shadow-sm border border-gray-100">
                    <p className="text-gray-500">Invalid unsubscribe link.</p>
                </div>
            </div>
        )
    }

    // Look up subscriber email (needed for "unsubscribe from all" option)
    let email: string | undefined
    try {
        const supabase = createServiceClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_KEY!
        )
        const { data } = await supabase
            .from("subscribers")
            .select("email")
            .eq("id", subscriberId)
            .single()
        email = data?.email
    } catch {
        // Non-fatal: Option 2 will be hidden if email is unavailable
    }

    const workspaceLabel = workspace ? (WORKSPACE_LABELS[workspace] ?? workspace) : undefined
    const homeUrl = (workspace && WORKSPACE_HOME_URLS[workspace]) || DEFAULT_HOME_URL

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
            <div className="max-w-lg w-full bg-white rounded-xl shadow-sm p-8 border border-gray-100">
                <UnsubscribeConfirm
                    subscriberId={subscriberId}
                    campaignId={campaignId}
                    email={email}
                    workspaceLabel={workspaceLabel}
                    homeUrl={homeUrl}
                />
            </div>
        </div>
    )
}
