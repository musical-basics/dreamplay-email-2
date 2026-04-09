"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    Search, Mail, Eye, MousePointer2, GitBranch, Tag, FlaskConical,
    CalendarDays, ExternalLink, ChevronDown, ChevronUp, Loader2,
    PlayCircle, Pause, CheckCircle2, XCircle, Route, MailPlus, AlertTriangle,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
    getSubscribersWithJourneySummary,
    getSubscriberJourneyDetail,
    type JourneyCampaignEntry,
} from "@/app/actions/journey-actions"
import { getChains, getDraftChainsForSubscriber, type ChainRow } from "@/app/actions/chains"
import { startChainProcess, updateProcessStatus } from "@/app/actions/chain-processes"
import { getTags, type TagDefinition } from "@/app/actions/tags"
import { DEFAULT_WORKSPACE } from "@/lib/workspace"
import { formatDistanceToNow } from "date-fns"

// ─── Types ─────────────────────────────────────────────────
interface SubscriberSummary {
    id: string
    email: string
    first_name: string
    last_name: string
    tags: string[] | null
    status: string
    created_at: string
    emails_received: number
    active_chains: number
}

interface ChainEnrollment {
    id: string
    status: string
    current_step_index: number
    created_at: string
    chain_name: string
    chain_slug: string
    total_steps: number
}

interface JourneyDetail {
    campaigns: JourneyCampaignEntry[]
    chains: ChainEnrollment[]
    summary: { total_sent: number; total_opened: number; total_clicked: number }
}

const statusStyles: Record<string, string> = {
    active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    inactive: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    bounced: "bg-red-500/20 text-red-400 border-red-500/30",
    unsubscribed: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
}

const chainStatusIcon: Record<string, React.ReactNode> = {
    active: <PlayCircle className="h-3.5 w-3.5 text-emerald-400" />,
    paused: <Pause className="h-3.5 w-3.5 text-amber-400" />,
    completed: <CheckCircle2 className="h-3.5 w-3.5 text-blue-400" />,
    cancelled: <XCircle className="h-3.5 w-3.5 text-red-400" />,
}

