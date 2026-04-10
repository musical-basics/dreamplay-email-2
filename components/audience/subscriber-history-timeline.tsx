import { useEffect, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
    Mail,
    MousePointer2,
    Eye,
    Globe,
    Clock,
    MoreHorizontal,
    ArrowUpRight,
    Send,
    Link2
} from "lucide-react"
import { getSubscriberHistory, getSubscriberCampaigns, getSubscriberChains } from "@/app/actions/subscriber-history"
import { Badge } from "@/components/ui/badge"

interface TimelineEvent {
    id: string
    type: 'sent' | 'open' | 'click' | 'page_view' | 'session_end'
    created_at: string
    url?: string
    ip_address?: string
    metadata?: { duration_seconds?: number }
    campaigns?: { name: string }
}

interface CampaignSend {
    campaign_id: string
    created_at: string
    campaigns: { id: string; name: string; status: string } | null
}

interface ChainProcess {
    id: string
    status: string
    current_step_index: number
    created_at: string
    updated_at: string
    email_chains: { id: string; name: string; slug: string } | null
}

export function SubscriberHistoryTimeline({ subscriberId }: { subscriberId: string }) {
    const [events, setEvents] = useState<TimelineEvent[]>([])
    const [campaigns, setCampaigns] = useState<CampaignSend[]>([])
    const [chains, setChains] = useState<ChainProcess[]>([])
    const [loading, setLoading] = useState(true)
    const params = useParams<{ workspace: string }>()
    const workspace = params?.workspace || "dreamplay_marketing"

    useEffect(() => {
        Promise.all([
            getSubscriberHistory(subscriberId),
            getSubscriberCampaigns(subscriberId),
            getSubscriberChains(subscriberId),
        ]).then(([historyData, campaignData, chainData]) => {
            setEvents(historyData as any)
            setCampaigns(campaignData as any)
            setChains(chainData as any)
            setLoading(false)
        })
    }, [subscriberId])

    const getIcon = (type: string) => {
        switch (type) {
            case 'sent': return <Mail className="w-3.5 h-3.5 text-zinc-400" />
            case 'open': return <Eye className="w-3.5 h-3.5 text-amber-400" />
            case 'click': return <MousePointer2 className="w-3.5 h-3.5 text-emerald-400" />
            case 'page_view': return <Globe className="w-3.5 h-3.5 text-blue-400" />
            case 'session_end': return <Clock className="w-3.5 h-3.5 text-purple-400" />
            default: return <MoreHorizontal className="w-3.5 h-3.5 text-zinc-500" />
        }
    }

    const formatDuration = (seconds?: number) => {
        if (!seconds) return ""
        if (seconds < 60) return `${seconds}s`
        return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    }

    const chainStatusStyle: Record<string, string> = {
        active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        completed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        paused: "bg-amber-500/10 text-amber-400 border-amber-500/20",
        cancelled: "bg-red-500/10 text-red-400 border-red-500/20",
    }

    if (loading) return <div className="py-4 text-center text-sm text-muted-foreground">Loading history...</div>

    // Group consecutive identical events
    type GroupedEvent = TimelineEvent & { count: number }
    const grouped: GroupedEvent[] = []
    for (const event of events) {
        const prev = grouped[grouped.length - 1]
        const sameType = prev && prev.type === event.type
        const sameCampaign = prev?.campaigns?.name === event.campaigns?.name
        const sameUrl = prev?.url === event.url
        if (sameType && sameCampaign && sameUrl) {
            prev.count++
        } else {
            grouped.push({ ...event, count: 1 })
        }
    }

    const label = (type: string, count: number) => {
        const names: Record<string, string> = {
            sent: "Received Email",
            open: "Opened Email",
            click: "Clicked Link",
            page_view: "Visited Website",
            session_end: "Session Ended",
        }
        const name = names[type] || type
        return count > 1 ? `${name} (×${count})` : name
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* ─── Activity Timeline (left, wider) ─── */}
            <div className="lg:col-span-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Activity Timeline
                </h3>
                {grouped.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
                ) : (
                    <div className="relative border-l border-border/60 ml-1 space-y-3 max-h-[350px] overflow-y-auto pr-1">
                        {grouped.map((event) => (
                            <div key={event.id} className="ml-3 relative">
                                {/* Dot */}
                                <div className="absolute -left-[17px] top-[5px] h-2.5 w-2.5 rounded-full border-2 border-background" style={{
                                    backgroundColor: event.type === 'open' ? '#f59e0b' :
                                        event.type === 'click' ? '#10b981' :
                                            event.type === 'page_view' ? '#3b82f6' :
                                                event.type === 'sent' ? '#71717a' : '#6b7280'
                                }} />

                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        {getIcon(event.type)}
                                        <span className="text-xs font-medium text-foreground">
                                            {label(event.type, event.count)}
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                                        {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                                    </span>
                                </div>

                                {/* Compact details */}
                                {(event.campaigns?.name || event.url || event.ip_address || event.metadata?.duration_seconds) && (
                                    <div className="mt-0.5 ml-5 text-[11px] text-muted-foreground space-y-0.5">
                                        {event.campaigns?.name && (
                                            <div className="truncate">{event.campaigns.name}</div>
                                        )}
                                        {event.url && (
                                            <a href={event.url} target="_blank" className="flex items-center gap-0.5 text-blue-400 hover:underline truncate">
                                                {(() => { try { return new URL(event.url).pathname } catch { return event.url } })()}
                                                <ArrowUpRight className="w-2.5 h-2.5 flex-shrink-0" />
                                            </a>
                                        )}
                                        <div className="flex gap-1.5">
                                            {event.metadata?.duration_seconds && (
                                                <Badge variant="secondary" className="text-[9px] h-4 px-1 bg-purple-500/10 text-purple-400 border-purple-500/20">
                                                    {formatDuration(event.metadata.duration_seconds)}
                                                </Badge>
                                            )}
                                            {event.ip_address && (
                                                <Badge variant="outline" className="text-[9px] h-4 px-1 text-zinc-500">
                                                    {event.ip_address}
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ─── Right column: Campaigns + Chains ─── */}
            <div className="space-y-4">
                {/* Campaigns Received */}
                <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Send className="w-3.5 h-3.5" />
                        Campaigns Received ({campaigns.length})
                    </h3>
                    {campaigns.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No campaigns sent yet.</p>
                    ) : (
                        <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
                            {campaigns.map((c) => (
                                <div key={c.campaign_id} className="flex items-center justify-between p-2 rounded-md bg-muted/30 border border-border/50">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Mail className="w-3 h-3 text-blue-400 flex-shrink-0" />
                                        <div className="min-w-0">
                                            <Link
                                                href={`/${workspace}/dashboard/${c.campaign_id}`}
                                                className="text-xs font-medium text-foreground hover:underline truncate block"
                                            >
                                                {c.campaigns?.name || "Unknown Campaign"}
                                            </Link>
                                            <span className="text-[10px] text-muted-foreground">
                                                {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                                            </span>
                                        </div>
                                    </div>
                                    {c.campaigns?.status && (
                                        <Badge variant="outline" className="text-[9px] capitalize ml-1 flex-shrink-0 h-4 px-1">
                                            {c.campaigns.status}
                                        </Badge>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Chain Enrollments */}
                <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Link2 className="w-3.5 h-3.5" />
                        Chain Enrollments ({chains.length})
                    </h3>
                    {chains.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Not enrolled in any chains.</p>
                    ) : (
                        <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
                            {chains.map((ch) => (
                                <div key={ch.id} className="flex items-center justify-between p-2 rounded-md bg-muted/30 border border-border/50">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Link2 className="w-3 h-3 text-purple-400 flex-shrink-0" />
                                        <div className="min-w-0">
                                            <span className="text-xs font-medium text-foreground truncate block">
                                                {ch.email_chains?.name || "Unknown Chain"}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground">
                                                Step {ch.current_step_index + 1} · {formatDistanceToNow(new Date(ch.created_at), { addSuffix: true })}
                                            </span>
                                        </div>
                                    </div>
                                    <Badge
                                        variant="outline"
                                        className={`text-[9px] capitalize ml-1 flex-shrink-0 h-4 px-1 ${chainStatusStyle[ch.status] || ""}`}
                                    >
                                        {ch.status}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
