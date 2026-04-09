"use client"

import { useEffect, useState, useTransition, useCallback, useMemo } from "react"
import { Flame, Clock, Target, ArrowRight, Loader2, Sparkles, MessageCircle, RefreshCw, Settings2, Send, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Mail, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { formatDistanceToNow } from "date-fns"
import { useRouter, useParams } from "next/navigation"
import { getCRMLeads } from "@/app/actions/crm"
import { type CRMLead, type CRMScoringConfig, DEFAULT_CRM_CONFIG } from "@/lib/crm-types"
import { CRMConfigPanel, getActiveConfig } from "@/components/crm/crm-config-panel"
import { SendCampaignModal } from "@/components/audience/send-campaign-modal"
import { getCampaignList, getRecentlyUsedTemplateIds, duplicateCampaignForSubscriber, createBulkCampaign } from "@/app/actions/campaigns"
import { type Campaign, type Subscriber } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { SubscriberHistoryTimeline } from "@/components/audience/subscriber-history-timeline"

type Tab = "leads" | "config"
const CRM_CACHE_KEY = "dp_crm_leads_cache"

function getCacheKey(config: CRMScoringConfig): string {
    // Simple hash based on config values that affect results
    return `${config.min_score}_${config.max_score}_${config.event_lookback_days}_${config.exclude_tags.join(",")}`
}

function getCachedLeads(config: CRMScoringConfig): CRMLead[] | null {
    try {
        const raw = sessionStorage.getItem(CRM_CACHE_KEY)
        if (!raw) return null
        const cached = JSON.parse(raw)
        if (cached.key === getCacheKey(config)) return cached.leads
        return null
    } catch { return null }
}

function setCachedLeads(config: CRMScoringConfig, leads: CRMLead[]) {
    try {
        sessionStorage.setItem(CRM_CACHE_KEY, JSON.stringify({
            key: getCacheKey(config),
            leads,
        }))
    } catch { /* ignore quota errors */ }
}

export default function CRMPage() {
    const { workspace } = useParams<{ workspace: string }>()
    const [leads, setLeads] = useState<CRMLead[]>([])
    const [loading, setLoading] = useState(true)
    const [isPending, startTransition] = useTransition()
    const [activeTab, setActiveTab] = useState<Tab>("leads")
    const [activeConfig, setActiveConfig] = useState<CRMScoringConfig>(DEFAULT_CRM_CONFIG)
    const router = useRouter()
    const { toast } = useToast()

    // Send Campaign Modal state
    const [isSelectCampaignOpen, setIsSelectCampaignOpen] = useState(false)
    const [targetSubscriber, setTargetSubscriber] = useState<Subscriber | null>(null)
    const [existingCampaigns, setExistingCampaigns] = useState<Campaign[]>([])
    const [loadingCampaigns, setLoadingCampaigns] = useState(false)
    const [duplicating, setDuplicating] = useState(false)
    const [recentlyUsedIds, setRecentlyUsedIds] = useState<string[]>([])

    // Checkbox selection + Bulk Send
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [bulkSendMode, setBulkSendMode] = useState(false)

    // Expandable history
    const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null)

    // Pagination
    const PAGE_SIZE = 25
    const [currentPage, setCurrentPage] = useState(1)
    const totalPages = Math.max(1, Math.ceil(leads.length / PAGE_SIZE))
    const paginatedLeads = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE
        return leads.slice(start, start + PAGE_SIZE)
    }, [leads, currentPage])

    const fetchLeads = useCallback(async (config?: CRMScoringConfig, skipCache = false) => {
        const cfg = config || activeConfig

        // Check sessionStorage cache first (instant restore on back-nav)
        if (!skipCache) {
            const cached = getCachedLeads(cfg)
            if (cached) {
                setLeads(cached)
                setLoading(false)
                return
            }
        }

        setLoading(true)
        const data = await getCRMLeads(cfg)
        setLeads(data)
        setCachedLeads(cfg, data)
        setLoading(false)
    }, [activeConfig])

    useEffect(() => {
        // Load saved config from localStorage
        const saved = getActiveConfig()
        setActiveConfig(saved)
        fetchLeads(saved)
    }, [])

    const handleRefresh = () => {
        startTransition(() => { fetchLeads(undefined, true) })
    }

    const handleConfigChange = (newConfig: CRMScoringConfig) => {
        setActiveConfig(newConfig)
        setActiveTab("leads")
        fetchLeads(newConfig, true) // always refetch on config change
    }

    // --- Checkbox Selection ---
    const handleSelectAll = () => {
        const pageIds = paginatedLeads.map((l) => l.id)
        const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.includes(id))
        if (allPageSelected) {
            setSelectedIds(prev => prev.filter(id => !pageIds.includes(id)))
        } else {
            setSelectedIds(prev => {
                const combined = new Set([...prev, ...pageIds])
                return Array.from(combined)
            })
        }
    }

    const handleSelectOne = (id: string) => {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]))
    }

    const allSelected = paginatedLeads.length > 0 && paginatedLeads.every(l => selectedIds.includes(l.id))
    const someSelected = selectedIds.length > 0 && !allSelected

    // --- Bulk Send Campaign ---
    const handleOpenBulkSend = async () => {
        setBulkSendMode(true)
        setTargetSubscriber(null)
        setIsSelectCampaignOpen(true)
        setLoadingCampaigns(true)

        try {
            const [campaigns, recentIds] = await Promise.all([
                getCampaignList(workspace),
                getRecentlyUsedTemplateIds(workspace),
            ])
            setExistingCampaigns((campaigns as Campaign[]).filter(c => c.is_template === true))
            setRecentlyUsedIds(recentIds)
        } catch (error) {
            console.error("Failed to load campaigns", error)
            toast({ title: "Error loading campaigns", variant: "destructive" })
        } finally {
            setLoadingCampaigns(false)
        }
    }

    // --- Send Existing Campaign ---
    const handleOpenSelectCampaign = async (lead: CRMLead) => {
        // Convert CRMLead to a minimal Subscriber shape for the modal
        setTargetSubscriber({
            id: lead.id,
            email: lead.email,
            first_name: lead.first_name || "",
            last_name: lead.last_name || "",
            country: "", country_code: "", phone_code: "", phone_number: "",
            shipping_address1: "", shipping_address2: "", shipping_city: "",
            shipping_zip: "", shipping_province: "",
            tags: lead.tags || null,
            status: "active",
            created_at: "",
        } as Subscriber)
        setBulkSendMode(false)
        setIsSelectCampaignOpen(true)
        setLoadingCampaigns(true)

        try {
            const [campaigns, recentIds] = await Promise.all([
                getCampaignList(workspace),
                getRecentlyUsedTemplateIds(workspace),
            ])
            setExistingCampaigns((campaigns as Campaign[]).filter(c => c.is_template === true))
            setRecentlyUsedIds(recentIds)
        } catch (error) {
            console.error("Failed to load campaigns", error)
            toast({ title: "Error loading campaigns", variant: "destructive" })
        } finally {
            setLoadingCampaigns(false)
        }
    }

    const handleSelectCampaign = async (campaign: Campaign) => {
        // Bulk send mode — create campaign locked to selected leads and redirect
        if (bulkSendMode) {
            setDuplicating(true)
            try {
                const result = await createBulkCampaign(campaign.id, selectedIds)

                if (result.error) {
                    throw new Error(result.error)
                }

                toast({
                    title: "Bulk Campaign Created",
                    description: `Created "${campaign.name}" for ${selectedIds.length} leads. Redirecting to manage...`,
                })

                setIsSelectCampaignOpen(false)
                setSelectedIds([])
                setBulkSendMode(false)

                if (result.data?.id) {
                    router.push(`/dashboard/${result.data.id}`)
                }
            } catch (error: any) {
                toast({
                    title: "Error creating bulk campaign",
                    description: error.message,
                    variant: "destructive",
                })
            } finally {
                setDuplicating(false)
            }
            return
        }

        // Individual mode — duplicate for single subscriber
        if (!targetSubscriber) return

        setDuplicating(true)
        try {
            const name = targetSubscriber.first_name
                ? `${targetSubscriber.first_name} ${targetSubscriber.last_name || ''}`.trim()
                : targetSubscriber.email

            const result = await duplicateCampaignForSubscriber(campaign.id, targetSubscriber.id, name)

            if (result.error) {
                throw new Error(result.error)
            }

            toast({
                title: "Campaign Duplicated",
                description: `Created copy of "${campaign.name}" for ${targetSubscriber.email}. Redirecting...`,
            })

            if (result.data?.id) {
                router.push(`/dashboard/${result.data.id}`)
            }
            setIsSelectCampaignOpen(false)
        } catch (error: any) {
            toast({
                title: "Error duplicating campaign",
                description: error.message,
                variant: "destructive",
            })
        } finally {
            setDuplicating(false)
        }
    }

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Target className="text-amber-500" /> Sales CRM
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        {activeTab === "leads"
                            ? leads.length > 0
                                ? `${leads.length} leads matching your scoring config.`
                                : loading ? "Loading..." : "No leads match current config."
                            : "Configure scoring weights, presets, and filters."}
                    </p>
                </div>
                {activeTab === "leads" && (
                    <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isPending || loading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${isPending || loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-border">
                <button
                    onClick={() => setActiveTab("leads")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "leads"
                        ? "border-amber-500 text-amber-500"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                >
                    <Target className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
                    Leads
                    {leads.length > 0 && (
                        <span className="ml-2 text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">
                            {leads.length}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => setActiveTab("config")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "config"
                        ? "border-amber-500 text-amber-500"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                >
                    <Settings2 className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
                    Config
                </button>
            </div>

            {/* Config Tab */}
            {activeTab === "config" && (
                <CRMConfigPanel onConfigChange={handleConfigChange} />
            )}

            {/* Leads Tab */}
            {activeTab === "leads" && (
                <>
                    {/* Score Legend + Select All */}
                    <div className="flex items-center gap-6 text-xs text-muted-foreground bg-muted/30 rounded-lg px-4 py-2.5 border border-border">
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                                checked={allSelected}
                                ref={(el) => {
                                    if (el) {
                                        const element = el as HTMLButtonElement & { indeterminate: boolean }
                                        element.indeterminate = someSelected
                                    }
                                }}
                                onCheckedChange={handleSelectAll}
                            />
                            <span className="font-medium text-foreground text-xs">Select All</span>
                        </div>
                        <span className="border-l border-border h-4" />
                        <span className="font-medium text-foreground">Score Guide:</span>
                        <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-red-500" /> 50+ Hot
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-amber-500" /> 25-50 Warm
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-zinc-400" /> &lt;25 Interested
                        </span>
                    </div>

                    {/* Selection Action Bar */}
                    {selectedIds.length > 0 && (
                        <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-500/30 bg-card">
                            <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                                <X className="h-3.5 w-3.5 mr-1.5" />
                                Cancel ({selectedIds.length})
                            </Button>
                            <Button variant="secondary" size="sm" onClick={handleOpenBulkSend} className="gap-2">
                                <Mail className="h-4 w-4" />
                                Bulk Send Campaign
                            </Button>
                        </div>
                    )}

                    {/* Loading */}
                    {loading && (
                        <div className="p-10 flex flex-col items-center justify-center min-h-[300px] gap-3">
                            <Loader2 className="animate-spin h-8 w-8 text-amber-500" />
                            <p className="text-sm text-muted-foreground">Scoring leads...</p>
                        </div>
                    )}

                    {/* Lead Cards */}
                    {!loading && (
                        <div className="grid gap-3">
                            {paginatedLeads.map((lead, index) => {
                                const isHot = lead.engagement_score > 50
                                const isWarm = lead.engagement_score > 25
                                const reasonTag = lead.tags?.find((t: string) => t.startsWith("Reason:"))
                                const visitedCheckout = lead.recent_pages?.some(
                                    (p: string) => p.includes("customize") || p.includes("checkout") || p.includes("buy") || p.includes("reserve")
                                )
                                const isExpanded = expandedLeadId === lead.id
                                const globalIndex = (currentPage - 1) * PAGE_SIZE + index

                                return (
                                    <div
                                        key={lead.id}
                                        className={`bg-card border rounded-xl transition-colors ${isHot
                                            ? "border-red-500/30 hover:border-red-500/50"
                                            : isWarm
                                                ? "border-amber-500/20 hover:border-amber-500/40"
                                                : "hover:border-border/80"
                                            }`}
                                    >
                                        <div className="p-5 flex items-center gap-5">
                                            {/* Checkbox */}
                                            <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                                                <Checkbox
                                                    checked={selectedIds.includes(lead.id)}
                                                    onCheckedChange={() => handleSelectOne(lead.id)}
                                                />
                                            </div>

                                            {/* Rank */}
                                            <div className="text-xs text-muted-foreground font-mono w-5 text-center shrink-0">
                                                {globalIndex + 1}
                                            </div>

                                            {/* Score Badge */}
                                            <div
                                                className={`flex flex-col items-center rounded-lg min-w-[72px] p-2.5 border ${isHot
                                                    ? "bg-red-500/10 border-red-500/20"
                                                    : isWarm
                                                        ? "bg-amber-500/10 border-amber-500/20"
                                                        : "bg-muted/50 border-border"
                                                    }`}
                                            >
                                                <Flame
                                                    className={`w-4 h-4 ${isHot ? "text-red-500 animate-pulse" : isWarm ? "text-amber-500" : "text-zinc-400"
                                                        }`}
                                                />
                                                <span className="text-xl font-bold mt-0.5">{lead.engagement_score}</span>
                                            </div>

                                            {/* Lead Info */}
                                            <div className="flex-1 min-w-0">
                                                <h3 className="text-base font-semibold truncate">
                                                    {lead.first_name
                                                        ? `${lead.first_name}${lead.last_name ? ` ${lead.last_name}` : ""}`
                                                        : lead.email}
                                                </h3>
                                                {lead.first_name && (
                                                    <p className="text-xs text-muted-foreground truncate">{lead.email}</p>
                                                )}

                                                {/* Tags */}
                                                <div className="flex flex-wrap gap-1.5 mt-2">
                                                    {lead.tags
                                                        ?.filter((t: string) => !t.startsWith("Reason:"))
                                                        .slice(0, 5)
                                                        .map((tag: string) => (
                                                            <Badge
                                                                key={tag}
                                                                variant="outline"
                                                                className="bg-primary/5 text-primary text-[10px] py-0 px-1.5"
                                                            >
                                                                {tag}
                                                            </Badge>
                                                        ))}
                                                </div>

                                                {/* Objection / Reason tag */}
                                                {reasonTag && (
                                                    <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-500 italic bg-amber-500/10 px-2.5 py-1 rounded w-fit border border-amber-500/20">
                                                        <MessageCircle className="w-3 h-3 shrink-0" />
                                                        <span className="truncate">
                                                            &ldquo;{reasonTag.replace("Reason: ", "")}&rdquo;
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Context */}
                                                <div className="flex items-center gap-3 mt-2">
                                                    {lead.last_seen_at && (
                                                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                                            <Clock className="w-3 h-3" />
                                                            {formatDistanceToNow(new Date(lead.last_seen_at), { addSuffix: true })}
                                                        </div>
                                                    )}
                                                    {visitedCheckout && (
                                                        <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                                            Visited Checkout
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Actions */}
                                            <div className="flex flex-col gap-2 shrink-0">
                                                <Button
                                                    size="sm"
                                                    className="bg-amber-600 hover:bg-amber-500 text-white border-none"
                                                    disabled
                                                    title="Coming soon — connect to JIT email drafting"
                                                >
                                                    <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                                                    AI 1:1 Draft
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleOpenSelectCampaign(lead)}
                                                >
                                                    <Send className="w-3.5 h-3.5 mr-1.5" />
                                                    Send Campaign
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setExpandedLeadId(isExpanded ? null : lead.id)}
                                                >
                                                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5 mr-1.5" /> : <ChevronDown className="w-3.5 h-3.5 mr-1.5" />}
                                                    {isExpanded ? "Hide History" : "View History"}
                                                </Button>
                                            </div>
                                        </div>

                                        {/* Inline History Timeline */}
                                        {isExpanded && (
                                            <div className="border-t border-border/50 px-5 py-4 bg-muted/20">
                                                <SubscriberHistoryTimeline subscriberId={lead.id} />
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {leads.length === 0 && !loading && (
                        <div className="text-center text-muted-foreground py-16 border border-dashed rounded-xl">
                            <Target className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                            <p className="text-sm">No leads match your current scoring config.</p>
                            <p className="text-xs mt-1">Try lowering the minimum score in the Config tab.</p>
                            <Button variant="outline" size="sm" className="mt-4" onClick={() => setActiveTab("config")}>
                                <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                                Open Config
                            </Button>
                        </div>
                    )}

                    {/* Pagination */}
                    {!loading && leads.length > PAGE_SIZE && (
                        <div className="flex items-center justify-between pt-2">
                            <p className="text-xs text-muted-foreground">
                                {leads.length === 0 ? "0" : `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, leads.length)}`} of {leads.length}
                            </p>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={currentPage <= 1}
                                    onClick={() => setCurrentPage(p => p - 1)}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="text-xs text-muted-foreground">Page {currentPage} of {totalPages}</span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={currentPage >= totalPages}
                                    onClick={() => setCurrentPage(p => p + 1)}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Send Campaign Modal */}
            <SendCampaignModal
                open={isSelectCampaignOpen}
                onOpenChange={setIsSelectCampaignOpen}
                campaigns={existingCampaigns}
                loading={loadingCampaigns}
                bulkSendMode={bulkSendMode}
                selectedIds={selectedIds}
                targetSubscriber={targetSubscriber}
                recentlyUsedIds={recentlyUsedIds}
                onSelectCampaign={handleSelectCampaign}
                duplicating={duplicating}
                onBulkSendModeChange={setBulkSendMode}
            />
        </div>
    )
}