// ─── Main Component ────────────────────────────────────────
export function CustomerJourneysTab({ onStartNewChain }: { onStartNewChain?: (subscriberId: string, subscriberName: string) => void }) {
    const [subscribers, setSubscribers] = useState<SubscriberSummary[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [statusFilter, setStatusFilter] = useState<string>("all")
    const [testAccountFilter, setTestAccountFilter] = useState(false)

    // Inline expansion state
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [journeyDetail, setJourneyDetail] = useState<JourneyDetail | null>(null)
    const [loadingDetail, setLoadingDetail] = useState(false)

    // Chain picker
    const [chainPickerOpen, setChainPickerOpen] = useState(false)
    const [masterChains, setMasterChains] = useState<ChainRow[]>([])
    const [subscriberDrafts, setSubscriberDrafts] = useState<ChainRow[]>([])
    const [loadingPicker, setLoadingPicker] = useState(false)
    const [startingChain, setStartingChain] = useState(false)
    const [selectedChain, setSelectedChain] = useState<ChainRow | null>(null)
    const [confirmOpen, setConfirmOpen] = useState(false)

    const { toast } = useToast()

    // Tag color definitions
    const [tagDefinitions, setTagDefinitions] = useState<TagDefinition[]>([])
    const tagColors = useMemo(() => {
        const colors: Record<string, string> = {}
        tagDefinitions.forEach(td => { colors[td.name] = td.color })
        return colors
    }, [tagDefinitions])

    const fetchSubscribers = useCallback(async () => {
        setLoading(true)
        const data = await getSubscribersWithJourneySummary()
        setSubscribers(data)
        setLoading(false)
    }, [])

    useEffect(() => {
        fetchSubscribers()
        getTags(DEFAULT_WORKSPACE).then(({ tags }) => setTagDefinitions(tags))
    }, [fetchSubscribers])

    // Toggle inline expansion
    const toggleExpand = async (sub: SubscriberSummary) => {
        if (expandedId === sub.id) {
            setExpandedId(null)
            setJourneyDetail(null)
            setChainPickerOpen(false)
            return
        }
        setExpandedId(sub.id)
        setJourneyDetail(null)
        setLoadingDetail(true)
        setChainPickerOpen(false)
        const detail = await getSubscriberJourneyDetail(sub.id)
        setJourneyDetail(detail)
        setLoadingDetail(false)
    }

    // Start existing chain for subscriber
    const handleStartChain = async (chain: ChainRow) => {
        if (!expandedId) return
        setStartingChain(true)
        const result = await startChainProcess(expandedId, chain.id)
        const sub = subscribers.find(s => s.id === expandedId)
        if (result.success) {
            toast({ title: "Chain started", description: `"${chain.name}" started for ${sub?.first_name || sub?.email || "subscriber"}` })
            const detail = await getSubscriberJourneyDetail(expandedId)
            setJourneyDetail(detail)
            fetchSubscribers()
        } else {
            toast({ title: "Error", description: result.error || "Failed to start chain", variant: "destructive" })
        }
        setStartingChain(false)
        setChainPickerOpen(false)
        setSelectedChain(null)
    }

    const openChainPicker = async () => {
        setChainPickerOpen(true)
        setLoadingPicker(true)
        // Fetch both master chains and subscriber-specific drafts in parallel
        const [mastersResult, draftsResult] = await Promise.all([
            masterChains.length === 0 ? getChains(DEFAULT_WORKSPACE) : Promise.resolve({ data: masterChains }),
            expandedId ? getDraftChainsForSubscriber(expandedId) : Promise.resolve({ data: [] as ChainRow[] }),
        ])
        setMasterChains(mastersResult.data || [])
        setSubscriberDrafts(draftsResult.data || [])
        setLoadingPicker(false)
    }

    // Filter
    const filtered = subscribers.filter(sub => {
        const matchesSearch = !search ||
            sub.email.toLowerCase().includes(search.toLowerCase()) ||
            (sub.first_name || "").toLowerCase().includes(search.toLowerCase()) ||
            (sub.last_name || "").toLowerCase().includes(search.toLowerCase())
        const matchesStatus = statusFilter === "all" || sub.status === statusFilter
        const matchesTestAccount = !testAccountFilter || (sub.tags && sub.tags.some(t => t.toLowerCase() === "test account"))
        return matchesSearch && matchesStatus && matchesTestAccount
    })

    return (
        <div className="space-y-4">
            {/* Search & Filter Bar */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name or email..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <Button
                    variant={testAccountFilter ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTestAccountFilter(prev => !prev)}
                    className={`gap-1.5 h-9 px-3 text-xs font-medium transition-colors ${testAccountFilter
                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30"
                        : "text-muted-foreground hover:text-foreground"
                        }`}
                >
                    <FlaskConical className="h-3.5 w-3.5" />
                    Test Accounts
                </Button>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[140px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
                        <SelectItem value="bounced">Bounced</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Subscriber List */}
            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-16">
                    <Route className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground">No subscribers found.</p>
                </div>
            ) : (
                <div className="space-y-1.5">
                    {filtered.map(sub => {
                        const isExpanded = expandedId === sub.id
                        return (
                            <div key={sub.id} className={`rounded-lg border transition-colors ${isExpanded ? "border-[#D4AF37]/50 bg-card" : "border-border bg-card hover:bg-muted/50"}`}>
                                {/* Row Header */}
                                <button
                                    onClick={() => toggleExpand(sub)}
                                    className="w-full text-left p-4"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold">
                                                {(sub.first_name?.[0] || sub.email[0]).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-foreground truncate">
                                                        {sub.first_name || sub.last_name
                                                            ? `${sub.first_name || ""} ${sub.last_name || ""}`.trim()
                                                            : sub.email}
                                                    </span>
                                                    <Badge variant="outline" className={`text-[10px] px-1.5 capitalize ${statusStyles[sub.status] || ""}`}>
                                                        {sub.status}
                                                    </Badge>
                                                </div>
                                                <p className="text-xs text-muted-foreground truncate">{sub.email}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4 flex-shrink-0">
                                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                <Mail className="h-3.5 w-3.5" />
                                                <span>{sub.emails_received} sent</span>
                                            </div>
                                            {sub.active_chains > 0 && (
                                                <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                                    <GitBranch className="h-3 w-3 mr-1" />
                                                    {sub.active_chains} active
                                                </Badge>
                                            )}
                                            {sub.tags && sub.tags.length > 0 && (
                                                <div className="hidden sm:flex items-center gap-1">
                                                    {sub.tags.slice(0, 2).map(tag => {
                                                        const hex = tagColors[tag]
                                                        return (
                                                            <Badge
                                                                key={tag}
                                                                variant="outline"
                                                                className="text-[10px] px-1.5"
                                                                style={hex ? {
                                                                    backgroundColor: `${hex}20`,
                                                                    color: hex,
                                                                    borderColor: `${hex}50`,
                                                                } : undefined}
                                                            >{tag}</Badge>
                                                        )
                                                    })}
                                                    {sub.tags.length > 2 && (
                                                        <span className="text-[10px] text-muted-foreground">+{sub.tags.length - 2}</span>
                                                    )}
                                                </div>
                                            )}
                                            {isExpanded
                                                ? <ChevronUp className="h-4 w-4 text-[#D4AF37]" />
                                                : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                            }
                                        </div>
                                    </div>
                                </button>

                                {/* Inline Expansion Panel */}
                                {isExpanded && (
                                    <div className="px-4 pb-5 pt-1 border-t border-border space-y-5">
                                        {/* Info Row */}
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <CalendarDays className="h-3.5 w-3.5" />
                                                Added {formatDistanceToNow(new Date(sub.created_at), { addSuffix: true })}
                                            </div>
                                            {sub.tags && sub.tags.length > 0 && (
                                                <div className="flex items-center gap-1.5">
                                                    <Tag className="h-3 w-3 text-muted-foreground" />
                                                    <div className="flex flex-wrap gap-1">
                                                        {sub.tags.map(tag => {
                                                            const hex = tagColors[tag]
                                                            return (
                                                                <Badge
                                                                    key={tag}
                                                                    variant="outline"
                                                                    className="text-[10px] px-1.5"
                                                                    style={hex ? {
                                                                        backgroundColor: `${hex}20`,
                                                                        color: hex,
                                                                        borderColor: `${hex}50`,
                                                                    } : undefined}
                                                                >{tag}</Badge>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {loadingDetail ? (
                                            <div className="flex justify-center py-6">
                                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                            </div>
                                        ) : journeyDetail ? (
                                            <>
                                                {/* Summary Stats */}
                                                <div className="grid grid-cols-3 gap-3">
                                                    <div className="rounded-lg border border-border p-3 text-center">
                                                        <p className="text-xl font-bold text-foreground">{journeyDetail.summary.total_sent}</p>
                                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Emails Sent</p>
                                                    </div>
                                                    <div className="rounded-lg border border-border p-3 text-center">
                                                        <p className="text-xl font-bold text-emerald-400">{journeyDetail.summary.total_opened}</p>
                                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Opened</p>
                                                    </div>
                                                    <div className="rounded-lg border border-border p-3 text-center">
                                                        <p className="text-xl font-bold text-amber-400">{journeyDetail.summary.total_clicked}</p>
                                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Clicked</p>
                                                    </div>
                                                </div>

                                                {/* Active Chain Enrollments */}
                                                {journeyDetail.chains.length > 0 && (
                                                    <div className="space-y-2">
                                                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                                            <GitBranch className="h-3 w-3" /> Chain Enrollments
                                                        </p>
                                                        <div className="space-y-1.5">
                                                            {journeyDetail.chains.map(ch => (
                                                                <div key={ch.id} className="rounded-md border border-border p-2.5">
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="flex items-center gap-2">
                                                                            {chainStatusIcon[ch.status] || chainStatusIcon.active}
                                                                            <span className="text-sm font-medium">{ch.chain_name}</span>
                                                                            <Badge variant="outline" className="text-[10px] capitalize">{ch.status}</Badge>
                                                                        </div>
                                                                        <span className="text-xs text-muted-foreground">
                                                                            Step {ch.current_step_index}/{ch.total_steps}
                                                                        </span>
                                                                    </div>
                                                                    {/* Pause / Resume / Cancel controls */}
                                                                    {(ch.status === "active" || ch.status === "paused") && (
                                                                        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/50">
                                                                            {ch.status === "active" ? (
                                                                                <Button
                                                                                    variant="ghost"
                                                                                    size="sm"
                                                                                    className="h-7 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                                                                                    onClick={async () => {
                                                                                        await updateProcessStatus(ch.id, "paused")
                                                                                        const detail = await getSubscriberJourneyDetail(expandedId!)
                                                                                        setJourneyDetail(detail)
                                                                                        toast({ title: "Chain paused", description: `"${ch.chain_name}" has been paused.` })
                                                                                    }}
                                                                                >
                                                                                    <Pause className="h-3 w-3 mr-1" /> Pause
                                                                                </Button>
                                                                            ) : (
                                                                                <Button
                                                                                    variant="ghost"
                                                                                    size="sm"
                                                                                    className="h-7 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                                                                                    onClick={async () => {
                                                                                        await updateProcessStatus(ch.id, "active")
                                                                                        const detail = await getSubscriberJourneyDetail(expandedId!)
                                                                                        setJourneyDetail(detail)
                                                                                        toast({ title: "Chain resumed", description: `"${ch.chain_name}" has been resumed.` })
                                                                                    }}
                                                                                >
                                                                                    <PlayCircle className="h-3 w-3 mr-1" /> Resume
                                                                                </Button>
                                                                            )}
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="sm"
                                                                                className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                                                                onClick={async () => {
                                                                                    await updateProcessStatus(ch.id, "cancelled")
                                                                                    const detail = await getSubscriberJourneyDetail(expandedId!)
                                                                                    setJourneyDetail(detail)
                                                                                    fetchSubscribers()
                                                                                    toast({ title: "Chain cancelled", description: `"${ch.chain_name}" has been cancelled.` })
                                                                                }}
                                                                            >
                                                                                <XCircle className="h-3 w-3 mr-1" /> Cancel
                                                                            </Button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Email History Timeline */}
                                                <div className="space-y-2">
                                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                                        <Mail className="h-3 w-3" /> Email History
                                                    </p>
                                                    {journeyDetail.campaigns.length === 0 ? (
                                                        <p className="text-sm text-muted-foreground py-3 text-center">No emails sent yet.</p>
                                                    ) : (
                                                        <div className="ml-2 border-l-2 border-muted pl-4 space-y-3 max-h-[420px] overflow-y-auto pr-1">
                                                            {journeyDetail.campaigns.map(campaign => (
                                                                <div key={campaign.campaign_id + campaign.sent_at} className="relative">
                                                                    <div className={`absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full border-2 ${campaign.was_clicked
                                                                        ? "border-amber-500 bg-amber-500/30"
                                                                        : campaign.was_opened
                                                                            ? "border-emerald-500 bg-emerald-500/30"
                                                                            : "border-muted bg-background"
                                                                        }`} />
                                                                    <div className="space-y-1">
                                                                        <div className="flex items-start justify-between gap-2">
                                                                            <span className="text-sm font-medium text-foreground leading-tight">
                                                                                {campaign.campaign_name}
                                                                            </span>
                                                                            <div className="flex items-center gap-1 flex-shrink-0">
                                                                                {campaign.was_opened && (
                                                                                    <span title="Opened"><Eye className="h-3.5 w-3.5 text-emerald-400" /></span>
                                                                                )}
                                                                                {campaign.was_clicked && (
                                                                                    <span title="Clicked"><MousePointer2 className="h-3.5 w-3.5 text-amber-400" /></span>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        {campaign.subject_line && campaign.subject_line !== campaign.campaign_name && (
                                                                            <p className="text-[11px] text-muted-foreground/70 italic">{campaign.subject_line}</p>
                                                                        )}
                                                                        <p className="text-[10px] text-muted-foreground">
                                                                            {new Date(campaign.sent_at).toLocaleDateString("en-US", {
                                                                                month: "short", day: "numeric", year: "numeric",
                                                                                hour: "numeric", minute: "2-digit",
                                                                            })}
                                                                        </p>
                                                                        {campaign.clicked_urls.length > 0 && (
                                                                            <div className="space-y-0.5 mt-1">
                                                                                {campaign.clicked_urls.map((url, i) => {
                                                                                    let display = url
                                                                                    try {
                                                                                        const u = new URL(url)
                                                                                        display = u.hostname + u.pathname
                                                                                    } catch { }
                                                                                    return (
                                                                                        <div key={i} className="flex items-center gap-1 text-[10px] text-amber-400/70">
                                                                                            <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                                                                                            <span className="truncate">{display}</span>
                                                                                        </div>
                                                                                    )
                                                                                })}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Actions */}
                                                <div className="space-y-2 pt-2 border-t border-border">
                                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</p>
                                                    <div className="flex gap-2">
                                                        <Button
                                                            variant="default"
                                                            className="justify-start"
                                                            onClick={() => {
                                                                const name = sub.first_name || sub.last_name
                                                                    ? `${sub.first_name || ""} ${sub.last_name || ""}`.trim()
                                                                    : sub.email
                                                                onStartNewChain?.(sub.id, name)
                                                            }}
                                                        >
                                                            <GitBranch className="h-4 w-4 mr-2" />
                                                            Start New Chain
                                                        </Button>
                                                        <Button variant="outline" className="justify-start" onClick={openChainPicker}>
                                                            <MailPlus className="h-4 w-4 mr-2" />
                                                            Start Existing Chain
                                                        </Button>
                                                    </div>
                                                </div>

                                                {/* Chain Picker */}
                                                {chainPickerOpen && (
                                                    <div className="space-y-3 rounded-lg border border-border p-3 bg-muted/30">
                                                        {loadingPicker ? (
                                                            <div className="flex justify-center py-4">
                                                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                                            </div>
                                                        ) : (
                                                            <>
                                                                {/* Draft Chains for this subscriber */}
                                                                {subscriberDrafts.length > 0 && (
                                                                    <div className="space-y-1.5">
                                                                        <p className="text-xs font-medium text-[#D4AF37]">Draft Chains for {sub.first_name || sub.email}:</p>
                                                                        {subscriberDrafts.map(chain => (
                                                                            <button
                                                                                key={chain.id}
                                                                                onClick={() => setSelectedChain(chain)}
                                                                                className={`w-full text-left rounded-md border p-2.5 transition-colors ${selectedChain?.id === chain.id
                                                                                    ? "border-[#D4AF37] bg-[#D4AF37]/15 ring-1 ring-[#D4AF37]/30"
                                                                                    : "border-[#D4AF37]/30 bg-[#D4AF37]/5 hover:bg-[#D4AF37]/10"
                                                                                    }`}
                                                                            >
                                                                                <div className="flex items-center justify-between">
                                                                                    <div>
                                                                                        <span className="text-sm font-medium">{chain.name}</span>
                                                                                        <p className="text-[10px] text-muted-foreground">
                                                                                            {chain.chain_steps.length} steps · Draft
                                                                                        </p>
                                                                                    </div>
                                                                                    {selectedChain?.id === chain.id
                                                                                        ? <CheckCircle2 className="h-4 w-4 text-[#D4AF37]" />
                                                                                        : <PlayCircle className="h-4 w-4 text-[#D4AF37]/50" />
                                                                                    }
                                                                                </div>
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                )}

                                                                {/* Master Chains */}
                                                                {masterChains.length > 0 && (
                                                                    <div className="space-y-1.5">
                                                                        <p className="text-xs font-medium text-muted-foreground">Master Chains:</p>
                                                                        {masterChains.map(chain => (
                                                                            <button
                                                                                key={chain.id}
                                                                                onClick={() => setSelectedChain(chain)}
                                                                                className={`w-full text-left rounded-md border p-2.5 transition-colors ${selectedChain?.id === chain.id
                                                                                    ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30"
                                                                                    : "border-border hover:bg-muted"
                                                                                    }`}
                                                                            >
                                                                                <div className="flex items-center justify-between">
                                                                                    <div>
                                                                                        <span className="text-sm font-medium">{chain.name}</span>
                                                                                        <p className="text-[10px] text-muted-foreground">
                                                                                            {chain.chain_steps.length} steps
                                                                                            {chain.chain_branches.length > 0 && ` + ${chain.chain_branches.length} branches`}
                                                                                        </p>
                                                                                    </div>
                                                                                    {selectedChain?.id === chain.id
                                                                                        ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                                                                        : <PlayCircle className="h-4 w-4 text-emerald-400/50" />
                                                                                    }
                                                                                </div>
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                )}

                                                                {subscriberDrafts.length === 0 && masterChains.length === 0 && (
                                                                    <p className="text-sm text-muted-foreground text-center py-2">No chains available.</p>
                                                                )}
                                                            </>
                                                        )}
                                                        <div className="flex gap-2 pt-1">
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => { setChainPickerOpen(false); setSelectedChain(null) }}
                                                                className="flex-1"
                                                            >
                                                                Cancel
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                disabled={!selectedChain || startingChain}
                                                                onClick={() => setConfirmOpen(true)}
                                                                className="flex-1"
                                                            >
                                                                {startingChain ? (
                                                                    <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Starting...</>
                                                                ) : (
                                                                    <><PlayCircle className="h-3.5 w-3.5 mr-1" /> Start Selected Chain</>
                                                                )}
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Confirmation Dialog */}
                                                <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle className="flex items-center gap-2">
                                                                <AlertTriangle className="h-5 w-5 text-amber-400" />
                                                                Start Chain?
                                                            </AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                You are about to start <span className="font-semibold text-foreground">&quot;{selectedChain?.name}&quot;</span> for <span className="font-semibold text-foreground">{sub.first_name || sub.email}</span>.
                                                                <br /><br />
                                                                The first step will be executed immediately.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                            <AlertDialogAction
                                                                onClick={() => {
                                                                    if (selectedChain) handleStartChain(selectedChain)
                                                                }}
                                                            >
                                                                Yes, Start Now
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </>
                                        ) : null}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
