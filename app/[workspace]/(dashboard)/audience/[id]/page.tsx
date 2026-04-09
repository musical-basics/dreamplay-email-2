import { createClient } from "@/lib/supabase/server"
import { SubscriberHistoryTimeline } from "@/components/audience/subscriber-history-timeline"
import { notFound } from "next/navigation"

export default async function SubscriberProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const supabase = await createClient()
    const { data: subscriber } = await supabase
        .from("subscribers")
        .select("*")
        .eq("id", id)
        .single()

    if (!subscriber) notFound()

    return (
        <div className="p-6 max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Col: Profile Info */}
            <div className="lg:col-span-1 space-y-6">
                <div>
                    <h1 className="text-2xl font-bold">{subscriber.first_name} {subscriber.last_name}</h1>
                    <p className="text-muted-foreground">{subscriber.email}</p>
                </div>

                <div className="p-4 rounded-lg bg-card border border-border space-y-2">
                    <p className="text-sm"><span className="text-muted-foreground">Location:</span> {subscriber.location_city}, {subscriber.location_country}</p>
                    <p className="text-sm"><span className="text-muted-foreground">Status:</span> <span className="capitalize text-emerald-400">{subscriber.status}</span></p>
                </div>
            </div>

            {/* Right Col: The Timeline */}
            <div className="lg:col-span-2">
                <SubscriberHistoryTimeline subscriberId={subscriber.id} />
            </div>
        </div>
    )
}
