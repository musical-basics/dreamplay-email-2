"use client"

import { useEffect, useState, use } from "react"
import { useRouter, useParams } from "next/navigation"
import { getRotation, getRotationAnalytics, updateRotation, deleteRotation } from "@/app/actions/rotations"
import { getCampaignList } from "@/app/actions/campaigns"
import { RefreshCw, ArrowLeft, Pencil, Trash2, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"
import { formatDistanceToNow } from "date-fns"

export default function RotationDetailPage({ params }: { params: Promise<{ id: string; workspace: string }> }) {
    const { id, workspace } = use(params)
    const router = useRouter()
    const { toast } = useToast()

    const [rotation, setRotation] = useState<any>(null)
    const [analytics, setAnalytics] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    // Edit state
    const [editOpen, setEditOpen] = useState(false)
    const [editName, setEditName] = useState("")
    const [editCampaignIds, setEditCampaignIds] = useState<string[]>([])
    const [allTemplates, setAllTemplates] = useState<any[]>([])
    const [saving, setSaving] = useState(false)

    const fetchData = async () => {
        setLoading(true)
        const [rot, stats] = await Promise.all([
            getRotation(id),
            getRotationAnalytics(id),
        ])
        setRotation(rot)
        setAnalytics(stats)
        setLoading(false)
    }

    useEffect(() => { fetchData() }, [id])

    const openEdit = async () => {
        if (!rotation) return
        setEditName(rotation.name)
        setEditCampaignIds(rotation.campaign_ids)
        const campaigns = await getCampaignList(workspace)
        setAllTemplates(campaigns.filter((c: any) => c.is_template && c.is_ready))
        setEditOpen(true)
    }

    const handleSaveEdit = async () => {
        if (!editName.trim() || editCampaignIds.length < 2) return
        setSaving(true)
        const result = await updateRotation(workspace, id, editName.trim(), editCampaignIds)
        if (result.success) {
            toast({ title: "Rotation updated" })
            setEditOpen(false)
            fetchData()
        } else {
            toast({ title: "Error", description: result.error, variant: "destructive" })
        }
        setSaving(false)
    }

    const handleDelete = async () => {
        if (!confirm("Delete this rotation? Child campaign stats will be preserved.")) return
        await deleteRotation(workspace, id)
        toast({ title: "Rotation deleted" })
        router.push("/rotations")
    }

    const toggleEditTemplate = (templateId: string) => {
        setEditCampaignIds(prev =>
            prev.includes(templateId) ? prev.filter(x => x !== templateId) : [...prev, templateId]
        )
    }

    if (loading) {
        return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading rotation...</div>
    }

    if (!rotation) {
        return <div className="flex items-center justify-center py-20 text-muted-foreground">Rotation not found</div>
    }

    // Calculate totals
    const totalSends = analytics.reduce((sum, s) => sum + s.sends, 0)
    const totalOpens = analytics.reduce((sum, s) => sum + s.opens, 0)
    const totalClicks = analytics.reduce((sum, s) => sum + s.clicks, 0)
    const overallOpenRate = totalSends > 0 ? Math.round((totalOpens / totalSends) * 100) : 0
    const overallClickRate = totalSends > 0 ? Math.round((totalClicks / totalSends) * 100) : 0

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <Link href="/rotations" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2">
                        <ArrowLeft className="w-3 h-3" />
                        Back to Rotations
                    </Link>
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                        <RefreshCw className="w-6 h-6 text-primary" />
                        {rotation.name}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {rotation.campaigns.length} campaigns · Next send: position {rotation.cursor_position + 1} ({rotation.campaigns[rotation.cursor_position]?.name || "?"})
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={openEdit} className="gap-1.5">
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDelete} className="gap-1.5 text-red-400 hover:text-red-300 border-red-500/30 hover:bg-red-500/10">
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                    </Button>
                </div>
            </div>

            {/* Cursor Indicator */}
            <div className="p-4 rounded-xl border border-border bg-card">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-3">Rotation Order</p>
                <div className="flex items-center gap-2 flex-wrap">
                    {rotation.campaigns.map((c: any, i: number) => {
                        const isCurrent = i === rotation.cursor_position
                        return (
                            <div key={c.id} className="flex items-center gap-2">
                                <div className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${isCurrent
                                        ? "bg-primary/10 text-primary border-primary/30 ring-2 ring-primary/20"
                                        : "bg-muted/30 text-muted-foreground border-border"
                                    }`}>
                                    <span className="font-mono text-xs mr-1.5 opacity-50">{i + 1}.</span>
                                    {c.name}
                                    {isCurrent && <span className="ml-2 text-[10px] font-bold uppercase">← Next</span>}
                                </div>
                                {i < rotation.campaigns.length - 1 && (
                                    <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Overall Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                    { label: "Total Sends", value: totalSends, color: "text-foreground" },
                    { label: "Opens", value: totalOpens, color: "text-emerald-400" },
                    { label: "Clicks", value: totalClicks, color: "text-blue-400" },
                    { label: "Open Rate", value: `${overallOpenRate}%`, color: overallOpenRate > 20 ? "text-emerald-400 font-bold" : "text-muted-foreground" },
                    { label: "Click Rate", value: `${overallClickRate}%`, color: overallClickRate > 2 ? "text-blue-400 font-bold" : "text-muted-foreground" },
                ].map(stat => (
                    <div key={stat.label} className="p-3 rounded-lg border border-border bg-card text-center">
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground">{stat.label}</p>
                        <p className={`text-xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
                    </div>
                ))}
            </div>

            {/* Per-Campaign Analytics */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                    <p className="text-sm font-semibold text-foreground">Per-Campaign Performance</p>
                </div>
                {analytics.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                        No sends yet. Use "Send via Rotation" in the Audience page to start.
                    </div>
                ) : (
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                                <th className="text-left px-4 py-2">Campaign</th>
                                <th className="text-right px-4 py-2">Sends</th>
                                <th className="text-right px-4 py-2">Opens</th>
                                <th className="text-right px-4 py-2">Open Rate</th>
                                <th className="text-right px-4 py-2">Clicks</th>
                                <th className="text-right px-4 py-2">Click Rate</th>
                            </tr>
                        </thead>
                        <tbody>
                            {analytics.map((stat: any) => (
                                <tr key={stat.templateId} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                                    <td className="px-4 py-3">
                                        <p className="text-sm font-medium text-foreground">{stat.templateName}</p>
                                        <p className="text-[10px] text-muted-foreground">{stat.childCampaigns.length} send batch{stat.childCampaigns.length !== 1 ? "es" : ""}</p>
                                    </td>
                                    <td className="text-right px-4 py-3 font-mono text-sm">{stat.sends}</td>
                                    <td className="text-right px-4 py-3 font-mono text-sm text-emerald-400">{stat.opens}</td>
                                    <td className="text-right px-4 py-3 font-mono text-sm">
                                        <span className={stat.openRate > 20 ? "text-emerald-400 font-bold" : "text-muted-foreground"}>
                                            {stat.openRate}%
                                        </span>
                                    </td>
                                    <td className="text-right px-4 py-3 font-mono text-sm text-blue-400">{stat.clicks}</td>
                                    <td className="text-right px-4 py-3 font-mono text-sm">
                                        <span className={stat.clickRate > 2 ? "text-blue-400 font-bold" : "text-muted-foreground"}>
                                            {stat.clickRate}%
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Child Campaign List (individual sends) */}
            {analytics.some(s => s.childCampaigns.length > 0) && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-3 border-b border-border">
                        <p className="text-sm font-semibold text-foreground">Individual Send Batches</p>
                        <p className="text-xs text-muted-foreground">Each row is a child campaign with its own stats.</p>
                    </div>
                    <div className="divide-y divide-border/50">
                        {analytics.flatMap(stat =>
                            stat.childCampaigns.map((child: any) => (
                                <Link
                                    key={child.id}
                                    href={`/dashboard/${child.id}`}
                                    className="flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors group"
                                >
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-foreground truncate">{child.name}</p>
                                        <p className="text-[10px] text-muted-foreground">
                                            {child.created_at ? formatDistanceToNow(new Date(child.created_at), { addSuffix: true }) : "—"}
                                            {" · "}{child.total_recipients || 0} recipients
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs font-mono shrink-0">
                                        <span className={child.total_opens > 0 ? "text-emerald-400" : "text-muted-foreground"}>
                                            {child.total_opens || 0} opens
                                        </span>
                                        <span className={child.total_clicks > 0 ? "text-blue-400" : "text-muted-foreground"}>
                                            {child.total_clicks || 0} clicks
                                        </span>
                                        <Badge variant="outline" className={`text-[10px] ${child.status === "completed" ? "text-emerald-400 border-emerald-500/30" : "text-zinc-400 border-zinc-500/30"}`}>
                                            {child.status}
                                        </Badge>
                                        <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                </Link>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Edit Dialog */}
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit Rotation</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Campaigns (min 2)</Label>
                            <p className="text-xs text-muted-foreground">Changing the order will reset the cursor to position 1.</p>
                            <div className="max-h-60 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                                {allTemplates.map((t: any) => {
                                    const isSelected = editCampaignIds.includes(t.id)
                                    const order = isSelected ? editCampaignIds.indexOf(t.id) + 1 : null
                                    return (
                                        <button
                                            key={t.id}
                                            onClick={() => toggleEditTemplate(t.id)}
                                            className={`w-full text-left px-3 py-2.5 text-sm flex items-center justify-between transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-muted/30"
                                                }`}
                                        >
                                            <span className={isSelected ? "text-foreground font-medium" : "text-muted-foreground"}>
                                                {t.name}
                                            </span>
                                            {order && (
                                                <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                                    #{order}
                                                </span>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveEdit} disabled={saving || !editName.trim() || editCampaignIds.length < 2}>
                            {saving ? "Saving..." : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
