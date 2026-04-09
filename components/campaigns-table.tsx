"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Campaign } from "@/lib/types"
import { formatDistanceToNow } from "date-fns"
import { Pencil, Copy, LayoutTemplate, PenLine, Trash2, Eye, MousePointer2, Clock, ArrowRight, ExternalLink, ShoppingCart, Star, CheckSquare, Mail, CheckCircle2, Send, BookOpen, Download, ChevronDown, ChevronUp, Tag, X, FolderInput, GripVertical } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useDraggable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"

import { createClient } from "@/lib/supabase/client"
import { duplicateCampaign, deleteCampaign, toggleTemplateStatus, toggleReadyStatus, updateCampaignCategory, toggleCampaignStarred } from "@/app/actions/campaigns"
import { moveTemplateToFolder, type TemplateFolder } from "@/app/actions/template-folders"
import { exportToBlog } from "@/app/actions/export-to-blog"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "next/navigation"

const statusStyles: Record<string, string> = {
    active: "bg-green-500/20 text-green-400 border-green-500/30",
    completed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    draft: "bg-muted text-muted-foreground border-border",
}

const formatDuration = (seconds: number) => {
    if (!seconds) return "—"
    if (seconds < 60) return `${seconds}s`
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}m ${s}s`
}

interface ServerPagination {
    totalItems: number
    currentPage: number
    pageSize: number
    onPageChange: (page: number, pageSize: number) => void
}

interface CampaignsTableProps {
    campaigns: Campaign[]
    loading: boolean
    onRefresh?: () => void
    title?: string
    showAnalytics?: boolean
    enableBulkDelete?: boolean
    sortBy?: "created_at" | "updated_at"
    paginate?: boolean
    serverPagination?: ServerPagination
    showFolderActions?: boolean
    folders?: TemplateFolder[]
    isRowDraggable?: boolean
}

export function CampaignsTable({ campaigns = [], loading, onRefresh, title = "Recent Campaigns", showAnalytics = true, enableBulkDelete = false, sortBy = "created_at", paginate = false, serverPagination, showFolderActions = false, folders = [], isRowDraggable = false }: CampaignsTableProps) {
    const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [newName, setNewName] = useState("")
    const [renaming, setRenaming] = useState(false)
    const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
    const [togglingTemplateId, setTogglingTemplateId] = useState<string | null>(null)
    const [togglingReadyId, setTogglingReadyId] = useState<string | null>(null)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [bulkDeleting, setBulkDeleting] = useState(false)
    const [exportingId, setExportingId] = useState<string | null>(null)
    const [downloadingId, setDownloadingId] = useState<string | null>(null)
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
    const [currentPage, setCurrentPage] = useState(0)
    const [pageSize, setPageSize] = useState(25)
    const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
    const [categoryInput, setCategoryInput] = useState("")
    const [togglingStarredId, setTogglingStarredId] = useState<string | null>(null)
    const [movingToFolderId, setMovingToFolderId] = useState<string | null>(null)

    const toggleExpand = (id: string) => {
        setExpandedRows(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const supabase = createClient()
    const { toast } = useToast()
    const router = useRouter()

    const handleEditClick = (campaign: Campaign) => {
        setEditingCampaign(campaign)
        setNewName(campaign.name)
    }

    const handleRename = async () => {
        if (!editingCampaign) return
        setRenaming(true)

        const { error } = await supabase
            .from("campaigns")
            .update({ name: newName })
            .eq("id", editingCampaign.id)

        if (!error) {
            setEditingCampaign(null)
            if (onRefresh) onRefresh()
            router.refresh()
        } else {
            console.error("Error renaming campaign:", error)
            toast({
                title: "Error renaming campaign",
                description: error.message,
                variant: "destructive",
            })
        }
        setRenaming(false)
    }

    const handleDuplicate = async (campaignId: string) => {
        setDuplicatingId(campaignId)
        try {
            const result = await duplicateCampaign(campaignId)

            if (result.error) {
                throw new Error(result.error)
            }

            toast({
                title: "Campaign duplicated",
                description: "A copy of the campaign has been created.",
            })

            if (onRefresh) onRefresh()
            router.refresh() // Refresh server components

        } catch (error: any) {
            console.error("Error duplicating campaign:", error)
            toast({
                title: "Error duplicating campaign",
                description: error.message || "Failed to duplicate",
                variant: "destructive",
            })
        } finally {
            setDuplicatingId(null)
        }
    }
    const handleDelete = async (campaignId: string) => {
        setDeletingId(campaignId)
        try {
            const result = await deleteCampaign(campaignId)

            if (result.error) {
                throw new Error(result.error)
            }

            toast({
                title: "Campaign deleted",
                description: "The campaign has been permanently removed.",
            })

            if (onRefresh) onRefresh()
            router.refresh()

        } catch (error: any) {
            console.error("Error deleting campaign:", error)
            toast({
                title: "Error deleting campaign",
                description: error.message || "Failed to delete",
                variant: "destructive",
            })
        } finally {
            setDeletingId(null)
        }
    }

    const handleExportToBlog = async (campaignId: string) => {
        setExportingId(campaignId)
        try {
            const result = await exportToBlog(campaignId)

            if (result.error) {
                throw new Error(result.error)
            }

            toast({
                title: "Exported to Blog",
                description: `Draft post created. Open it in the Blog editor to convert it into a blog post.`,
            })

            router.refresh()
        } catch (error: any) {
            console.error("Error exporting to blog:", error)
            toast({
                title: "Export failed",
                description: error.message || "Failed to export to blog",
                variant: "destructive",
            })
        } finally {
            setExportingId(null)
        }
    }

    const handleDownloadHtml = async (campaign: Campaign) => {
        setDownloadingId(campaign.id)
        try {
            // Fetch html_content on-demand since the list query may not include it
            const { data, error: fetchError } = await supabase
                .from("campaigns")
                .select("html_content")
                .eq("id", campaign.id)
                .single()

            if (fetchError || !data) {
                throw new Error("Failed to fetch campaign HTML")
            }

            const html = data.html_content
            if (!html) {
                throw new Error("No HTML content found for this campaign")
            }
            const blob = new Blob([html], { type: "text/html" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `${(campaign.name || "campaign").replace(/[^a-zA-Z0-9-_ ]/g, "")}.html`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
            toast({
                title: "Downloaded",
                description: `HTML file saved as ${a.download}`,
            })
        } catch (error: any) {
            console.error("Error downloading HTML:", error)
            toast({
                title: "Download failed",
                description: error.message || "Failed to download HTML",
                variant: "destructive",
            })
        } finally {
            setDownloadingId(null)
        }
    }

    const allSelected = campaigns.length > 0 && selectedIds.size === campaigns.length
    const someSelected = selectedIds.size > 0 && selectedIds.size < campaigns.length

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const toggleAll = () => {
        if (allSelected) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(campaigns.map(c => c.id)))
        }
    }

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return
        const confirmed = window.confirm(`Delete ${selectedIds.size} campaign${selectedIds.size > 1 ? 's' : ''}? This cannot be undone.`)
        if (!confirmed) return

        setBulkDeleting(true)
        let deleted = 0
        for (const id of selectedIds) {
            const result = await deleteCampaign(id)
            if (!result.error) deleted++
        }
        setBulkDeleting(false)
        setSelectedIds(new Set())
        toast({
            title: `Deleted ${deleted} campaign${deleted > 1 ? 's' : ''}`,
            description: `${deleted} of ${selectedIds.size} campaigns removed.`,
        })
        router.refresh()
    }

    if (loading) {
        return <div className="text-center py-10 text-muted-foreground opacity-50">Loading metrics...</div>
    }

    const colSpan = (showAnalytics ? 9 : 3) + (enableBulkDelete ? 1 : 0) + (isRowDraggable ? 1 : 0)

    return (
        <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-6 py-4 flex justify-between items-center">
                <h2 className="text-lg font-semibold text-card-foreground">{title}</h2>
                {enableBulkDelete && selectedIds.size > 0 && (
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleBulkDelete}
                        disabled={bulkDeleting}
                        className="gap-2"
                    >
                        <Trash2 className="w-4 h-4" />
                        {bulkDeleting ? 'Deleting...' : `Delete ${selectedIds.size} Selected`}
                    </Button>
                )}
            </div>
            <Table>
                <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                        {enableBulkDelete && (
                            <TableHead className="w-[40px] px-3">
                                <Checkbox
                                    checked={allSelected}
                                    onCheckedChange={toggleAll}
                                    className="border-muted-foreground/50"
                                />
                            </TableHead>
                        )}
                        {isRowDraggable && <TableHead className="w-[40px] px-3"></TableHead>}
                        <TableHead className="text-muted-foreground w-[300px]">Campaign</TableHead>
                        <TableHead className="text-center w-[100px]">Status</TableHead>
                        {/* New Metrics Columns */}
                        {showAnalytics && (
                            <>
                                <TableHead className="text-center w-[120px]">
                                    <div className="flex items-center justify-center gap-1">
                                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                                        From
                                    </div>
                                </TableHead>
                                <TableHead className="w-[160px]">
                                    <div className="flex items-center gap-1">
                                        <Send className="h-3.5 w-3.5 text-muted-foreground" />
                                        Sent To
                                    </div>
                                </TableHead>
                                <TableHead className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                                        Open Rate
                                    </div>
                                </TableHead>
                                <TableHead className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        <MousePointer2 className="h-3.5 w-3.5 text-muted-foreground" />
                                        Click Rate
                                    </div>
                                </TableHead>
                                <TableHead className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        <ShoppingCart className="h-3.5 w-3.5 text-emerald-500" />
                                        Checkouts
                                    </div>
                                </TableHead>
                                <TableHead className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                                        Avg Time
                                    </div>
                                </TableHead>
                                <TableHead className="text-right w-[100px]">
                                    <div className="flex items-center justify-end gap-1">
                                        <Send className="h-3.5 w-3.5 text-muted-foreground" />
                                        Sent At
                                    </div>
                                </TableHead>
                            </>
                        )}
                        <TableHead className="text-right w-[50px]"></TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {campaigns.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={colSpan} className="text-center py-8 text-muted-foreground">
                                No campaigns found. Create one to get started.
                            </TableCell>
                        </TableRow>
                    ) : (
                        (() => {
                            const sorted = [...campaigns].sort((a, b) => {
                                if (sortBy === "updated_at") {
                                    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
                                }
                                return (b.is_ready ? 1 : 0) - (a.is_ready ? 1 : 0)
                            })
                            // If server pagination, all items are already the right page — don't slice client-side
                            const displayed = serverPagination ? sorted : (paginate ? sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize) : sorted)
                            return displayed
                        })().map((campaign) => {
                            const recipients = campaign.total_recipients || 0
                            const openRate = recipients > 0 ? Math.round((campaign.total_opens / recipients) * 100) : 0
                            const clickRate = recipients > 0 ? Math.round((campaign.total_clicks / recipients) * 100) : 0
                            const conversions = campaign.total_conversions || 0
                            const checkoutRate = campaign.total_clicks > 0 ? Math.round((conversions / campaign.total_clicks) * 100) : 0
                            const hasBreakdown = campaign.recipient_breakdown && campaign.recipient_breakdown.length > 1
                            const isExpanded = expandedRows.has(campaign.id)
                            const colCount = (showAnalytics ? 9 : 3) + (enableBulkDelete ? 1 : 0)

                            return (
                                <>
                                    <DraggableRow
                                        key={campaign.id}
                                        campaign={campaign}
                                        isRowDraggable={isRowDraggable}
                                        className={`border-border ${selectedIds.has(campaign.id) ? 'bg-primary/5' : ''} ${hasBreakdown ? 'cursor-pointer' : ''}`}
                                        onClick={hasBreakdown ? () => toggleExpand(campaign.id) : undefined}
                                    >
                                        {enableBulkDelete && (
                                            <TableCell className="px-3" onClick={(e) => e.stopPropagation()}>
                                                <Checkbox
                                                    checked={selectedIds.has(campaign.id)}
                                                    onCheckedChange={() => toggleSelect(campaign.id)}
                                                    className="border-muted-foreground/50"
                                                />
                                            </TableCell>
                                        )}
                                        {/* Name & Metadata */}
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                {hasBreakdown && (
                                                    <button className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0" onClick={(e) => { e.stopPropagation(); toggleExpand(campaign.id) }}>
                                                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                    </button>
                                                )}
                                                <div className="flex flex-col group">
                                                    <div className="flex items-center gap-2">
                                                        <Link href={`/dashboard/${campaign.id}`} className="font-medium text-foreground hover:underline" onClick={(e) => e.stopPropagation()}>
                                                            {campaign.name || "Untitled Campaign"}
                                                        </Link>
                                                        <button
                                                            onClick={(e) => {
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                handleEditClick(campaign)
                                                            }}
                                                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                                                            title="Rename"
                                                        >
                                                            <Pencil className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                    {campaign.subject_line && (
                                                        <span className="text-xs text-muted-foreground/70 italic truncate max-w-[280px]">
                                                            {campaign.subject_line}
                                                        </span>
                                                    )}
                                                    <span className="text-xs text-muted-foreground">
                                                        Created {formatDistanceToNow(new Date(campaign.created_at), { addSuffix: true })}
                                                    </span>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-center justify-center gap-1 flex-wrap">
                                                <button
                                                    onClick={async () => {
                                                        setTogglingTemplateId(campaign.id)
                                                        await toggleTemplateStatus(campaign.id, !campaign.is_template)
                                                        router.refresh()
                                                        setTogglingTemplateId(null)
                                                    }}
                                                    disabled={togglingTemplateId === campaign.id}
                                                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-all cursor-pointer ${campaign.is_template
                                                        ? 'text-amber-400 border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20'
                                                        : 'text-muted-foreground/40 border-border/50 bg-transparent hover:text-amber-400 hover:border-amber-500/30 hover:bg-amber-500/5'
                                                        }`}
                                                    title={campaign.is_template ? "Remove from Master Templates" : "Promote to Master Template"}
                                                >
                                                    Master Template
                                                </button>
                                                <button
                                                    onClick={async () => {
                                                        setTogglingReadyId(campaign.id)
                                                        await toggleReadyStatus(campaign.id, !campaign.is_ready)
                                                        router.refresh()
                                                        setTogglingReadyId(null)
                                                    }}
                                                    disabled={togglingReadyId === campaign.id}
                                                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-all cursor-pointer ${campaign.is_ready
                                                        ? 'text-emerald-400 border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20'
                                                        : 'text-muted-foreground/40 border-border/50 bg-transparent hover:text-emerald-400 hover:border-emerald-500/30 hover:bg-emerald-500/5'
                                                        }`}
                                                    title={campaign.is_ready ? "Mark as Not Ready" : "Mark as Ready"}
                                                >
                                                    Ready
                                                </button>
                                                {campaign.is_template && campaign.category && (
                                                    <Badge variant="outline" className="text-violet-400 border-violet-500/50 bg-violet-500/10 text-xs">
                                                        {campaign.category}
                                                    </Badge>
                                                )}
                                            </div>
                                        </TableCell>

                                        {/* METRICS */}
                                        {showAnalytics && (
                                            <>
                                                <TableCell className="text-center">
                                                    {(() => {
                                                        const fromEmail = campaign.sent_from_email || campaign.variable_values?.from_email || "";
                                                        const isMusicalBasics = fromEmail.toLowerCase().includes("musicalbasics");
                                                        return (
                                                            <Badge variant="outline" className={`text-xs ${isMusicalBasics
                                                                ? "text-violet-400 border-violet-500/50 bg-violet-500/10"
                                                                : "text-amber-400 border-amber-500/50 bg-amber-500/10"
                                                                }`}>
                                                                {isMusicalBasics ? "MusicalBasics" : "DreamPlay"}
                                                            </Badge>
                                                        );
                                                    })()}
                                                </TableCell>
                                                <TableCell>
                                                    {(() => {
                                                        const emails = (campaign as any).sent_to_emails || []
                                                        if (emails.length === 0) return <span className="text-muted-foreground">—</span>
                                                        if (emails.length === 1) return (
                                                            <span className="text-xs text-foreground truncate block max-w-[150px]" title={emails[0]}>
                                                                {emails[0]}
                                                            </span>
                                                        )
                                                        return (
                                                            <span className="text-xs text-foreground flex items-center gap-1" title={emails.join(', ')}>
                                                                {emails.length} recipients
                                                                {hasBreakdown && (
                                                                    isExpanded
                                                                        ? <ChevronUp className="w-3 h-3 text-muted-foreground" />
                                                                        : <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                                                )}
                                                            </span>
                                                        )
                                                    })()}
                                                </TableCell>
                                                <TableCell className="text-right font-mono">
                                                    {recipients > 0 ? (
                                                        <span className={openRate > 20 ? "text-emerald-400 font-bold" : "text-muted-foreground"}>
                                                            {openRate}%
                                                        </span>
                                                    ) : "—"}
                                                </TableCell>

                                                <TableCell className="text-right font-mono">
                                                    {recipients > 0 ? (
                                                        <span className={clickRate > 2 ? "text-blue-400 font-bold" : "text-muted-foreground"}>
                                                            {clickRate}%
                                                        </span>
                                                    ) : "—"}
                                                </TableCell>

                                                {/* Checkouts */}
                                                <TableCell className="text-right font-mono">
                                                    {campaign.total_clicks > 0 ? (
                                                        <span className={checkoutRate > 0 ? "text-emerald-400 font-bold" : "text-muted-foreground"}>
                                                            {checkoutRate}% ({conversions})
                                                        </span>
                                                    ) : "—"}
                                                </TableCell>

                                                <TableCell className="text-right font-mono text-amber-400">
                                                    {formatDuration(campaign.average_read_time)}
                                                </TableCell>
                                                <TableCell className="text-right text-xs text-muted-foreground">
                                                    {campaign.updated_at ? formatDistanceToNow(new Date(campaign.updated_at), { addSuffix: true }) : "—"}
                                                </TableCell>
                                            </>
                                        )}

                                        {/* Actions */}
                                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-center justify-end gap-1">
                                                {campaign.is_template && (
                                                    <>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={async () => {
                                                                setTogglingStarredId(campaign.id)
                                                                await toggleCampaignStarred(campaign.id, !campaign.is_starred_template)
                                                                router.refresh()
                                                                setTogglingStarredId(null)
                                                            }}
                                                            disabled={togglingStarredId === campaign.id}
                                                            className={`h-8 w-8 ${campaign.is_starred_template
                                                                ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                                                                : "text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10"
                                                                }`}
                                                            title={campaign.is_starred_template ? "Unpin from Favorites" : "Pin to Favorites"}
                                                        >
                                                            <Star className={`w-4 h-4 ${campaign.is_starred_template ? "fill-current" : ""}`} />
                                                        </Button>
                                                        <Popover
                                                            open={editingCategoryId === campaign.id}
                                                            onOpenChange={(open) => {
                                                                if (open) {
                                                                    setEditingCategoryId(campaign.id)
                                                                    setCategoryInput(campaign.category || "")
                                                                } else {
                                                                    setEditingCategoryId(null)
                                                                }
                                                            }}
                                                        >
                                                            <PopoverTrigger asChild>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className={`h-8 w-8 ${campaign.category
                                                                        ? "text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
                                                                        : "text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10"
                                                                        }`}
                                                                    title={campaign.category ? `Category: ${campaign.category}` : "Set category"}
                                                                >
                                                                    <Tag className="w-4 h-4" />
                                                                </Button>
                                                            </PopoverTrigger>
                                                            <PopoverContent className="w-56 p-3" align="end">
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs font-medium">Category</Label>
                                                                    <div className="flex gap-1.5">
                                                                        <Input
                                                                            value={categoryInput}
                                                                            onChange={(e) => setCategoryInput(e.target.value)}
                                                                            placeholder="e.g. Promo, Onboarding"
                                                                            className="h-8 text-sm"
                                                                            onKeyDown={async (e) => {
                                                                                if (e.key === "Enter") {
                                                                                    await updateCampaignCategory(campaign.id, categoryInput.trim() || null)
                                                                                    setEditingCategoryId(null)
                                                                                    router.refresh()
                                                                                }
                                                                            }}
                                                                        />
                                                                        {campaign.category && (
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="icon"
                                                                                className="h-8 w-8 shrink-0 text-red-400 hover:text-red-300"
                                                                                onClick={async () => {
                                                                                    await updateCampaignCategory(campaign.id, null)
                                                                                    setEditingCategoryId(null)
                                                                                    router.refresh()
                                                                                }}
                                                                                title="Remove category"
                                                                            >
                                                                                <X className="w-3.5 h-3.5" />
                                                                            </Button>
                                                                        )}
                                                                    </div>
                                                                    <Button
                                                                        size="sm"
                                                                        className="w-full h-7 text-xs"
                                                                        onClick={async () => {
                                                                            await updateCampaignCategory(campaign.id, categoryInput.trim() || null)
                                                                            setEditingCategoryId(null)
                                                                            router.refresh()
                                                                        }}
                                                                    >
                                                                        Save
                                                                    </Button>
                                                                </div>
                                                            </PopoverContent>
                                                        </Popover>
                                                    </>
                                                )}
                                                {/* Move to Folder */}
                                                {showFolderActions && folders.length > 0 && (
                                                    <Popover
                                                        open={movingToFolderId === campaign.id}
                                                        onOpenChange={(open) => {
                                                            if (open) setMovingToFolderId(campaign.id)
                                                            else setMovingToFolderId(null)
                                                        }}
                                                    >
                                                        <PopoverTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className={`h-8 w-8 ${campaign.template_folder_id
                                                                    ? "text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                                                                    : "text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10"
                                                                    }`}
                                                                title="Move to folder"
                                                            >
                                                                <FolderInput className="w-4 h-4" />
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-48 p-2" align="end">
                                                            <div className="space-y-1">
                                                                <p className="text-xs font-medium text-muted-foreground px-2 py-1">Move to folder</p>
                                                                {campaign.template_folder_id && (
                                                                    <button
                                                                        className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent text-red-400 hover:text-red-300 transition-colors"
                                                                        onClick={async () => {
                                                                            await moveTemplateToFolder(campaign.id, null)
                                                                            setMovingToFolderId(null)
                                                                            router.refresh()
                                                                        }}
                                                                    >
                                                                        Remove from folder
                                                                    </button>
                                                                )}
                                                                {folders.map(f => (
                                                                    <button
                                                                        key={f.id}
                                                                        className={`w-full text-left text-xs px-2 py-1.5 rounded transition-colors ${
                                                                            campaign.template_folder_id === f.id
                                                                                ? "bg-blue-500/10 text-blue-400 font-medium"
                                                                                : "hover:bg-accent text-foreground"
                                                                        }`}
                                                                        onClick={async () => {
                                                                            await moveTemplateToFolder(campaign.id, f.id)
                                                                            setMovingToFolderId(null)
                                                                            router.refresh()
                                                                        }}
                                                                    >
                                                                        {f.name}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </PopoverContent>
                                                    </Popover>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    asChild
                                                    className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                                                    title="Manage"
                                                >
                                                    <Link href={`/dashboard/${campaign.id}`}>
                                                        <ArrowRight className="w-4 h-4" />
                                                    </Link>
                                                </Button>

                                                {campaign.resend_email_id && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        asChild
                                                        className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                                                        title="Show Email"
                                                    >
                                                        <a href={`https://resend.com/emails/${campaign.resend_email_id}`} target="_blank" rel="noopener noreferrer">
                                                            <ExternalLink className="w-4 h-4" />
                                                        </a>
                                                    </Button>
                                                )}

                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    asChild
                                                    className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                                                    title="Edit"
                                                >
                                                    <Link href={
                                                        campaign.html_content?.includes('"_marker":"__dnd_blocks__"')
                                                            ? `/dnd-editor?id=${campaign.id}`
                                                            : `/editor?id=${campaign.id}`
                                                    }>
                                                        <PenLine className="w-4 h-4" />
                                                    </Link>
                                                </Button>

                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDuplicate(campaign.id)}
                                                    disabled={duplicatingId === campaign.id}
                                                    className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                                                    title="Duplicate"
                                                >
                                                    <Copy className="w-4 h-4" />
                                                </Button>

                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleExportToBlog(campaign.id)}
                                                    disabled={exportingId === campaign.id}
                                                    className="h-8 w-8 text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10"
                                                    title="Export to Blog"
                                                >
                                                    <BookOpen className="w-4 h-4" />
                                                </Button>

                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDownloadHtml(campaign)}
                                                    disabled={downloadingId === campaign.id}
                                                    className="h-8 w-8 text-muted-foreground hover:text-orange-400 hover:bg-orange-500/10"
                                                    title="Download as HTML"
                                                >
                                                    <Download className="w-4 h-4" />
                                                </Button>

                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDelete(campaign.id)}
                                                    disabled={deletingId === campaign.id}
                                                    className="h-8 w-8 text-red-500/70 hover:text-red-500 hover:bg-red-500/10"
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </DraggableRow>
                                    {/* Per-recipient breakdown drawer */}
                                    {hasBreakdown && isExpanded && (
                                        <TableRow key={`${campaign.id}-breakdown`} className="border-border bg-neutral-900/50">
                                            <TableCell colSpan={colSpan} className="p-0">
                                                <div className="px-6 py-3 space-y-1.5">
                                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Per-Recipient Breakdown</div>
                                                    {campaign.recipient_breakdown!.map((r) => (
                                                        <div key={r.subscriber_id} className="flex items-center gap-3 py-1.5 px-3 rounded-md bg-neutral-800/50 border border-neutral-700/50">
                                                            <div className="flex items-center gap-2 min-w-[180px] max-w-[400px]">
                                                                <Link href={`/audience/${r.subscriber_id}`} className="text-xs text-foreground font-mono truncate hover:text-blue-400 hover:underline transition-colors" title={`${r.email} — View profile`} onClick={(e) => e.stopPropagation()}>
                                                                    {r.email}
                                                                </Link>
                                                                {r.campaign_name && (
                                                                    <span className="text-[10px] text-muted-foreground truncate max-w-[200px]" title={r.campaign_name}>
                                                                        — {r.campaign_name}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2 ml-auto">
                                                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${r.opened ? 'text-emerald-400 border-emerald-500/50 bg-emerald-500/10' : 'text-neutral-500 border-neutral-600/50 bg-neutral-800/50'}`}>
                                                                    <Eye className="w-3 h-3 mr-1" />
                                                                    {r.opened ? 'Opened' : 'No Open'}
                                                                </Badge>
                                                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${r.clicked ? 'text-blue-400 border-blue-500/50 bg-blue-500/10' : 'text-neutral-500 border-neutral-600/50 bg-neutral-800/50'}`}>
                                                                    <MousePointer2 className="w-3 h-3 mr-1" />
                                                                    {r.clicked ? 'Clicked' : 'No Click'}
                                                                </Badge>
                                                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${r.converted ? 'text-amber-400 border-amber-500/50 bg-amber-500/10' : 'text-neutral-500 border-neutral-600/50 bg-neutral-800/50'}`}>
                                                                    <ShoppingCart className="w-3 h-3 mr-1" />
                                                                    {r.converted ? 'Checkout' : 'No Checkout'}
                                                                </Badge>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </>
                            )
                        })
                    )}
                </TableBody>
            </Table>

            {/* Pagination */}
            {(() => { console.log("[CampaignsTable] paginate:", paginate, "serverPagination:", serverPagination, "campaigns.length:", campaigns.length); return null })()}
            {paginate && (serverPagination ? serverPagination.totalItems > 0 : campaigns.length > 0) && (() => {
                const sp = serverPagination
                const effectiveTotal = sp ? sp.totalItems : campaigns.length
                const effectivePage = sp ? sp.currentPage : currentPage
                const effectivePageSize = sp ? sp.pageSize : pageSize
                const totalPages = Math.ceil(effectiveTotal / effectivePageSize)
                return (
                    <div className="flex items-center justify-between border-t border-border px-6 py-3">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Rows per page:</span>
                            {[25, 50, 100].map(size => (
                                <button
                                    key={size}
                                    onClick={() => {
                                        if (sp) {
                                            sp.onPageChange(0, size)
                                        } else {
                                            setPageSize(size); setCurrentPage(0)
                                        }
                                    }}
                                    className={`text-xs px-2 py-1 rounded transition-colors ${effectivePageSize === size ? 'bg-[#D4AF37]/20 text-[#D4AF37] font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    {size}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground">
                                {effectivePage * effectivePageSize + 1}–{Math.min((effectivePage + 1) * effectivePageSize, effectiveTotal)} of {effectiveTotal}
                            </span>
                            <div className="flex gap-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        if (sp) {
                                            sp.onPageChange(Math.max(0, effectivePage - 1), effectivePageSize)
                                        } else {
                                            setCurrentPage(p => Math.max(0, p - 1))
                                        }
                                    }}
                                    disabled={effectivePage === 0}
                                    className="h-7 px-2 text-xs"
                                >
                                    Prev
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        if (sp) {
                                            sp.onPageChange(Math.min(totalPages - 1, effectivePage + 1), effectivePageSize)
                                        } else {
                                            setCurrentPage(p => Math.min(totalPages - 1, p + 1))
                                        }
                                    }}
                                    disabled={effectivePage >= totalPages - 1}
                                    className="h-7 px-2 text-xs"
                                >
                                    Next
                                </Button>
                            </div>
                        </div>
                    </div>
                )
            })()}

            <Dialog open={!!editingCampaign} onOpenChange={(open) => !open && setEditingCampaign(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rename Campaign</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">Campaign Name</Label>
                            <Input
                                id="name"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Enter campaign name"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingCampaign(null)}>Cancel</Button>
                        <Button onClick={handleRename} disabled={renaming}>
                            {renaming ? "Saving..." : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function DraggableRow({
    campaign,
    isRowDraggable,
    children,
    ...props
}: any) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `campaign-${campaign.id}`,
        data: {
            type: "Campaign",
            campaign,
        },
        disabled: !isRowDraggable,
    })

    const style = transform ? {
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 50 : "auto",
        position: isDragging ? "relative" as any : "static" as any,
        opacity: isDragging ? 0.5 : 1,
    } : undefined

    return (
        <TableRow ref={setNodeRef} style={style} {...props}>
            {isRowDraggable && (
                <TableCell className="px-3" onClick={(e) => e.stopPropagation()}>
                    <div {...listeners} {...attributes} className="cursor-grab hover:bg-muted p-1 rounded transition-colors flex items-center justify-center">
                        <GripVertical className="w-4 h-4 text-muted-foreground" />
                    </div>
                </TableCell>
            )}
            {children}
        </TableRow>
    )
}
