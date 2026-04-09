"use client"

import { useState, useMemo } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, Star, ChevronDown, ChevronRight, LayoutGrid, List, ArrowUpDown, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { Campaign, Subscriber } from "@/lib/types"
import { toggleCampaignStarred } from "@/app/actions/campaigns"

type SortMode = "default" | "a-z" | "newest"

interface SendCampaignModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    campaigns: Campaign[]
    loading: boolean
    bulkSendMode: boolean
    selectedIds: string[]
    targetSubscriber: Subscriber | null
    recentlyUsedIds: string[]
    onSelectCampaign: (campaign: Campaign) => void
    duplicating: boolean
    onBulkSendModeChange?: (mode: boolean) => void
}

function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function SendCampaignModal({
    open,
    onOpenChange,
    campaigns,
    loading,
    bulkSendMode,
    selectedIds,
    targetSubscriber,
    recentlyUsedIds,
    onSelectCampaign,
    duplicating,
    onBulkSendModeChange,
}: SendCampaignModalProps) {
    const [viewMode, setViewMode] = useState<"list" | "grid">("list")
    const [sortMode, setSortMode] = useState<SortMode>("default")
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
    const [togglingStarId, setTogglingStarId] = useState<string | null>(null)

    const recentlyUsedSet = useMemo(() => new Set(recentlyUsedIds), [recentlyUsedIds])

    const toggleSection = (key: string) => {
        setCollapsedSections(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    const handleToggleStar = async (e: React.MouseEvent, campaignId: string, currentStarred: boolean) => {
        e.stopPropagation()
        setTogglingStarId(campaignId)
        await toggleCampaignStarred(campaignId, !currentStarred)
        // Optimistically update in-place
        const camp = campaigns.find(c => c.id === campaignId)
        if (camp) camp.is_starred_template = !currentStarred
        setTogglingStarId(null)
    }

    const sortCampaigns = (list: Campaign[]): Campaign[] => {
        switch (sortMode) {
            case "a-z":
                return [...list].sort((a, b) => (a.name || "").localeCompare(b.name || ""))
            case "newest":
                return [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            default:
                // Default: ready first, then alphabetical
                return [...list].sort((a, b) => {
                    if (a.is_ready !== b.is_ready) return (b.is_ready ? 1 : 0) - (a.is_ready ? 1 : 0)
                    return (a.name || "").localeCompare(b.name || "")
                })
        }
    }

    // Build grouped sections
    const sections = useMemo(() => {
        const result: { key: string; label: string; icon?: React.ReactNode; campaigns: Campaign[]; color?: string }[] = []

        // 1. Starred / Favorites
        const starred = campaigns.filter(c => c.is_starred_template)
        if (starred.length > 0) {
            result.push({
                key: "★ Favorites",
                label: "★ Favorites",
                campaigns: sortCampaigns(starred),
                color: "text-amber-400",
            })
        }

        // 2. Recently Used
        const recentCampaigns = campaigns.filter(c => recentlyUsedSet.has(c.id) && !c.is_starred_template)
        if (recentCampaigns.length > 0) {
            result.push({
                key: "Recently Used",
                label: "Recently Used",
                icon: <Clock className="h-3.5 w-3.5" />,
                campaigns: sortCampaigns(recentCampaigns),
                color: "text-sky-400",
            })
        }

        // 3. Category groups
        const categorized = campaigns.filter(c => c.category && !c.is_starred_template)
        const categoryMap: Record<string, Campaign[]> = {}
        categorized.forEach(c => {
            const cat = c.category!
            if (!categoryMap[cat]) categoryMap[cat] = []
            categoryMap[cat].push(c)
        })
        // Sort category names alphabetically
        const sortedCategories = Object.keys(categoryMap).sort()
        sortedCategories.forEach(cat => {
            result.push({
                key: `cat:${cat}`,
                label: cat,
                campaigns: sortCampaigns(categoryMap[cat]),
            })
        })

        // 4. Uncategorized
        const uncategorized = campaigns.filter(c => !c.category && !c.is_starred_template)
        // Remove recently used from uncategorized to avoid duplication
        const uncategorizedFiltered = uncategorized.filter(c => !recentlyUsedSet.has(c.id))
        if (uncategorizedFiltered.length > 0) {
            result.push({
                key: "Uncategorized",
                label: "Uncategorized",
                campaigns: sortCampaigns(uncategorizedFiltered),
                color: "text-muted-foreground",
            })
        }

        return result
    }, [campaigns, recentlyUsedSet, sortMode])

    // For flat sort modes (A-Z, Newest), show a flat list instead of groups
    const showFlat = sortMode !== "default"
    const flatCampaigns = useMemo(() => {
        if (!showFlat) return []
        return sortCampaigns(campaigns)
    }, [campaigns, sortMode, showFlat])

    const renderCampaignCard = (campaign: Campaign) => {
        const isStarred = campaign.is_starred_template
        const isRecent = recentlyUsedSet.has(campaign.id)

        if (viewMode === "grid") {
            return (
                <div
                    key={campaign.id}
                    onClick={() => !duplicating && onSelectCampaign(campaign)}
                    className={cn(
                        "p-3 rounded-lg border border-border cursor-pointer hover:bg-accent transition-all hover:scale-[1.02]",
                        duplicating && "opacity-50 pointer-events-none"
                    )}
                >
                    <div className="flex items-start justify-between gap-1">
                        <h4 className="font-medium text-xs text-foreground line-clamp-2 break-words flex-1">{campaign.name}</h4>
                        <button
                            onClick={(e) => handleToggleStar(e, campaign.id, !!isStarred)}
                            disabled={togglingStarId === campaign.id}
                            className={cn(
                                "shrink-0 p-0.5 rounded transition-colors",
                                isStarred
                                    ? "text-amber-400 hover:text-amber-300"
                                    : "text-muted-foreground/30 hover:text-amber-400"
                            )}
                        >
                            <Star className={cn("h-3 w-3", isStarred && "fill-current")} />
                        </button>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                        {campaign.is_ready && (
                            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="Ready" />
                        )}
                        {!campaign.is_ready && (
                            <span className="inline-block w-2 h-2 rounded-full bg-zinc-500 shrink-0" title="Not ready" />
                        )}
                        <span className="text-[10px] text-muted-foreground truncate">{formatDate(campaign.created_at)}</span>
                        {isRecent && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0 bg-sky-500/10 text-sky-400 border-sky-500/30">
                                recent
                            </Badge>
                        )}
                    </div>
                </div>
            )
        }

        // List view
        return (
            <div
                key={campaign.id}
                onClick={() => !duplicating && onSelectCampaign(campaign)}
                className={cn(
                    "p-3 rounded-lg border border-border cursor-pointer hover:bg-accent transition-colors",
                    duplicating && "opacity-50 pointer-events-none"
                )}
            >
                <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0 flex-1">
                        <h4 className="font-medium text-sm text-foreground line-clamp-2 break-words">{campaign.name}</h4>
                        {campaign.subject_line && (
                            <p className="text-xs text-muted-foreground/70 italic line-clamp-1">{campaign.subject_line}</p>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                            <Badge
                                variant="outline"
                                className="text-xs shrink-0 bg-amber-500/10 text-amber-400 border-amber-500/30"
                            >
                                template
                            </Badge>
                            {campaign.is_ready && (
                                <Badge
                                    variant="outline"
                                    className="text-xs shrink-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                >
                                    ready
                                </Badge>
                            )}
                            {isRecent && (
                                <Badge
                                    variant="outline"
                                    className="text-xs shrink-0 bg-sky-500/10 text-sky-400 border-sky-500/30"
                                >
                                    recently used
                                </Badge>
                            )}
                            {campaign.category && (
                                <Badge
                                    variant="outline"
                                    className="text-xs shrink-0 bg-violet-500/10 text-violet-400 border-violet-500/30"
                                >
                                    {campaign.category}
                                </Badge>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={(e) => handleToggleStar(e, campaign.id, !!isStarred)}
                        disabled={togglingStarId === campaign.id}
                        className={cn(
                            "shrink-0 p-1 rounded transition-colors mt-0.5",
                            isStarred
                                ? "text-amber-400 hover:text-amber-300"
                                : "text-muted-foreground/30 hover:text-amber-400"
                        )}
                    >
                        <Star className={cn("h-4 w-4", isStarred && "fill-current")} />
                    </button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                    Created: {formatDate(campaign.created_at)}
                </p>
            </div>
        )
    }

    return (
        <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o && onBulkSendModeChange) onBulkSendModeChange(false) }}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{bulkSendMode ? 'Bulk Send Template' : 'Send Existing Campaign'}</DialogTitle>
                    <DialogDescription>
                        {bulkSendMode
                            ? `Select a template to send to ${selectedIds.length} selected subscriber${selectedIds.length !== 1 ? 's' : ''}.`
                            : `Select a campaign to duplicate and send to ${targetSubscriber?.email}.`
                        }
                    </DialogDescription>
                </DialogHeader>

                {/* Toolbar: Sort + View Toggle */}
                {!loading && campaigns.length > 0 && (
                    <div className="flex items-center justify-between gap-2 pt-1 pb-2 border-b border-border">
                        {/* Sort */}
                        <div className="flex items-center gap-1.5">
                            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                            {(["default", "a-z", "newest"] as SortMode[]).map(mode => (
                                <button
                                    key={mode}
                                    onClick={() => setSortMode(mode)}
                                    className={cn(
                                        "text-xs px-2 py-1 rounded-md transition-colors",
                                        sortMode === mode
                                            ? "bg-amber-500/15 text-amber-400 font-medium"
                                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                    )}
                                >
                                    {mode === "default" ? "Grouped" : mode === "a-z" ? "A → Z" : "Newest"}
                                </button>
                            ))}
                        </div>

                        {/* View toggle */}
                        <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
                            <button
                                onClick={() => setViewMode("list")}
                                className={cn(
                                    "p-1.5 rounded transition-colors",
                                    viewMode === "list"
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                                title="List view"
                            >
                                <List className="h-3.5 w-3.5" />
                            </button>
                            <button
                                onClick={() => setViewMode("grid")}
                                className={cn(
                                    "p-1.5 rounded transition-colors",
                                    viewMode === "grid"
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                                title="Grid view"
                            >
                                <LayoutGrid className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                )}

                <div className="py-1">
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : campaigns.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">No campaigns found.</p>
                    ) : (
                        <ScrollArea className="h-[400px] pr-4">
                            {showFlat ? (
                                // Flat sorted view
                                <div className={cn(
                                    viewMode === "grid"
                                        ? "grid grid-cols-2 gap-2"
                                        : "space-y-2"
                                )}>
                                    {flatCampaigns.map(campaign => renderCampaignCard(campaign))}
                                </div>
                            ) : (
                                // Grouped view
                                <div className="space-y-4">
                                    {sections.map(section => {
                                        const isCollapsed = collapsedSections.has(section.key)
                                        return (
                                            <div key={section.key}>
                                                {/* Section Header */}
                                                <button
                                                    onClick={() => toggleSection(section.key)}
                                                    className="flex items-center gap-2 w-full text-left px-1 py-1.5 rounded-md hover:bg-muted/50 transition-colors group"
                                                >
                                                    {isCollapsed ? (
                                                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                                    ) : (
                                                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                                    )}
                                                    {section.icon}
                                                    <span className={cn(
                                                        "text-xs font-semibold uppercase tracking-wider",
                                                        section.color || "text-foreground"
                                                    )}>
                                                        {section.label}
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground/60 ml-auto">
                                                        {section.campaigns.length}
                                                    </span>
                                                </button>

                                                {/* Section Content */}
                                                {!isCollapsed && (
                                                    <div className={cn(
                                                        "mt-1.5",
                                                        viewMode === "grid"
                                                            ? "grid grid-cols-2 gap-2"
                                                            : "space-y-2"
                                                    )}>
                                                        {section.campaigns.map(campaign => renderCampaignCard(campaign))}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </ScrollArea>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
