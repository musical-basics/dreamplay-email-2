"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import {
    Dialog, DialogContent, DialogDescription,
    DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    GitBranch, Mail, Clock, ChevronDown, ChevronUp,
    Zap, ArrowRight, Eye, MousePointer2, Ghost, GraduationCap,
    Plus, Pencil, Trash2, X, Pause, Play, XCircle, User, Timer, Loader2, CheckCircle2, GripVertical, Star, SkipForward
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
    getChains, createChain, updateChain, deleteChain, getDraftChains, promoteDraftToMaster,
    type ChainRow, type ChainFormData
} from "@/app/actions/chains"
import { getCampaignList } from "@/app/actions/campaigns"
import { getChainProcesses, updateProcessStatus, kickChainStep, pauseAllActiveProcesses, resumeAllPausedProcesses } from "@/app/actions/chain-processes"
import type { ChainProcess, ChainProcessHistoryEntry } from "@/lib/types"
import { CustomerJourneysTab } from "@/components/chains/customer-journeys-tab"

// ─── TYPES ─────────────────────────────────────────────────
interface StepForm { label: string; template_key: string; wait_after: string }
interface BranchForm { label: string; condition: string; action: string; description: string }

const emptyStep = (): StepForm => ({ label: "", template_key: "", wait_after: "" })
const emptyBranch = (): BranchForm => ({ label: "", condition: "", action: "", description: "" })

const TRIGGER_EVENT_OPTIONS = [
    { value: "chain.run", label: "chain.run (generic — recommended)" },
]

const TRIGGER_LABEL_OPTIONS = [
    { value: "New subscriber signup (webhook)", label: "New subscriber signup (webhook)" },
    { value: "Manual trigger via dashboard", label: "Manual trigger via dashboard" },
    { value: "Tag added to subscriber", label: "Tag added to subscriber" },
    { value: "Purchase completed (Shopify webhook)", label: "Purchase completed (Shopify webhook)" },
]

function chainRowToFormData(chain: ChainRow): ChainFormData {
    return {
        name: chain.name,
        slug: chain.slug,
        description: chain.description || "",
        trigger_label: chain.trigger_label || "",
        trigger_event: chain.trigger_event,
        steps: chain.chain_steps.map(s => ({
            position: s.position,
            label: s.label,
            template_key: s.template_key,
            wait_after: s.wait_after,
        })),
        branches: chain.chain_branches.map(b => ({
            description: b.description,
            position: b.position,
            label: b.label,
            condition: b.condition,
            action: b.action,
        })),
    }
}

// ─── CHAIN CARD ────────────────────────────────────────────
function ChainCard({
    chain,
    onEdit,
    onDelete
}: {
    chain: ChainRow
    onEdit: (chain: ChainRow) => void
    onDelete: (chain: ChainRow) => void
}) {
    const [expanded, setExpanded] = useState(false)
    const [previewIndex, setPreviewIndex] = useState<number | null>(null)

    const steps = chain.chain_steps || []
    const branches = chain.chain_branches || []
    const branchDescription = branches.length > 0 ? branches[0].description : ""

    return (
        <Card className="border-border bg-card overflow-hidden">
            <CardHeader className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                            <GitBranch className="h-5 w-5 text-emerald-500" />
                        </div>
                        <div>
                            <CardTitle className="text-lg">{chain.name}</CardTitle>
                            <CardDescription className="mt-1">{chain.description}</CardDescription>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={(e) => { e.stopPropagation(); onEdit(chain) }}
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={(e) => { e.stopPropagation(); onDelete(chain) }}
                            className="text-muted-foreground hover:text-red-400"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                        <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/10 text-xs">
                            {steps.length} email{steps.length !== 1 ? "s" : ""}
                            {branches.length > 0 ? " + branching" : ""}
                        </Badge>
                        {expanded ? (
                            <ChevronUp className="h-5 w-5 text-muted-foreground" />
                        ) : (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        )}
                    </div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Zap className="h-3.5 w-3.5 text-yellow-500" />
                    <span>Trigger: <span className="text-foreground font-mono">{chain.trigger_event}</span></span>
                    <span className="text-border">•</span>
                    <span>{chain.trigger_label}</span>
                </div>
            </CardHeader>

            {expanded && (
                <CardContent className="pt-0 space-y-6">
                    {/* Steps Timeline */}
                    <div className="space-y-0">
                        {steps.map((step, i) => {
                            const isPreviewOpen = previewIndex === i

                            return (
                                <div key={step.id || i}>
                                    {/* Step */}
                                    <div className="flex items-start gap-4 group">
                                        {/* Timeline dot & line */}
                                        <div className="flex flex-col items-center">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-xs font-bold">
                                                {i + 1}
                                            </div>
                                            {(i < steps.length - 1 || branches.length > 0) && (
                                                <div className="w-px flex-1 min-h-[24px] bg-border" />
                                            )}
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 pb-4">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm font-medium text-foreground">{step.label}</p>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <Mail className="h-3 w-3 text-muted-foreground" />
                                                        <p className="text-xs text-muted-foreground font-mono">
                                                            {step.template_key}
                                                        </p>
                                                    </div>
                                                </div>
                                                <a
                                                    href={`/editor?id=${step.template_key}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 transition-colors shrink-0"
                                                >
                                                    <Eye className="h-3 w-3" />
                                                    View
                                                </a>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Wait indicator */}
                                    {step.wait_after && (
                                        <div className="flex items-start gap-4">
                                            <div className="flex flex-col items-center">
                                                <div className="w-px min-h-[8px] bg-border" />
                                                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
                                                    <Clock className="h-3 w-3 text-muted-foreground" />
                                                </div>
                                                <div className="w-px min-h-[8px] bg-border" />
                                            </div>
                                            <div className="flex items-center h-6 mt-2">
                                                <p className="text-xs text-muted-foreground italic">
                                                    Wait {step.wait_after}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })}

                        {/* Branching */}
                        {branches.length > 0 && (
                            <div className="flex items-start gap-4 mt-2">
                                <div className="flex flex-col items-center">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-blue-500/50 bg-blue-500/10">
                                        <GitBranch className="h-4 w-4 text-blue-400" />
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-foreground mb-3">
                                        {branchDescription}
                                    </p>
                                    <div className="space-y-2">
                                        {branches.map((branch, i) => {
                                            const icons = [
                                                <MousePointer2 key="click" className="h-3.5 w-3.5 text-emerald-400" />,
                                                <Eye key="open" className="h-3.5 w-3.5 text-amber-400" />,
                                                <Ghost key="ghost" className="h-3.5 w-3.5 text-zinc-400" />,
                                            ]
                                            const borderColors = [
                                                "border-emerald-500/30 bg-emerald-500/5",
                                                "border-amber-500/30 bg-amber-500/5",
                                                "border-zinc-500/30 bg-zinc-500/5",
                                            ]
                                            return (
                                                <div key={branch.id || i} className={`rounded-lg border p-3 ${borderColors[i] || borderColors[2]}`}>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        {icons[i] || icons[2]}
                                                        <span className="text-sm font-medium">{branch.label}</span>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground ml-6">
                                                        <span className="text-foreground/70">If:</span> {branch.condition}
                                                    </p>
                                                    <div className="flex items-center gap-1 text-xs text-muted-foreground ml-6 mt-1">
                                                        <ArrowRight className="h-3 w-3" />
                                                        {branch.action}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Campaign IDs reference */}
                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                        <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                            <GraduationCap className="h-3.5 w-3.5" />
                            Tracking Campaign IDs
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {steps.map(step => (
                                <div key={step.id || step.template_key} className="flex items-center gap-2 text-xs">
                                    <span className="text-muted-foreground">{step.label}:</span>
                                    <code className="font-mono text-foreground/70 text-[10px]">
                                        {step.template_key}
                                    </code>
                                </div>
                            ))}
                        </div>
                    </div>
                </CardContent>
            )}
        </Card>
    )
}

// ─── CHAIN FORM DIALOG ─────────────────────────────────────
// Timeline item for draft mode: either a "send" or a "wait"
type TimelineItem =
    | { type: "send"; template_key: string }
    | { type: "wait"; duration: number; unit: "minutes" | "hours" | "days" | "weeks" }

function ChainFormDialog({
    open,
    onOpenChange,
    editingChain,
    onSave,
    subscriberName,
    forceDraftMode,
    workspace,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    editingChain: ChainRow | null
    onSave: (data: ChainFormData, chainId?: string) => Promise<void>
    subscriberName?: string
    forceDraftMode?: boolean
    workspace: string
}) {
    const isEditingDraft = !!editingChain?.subscriber_id
    const isDraftMode = forceDraftMode || (!!subscriberName && !editingChain) || isEditingDraft
    const [loading, setLoading] = useState(false)

    // Master chain fields
    const [name, setName] = useState("")
    const [slug, setSlug] = useState("")
    const [description, setDescription] = useState("")
    const [triggerLabel, setTriggerLabel] = useState("")
    const [triggerEvent, setTriggerEvent] = useState("")
    const [steps, setSteps] = useState<StepForm[]>([emptyStep()])
    const [branches, setBranches] = useState<BranchForm[]>([])

    // Draft chain fields
    const [draftName, setDraftName] = useState("")
    const [timeline, setTimeline] = useState<TimelineItem[]>([{ type: "send", template_key: "" }])
    type WaitUnit = "minutes" | "hours" | "days" | "weeks"

    const [campaigns, setCampaigns] = useState<{ id: string; name: string; status: string }[]>([])

    useEffect(() => {
        if (open) {
            getCampaignList(workspace).then(data => setCampaigns(data.filter((c: any) => c.is_template === true)))
        }
    }, [open])

    // Populate form when editing
    useEffect(() => {
        if (editingChain) {
            if (editingChain.subscriber_id) {
                // Editing a draft chain — populate timeline UI
                setDraftName(editingChain.name)
                const timelineItems: TimelineItem[] = []
                const sortedSteps = [...(editingChain.chain_steps || [])].sort((a: any, b: any) => a.position - b.position)
                sortedSteps.forEach((step: any, i: number) => {
                    timelineItems.push({ type: "send", template_key: step.template_key })
                    if (step.wait_after) {
                        const match = step.wait_after.match(/^(\d+)\s*(minutes?|hours?|days?|weeks?)$/i)
                        if (match) {
                            const num = parseInt(match[1])
                            let unit: WaitUnit = "days"
                            if (match[2].startsWith("min")) unit = "minutes"
                            else if (match[2].startsWith("hour")) unit = "hours"
                            else if (match[2].startsWith("week")) unit = "weeks"
                            timelineItems.push({ type: "wait", duration: num, unit })
                        }
                    }
                })
                setTimeline(timelineItems.length > 0 ? timelineItems : [{ type: "send", template_key: "" }])
            } else {
                // Editing a master chain — populate full form
                const fd = chainRowToFormData(editingChain)
                setName(fd.name)
                setSlug(fd.slug)
                setDescription(fd.description)
                setTriggerLabel(fd.trigger_label)
                setTriggerEvent(fd.trigger_event)
                setSteps(fd.steps.map(s => ({
                    label: s.label,
                    template_key: s.template_key,
                    wait_after: s.wait_after || "",
                })))
                setBranches(fd.branches.map(b => ({
                    label: b.label,
                    condition: b.condition,
                    action: b.action,
                    description: b.description,
                })))
            }
        } else {
            setName("")
            setSlug("")
            setDescription("")
            setTriggerLabel("")
            setTriggerEvent("")
            setSteps([emptyStep()])
            setBranches([])
            // Reset draft mode
            setDraftName(subscriberName ? `New Chain for ${subscriberName}` : "New Chain")
            setTimeline([{ type: "send", template_key: "" }])
        }
    }, [editingChain, open, subscriberName])

    const handleNameChange = (val: string) => {
        setName(val)
        if (!editingChain) {
            setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-chain")
        }
    }

    const updateStep = (index: number, field: keyof StepForm, value: string) => {
        setSteps(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
    }

    const updateBranch = (index: number, field: keyof BranchForm, value: string) => {
        setBranches(prev => prev.map((b, i) => i === index ? { ...b, [field]: value } : b))
    }

    const updateTimelineItem = (index: number, patch: Partial<TimelineItem>) => {
        setTimeline(prev => prev.map((item, i) => i === index ? { ...item, ...patch } as TimelineItem : item))
    }

    const removeTimelineItem = (index: number) => {
        setTimeline(prev => prev.filter((_, i) => i !== index))
    }

    // Auto-insert a "Wait 1 day" between consecutive send steps
    const addStep = () => {
        setTimeline(prev => {
            const newItems: TimelineItem[] = [...prev]
            // If the last item is a "send", insert a wait before the new step
            if (newItems.length > 0 && newItems[newItems.length - 1].type === "send") {
                newItems.push({ type: "wait", duration: 1, unit: "days" })
            }
            newItems.push({ type: "send", template_key: "" })
            return newItems
        })
    }

    const addWait = () => {
        setTimeline(prev => [...prev, { type: "wait", duration: 1, unit: "days" }])
    }

    // ─── Drag & Drop ───
    const [dragIndex, setDragIndex] = useState<number | null>(null)
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDragIndex(index)
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", String(index))
    }

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        setDragOverIndex(index)
    }

    const handleDragLeave = () => {
        setDragOverIndex(null)
    }

    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault()
        const fromIndex = dragIndex
        setDragIndex(null)
        setDragOverIndex(null)
        if (fromIndex === null || fromIndex === dropIndex) return
        setTimeline(prev => {
            const updated = [...prev]
            const [moved] = updated.splice(fromIndex, 1)
            updated.splice(dropIndex, 0, moved)
            return updated
        })
    }

    const handleDragEnd = () => {
        setDragIndex(null)
        setDragOverIndex(null)
    }

    // Convert timeline to steps format (merging send + following wait into one step)
    const timelineToSteps = () => {
        const result: { label: string; template_key: string; wait_after: string | null; position: number }[] = []
        let stepNum = 0
        for (let i = 0; i < timeline.length; i++) {
            const item = timeline[i]
            if (item.type === "send") {
                stepNum++
                const campaignName = campaigns.find(c => c.id === item.template_key)?.name || `Step ${stepNum}`
                // Check if next item is a wait
                const next = timeline[i + 1]
                let waitAfter: string | null = null
                if (next && next.type === "wait") {
                    waitAfter = `${next.duration} ${next.unit}`
                    i++ // skip the wait item
                }
                result.push({
                    position: stepNum,
                    label: campaignName,
                    template_key: item.template_key,
                    wait_after: waitAfter,
                })
            } else if (item.type === "wait") {
                // Standalone wait — attach to previous step
                if (result.length > 0) {
                    result[result.length - 1].wait_after = `${item.duration} ${item.unit}`
                }
            }
        }
        return result
    }

    const handleSubmit = async () => {
        setLoading(true)
        try {
            if (isDraftMode) {
                const convertedSteps = timelineToSteps()
                const autoName = draftName || `New Chain for ${subscriberName}`
                const autoSlug = autoName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-chain"
                const formData: ChainFormData = {
                    name: autoName,
                    slug: autoSlug,
                    description: "",
                    trigger_label: "",
                    trigger_event: "manual",
                    steps: convertedSteps,
                    branches: [],
                }
                await onSave(formData, editingChain?.id)
            } else {
                if (!name.trim() || !triggerEvent.trim()) return
                const formData: ChainFormData = {
                    name, slug, description, trigger_label: triggerLabel, trigger_event: triggerEvent,
                    steps: steps.filter(s => s.label.trim() && s.template_key.trim()).map((s, i) => ({
                        position: i + 1, label: s.label, template_key: s.template_key,
                        wait_after: s.wait_after || null,
                    })),
                    branches: branches.filter(b => b.label.trim()).map((b, i) => ({
                        position: i + 1, label: b.label, condition: b.condition, action: b.action,
                        description: b.description,
                    })),
                }
                await onSave(formData, editingChain?.id)
            }
            onOpenChange(false)
        } finally {
            setLoading(false)
        }
    }

    // Check if draft form has at least one send step with a template
    const draftHasValidStep = timeline.some(item => item.type === "send" && item.template_key)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEditingDraft ? "Edit Draft Chain" : editingChain ? "Edit Chain" : "New Draft Chain"}</DialogTitle>
                    {isDraftMode && subscriberName && (
                        <div className="mt-2 rounded-md bg-[#D4AF37]/10 border border-[#D4AF37]/30 px-3 py-2 text-sm flex items-center gap-2">
                            <User className="h-4 w-4 text-[#D4AF37]" />
                            Creating draft chain for <span className="font-semibold">{subscriberName}</span>
                        </div>
                    )}
                    <DialogDescription>
                        {editingChain
                            ? "Update the chain configuration."
                            : "Build a sequence of steps and wait times. Drag to reorder."
                        }
                    </DialogDescription>
                </DialogHeader>

                {/* ─── DRAFT MODE (simplified) ─── */}
                {isDraftMode ? (
                    <div className="space-y-5 py-4">
                        {/* Editable Name */}
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Chain Name</Label>
                            <Input
                                value={draftName}
                                onChange={e => setDraftName(e.target.value)}
                                className="text-sm"
                            />
                        </div>

                        {/* Sequential Timeline */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-foreground">Sequence</h3>
                                <div className="flex gap-1">
                                    <Button variant="outline" size="sm" onClick={addStep}>
                                        <Plus className="h-3.5 w-3.5 mr-1" /> Step (Email)
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={addWait}>
                                        <Clock className="h-3.5 w-3.5 mr-1" /> Wait
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-0">
                                {timeline.map((item, i) => (
                                    <div key={i}>
                                        {/* Connector line */}
                                        {i > 0 && (
                                            <div className="flex justify-center py-1">
                                                <div className={`w-px h-4 ${dragOverIndex === i ? "bg-[#D4AF37]" : "bg-border"}`} />
                                            </div>
                                        )}

                                        {item.type === "send" ? (
                                            <div
                                                draggable
                                                onDragStart={e => handleDragStart(e, i)}
                                                onDragOver={e => handleDragOver(e, i)}
                                                onDragLeave={handleDragLeave}
                                                onDrop={e => handleDrop(e, i)}
                                                onDragEnd={handleDragEnd}
                                                className={`rounded-lg border p-3 bg-card transition-all ${dragIndex === i ? "opacity-40 border-dashed border-muted-foreground" :
                                                    dragOverIndex === i ? "border-[#D4AF37] ring-1 ring-[#D4AF37]/30" :
                                                        "border-border"
                                                    }`}
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground transition-colors mr-0.5">
                                                            <GripVertical className="h-4 w-4" />
                                                        </div>
                                                        <div className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center">
                                                            <Mail className="h-3 w-3 text-primary" />
                                                        </div>
                                                        <span className="text-xs font-medium text-muted-foreground">Step (Email)</span>
                                                    </div>
                                                    {timeline.length > 1 && (
                                                        <button
                                                            onClick={() => removeTimelineItem(i)}
                                                            className="text-xs text-muted-foreground hover:text-red-400 flex items-center gap-0.5 transition-colors"
                                                        >
                                                            <X className="h-3 w-3" /> Remove
                                                        </button>
                                                    )}
                                                </div>
                                                <Select
                                                    value={item.template_key}
                                                    onValueChange={val => updateTimelineItem(i, { template_key: val })}
                                                >
                                                    <SelectTrigger className="text-sm">
                                                        <SelectValue placeholder="Select email template..." />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {campaigns.map(c => (
                                                            <SelectItem key={c.id} value={c.id} className="text-sm">
                                                                {c.name}
                                                            </SelectItem>
                                                        ))}

                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        ) : (
                                            <div
                                                draggable
                                                onDragStart={e => handleDragStart(e, i)}
                                                onDragOver={e => handleDragOver(e, i)}
                                                onDragLeave={handleDragLeave}
                                                onDrop={e => handleDrop(e, i)}
                                                onDragEnd={handleDragEnd}
                                                className={`rounded-lg border border-dashed p-3 transition-all ${dragIndex === i ? "opacity-40 border-muted-foreground" :
                                                    dragOverIndex === i ? "border-[#D4AF37] ring-1 ring-[#D4AF37]/30 bg-amber-500/5" :
                                                        "border-amber-500/30 bg-amber-500/5"
                                                    }`}
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground transition-colors mr-0.5">
                                                            <GripVertical className="h-4 w-4" />
                                                        </div>
                                                        <div className="h-5 w-5 rounded bg-amber-500/10 flex items-center justify-center">
                                                            <Clock className="h-3 w-3 text-amber-400" />
                                                        </div>
                                                        <span className="text-xs font-medium text-amber-400">Wait</span>
                                                    </div>
                                                    <button
                                                        onClick={() => removeTimelineItem(i)}
                                                        className="text-xs text-muted-foreground hover:text-red-400 flex items-center gap-0.5 transition-colors"
                                                    >
                                                        <X className="h-3 w-3" /> Remove
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        value={item.duration}
                                                        onChange={e => updateTimelineItem(i, { duration: parseInt(e.target.value) || 1 })}
                                                        className="w-20 text-sm"
                                                    />
                                                    <Select
                                                        value={item.unit}
                                                        onValueChange={(val: WaitUnit) => updateTimelineItem(i, { unit: val })}
                                                    >
                                                        <SelectTrigger className="w-[100px] text-sm">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="minutes">minutes</SelectItem>
                                                            <SelectItem value="hours">hours</SelectItem>
                                                            <SelectItem value="days">days</SelectItem>
                                                            <SelectItem value="weeks">weeks</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {timeline.length === 0 && (
                                <p className="text-sm text-muted-foreground text-center py-4">
                                    Add a step or wait to start building your chain.
                                </p>
                            )}
                        </div>
                    </div>
                ) : (
                    /* ─── MASTER MODE (full form) ─── */
                    <div className="space-y-6 py-4">
                        {/* Chain Details */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-foreground">Chain Details</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="chain-name">Name <span className="text-muted-foreground font-normal">(required)</span></Label>
                                    <Input id="chain-name" value={name} onChange={e => handleNameChange(e.target.value)} placeholder="e.g., Welcome Sequence" />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="chain-slug">Slug <span className="text-muted-foreground font-normal">(auto-generated)</span></Label>
                                    <Input id="chain-slug" value={slug} onChange={e => setSlug(e.target.value)} placeholder="welcome-sequence-chain" className="font-mono text-xs" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="chain-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
                                <Input id="chain-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="What this chain does..." />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Trigger Event <span className="text-muted-foreground font-normal">(required)</span></Label>
                                    <Select value={triggerEvent} onValueChange={setTriggerEvent}>
                                        <SelectTrigger className="w-full font-mono text-xs">
                                            <SelectValue placeholder="Select trigger event..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {TRIGGER_EVENT_OPTIONS.map(opt => (
                                                <SelectItem key={opt.value} value={opt.value} className="font-mono text-xs">
                                                    {opt.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Trigger Label <span className="text-muted-foreground font-normal">(optional)</span></Label>
                                    <Select value={triggerLabel} onValueChange={setTriggerLabel}>
                                        <SelectTrigger className="w-full text-xs">
                                            <SelectValue placeholder="Select trigger label..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {TRIGGER_LABEL_OPTIONS.map(opt => (
                                                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                                    {opt.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>

                        {/* Steps */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-foreground">Steps</h3>
                                <Button variant="ghost" size="sm" onClick={() => setSteps(prev => [...prev, emptyStep()])}>
                                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Step
                                </Button>
                            </div>
                            {steps.map((step, i) => (
                                <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-muted-foreground">Step {i + 1}</span>
                                        <button onClick={() => setSteps(prev => prev.filter((_, j) => j !== i))} className="text-xs text-muted-foreground hover:text-red-400 flex items-center gap-1 transition-colors">
                                            <X className="h-3 w-3" />
                                            Remove
                                        </button>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="grid grid-cols-2 gap-2">
                                            <Input value={step.label} onChange={e => updateStep(i, "label", e.target.value)} placeholder="Step label" className="text-xs" />
                                            <Select
                                                value={step.template_key}
                                                onValueChange={val => updateStep(i, "template_key", val)}
                                            >
                                                <SelectTrigger className="text-xs">
                                                    <SelectValue placeholder="Select template..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {campaigns.map(c => (
                                                        <SelectItem key={c.id} value={c.id} className="text-xs">
                                                            {c.name}
                                                        </SelectItem>
                                                    ))}

                                                </SelectContent>
                                            </Select>
                                        </div>
                                        {(() => {
                                            const parsedNum = parseInt(step.wait_after) || 0
                                            const parsedUnit = step.wait_after.replace(/^\d+\s*/, "").replace(/\s*\(.*\)/, "") || "days"
                                            return (
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs text-muted-foreground whitespace-nowrap">Wait</span>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        value={parsedNum || ""}
                                                        onChange={e => {
                                                            const num = e.target.value
                                                            updateStep(i, "wait_after", num ? `${num} ${parsedUnit}` : "")
                                                        }}
                                                        placeholder="0"
                                                        className="text-xs w-16"
                                                    />
                                                    <Select
                                                        value={parsedUnit}
                                                        onValueChange={unit => {
                                                            updateStep(i, "wait_after", `${parsedNum} ${unit}`)
                                                        }}
                                                    >
                                                        <SelectTrigger className="w-[90px] text-xs">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="minutes" className="text-xs">minutes</SelectItem>
                                                            <SelectItem value="hours" className="text-xs">hours</SelectItem>
                                                            <SelectItem value="days" className="text-xs">days</SelectItem>
                                                            <SelectItem value="weeks" className="text-xs">weeks</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            )
                                        })()}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Branches */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-foreground">Branches <span className="font-normal text-muted-foreground">(optional)</span></h3>
                                <Button variant="ghost" size="sm" onClick={() => setBranches(prev => [...prev, emptyBranch()])}>
                                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Branch
                                </Button>
                            </div>
                            {branches.length > 0 && (
                                <div className="space-y-2">
                                    <div className="space-y-2">
                                        <Label className="text-xs">Branch Description</Label>
                                        <Input
                                            value={branches[0]?.description || ""}
                                            onChange={e => {
                                                const desc = e.target.value
                                                setBranches(prev => prev.map(b => ({ ...b, description: desc })))
                                            }}
                                            placeholder="After N emails, checks engagement..."
                                            className="text-xs"
                                        />
                                    </div>
                                </div>
                            )}
                            {branches.map((branch, i) => (
                                <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-muted-foreground">Branch {i + 1}</span>
                                        <button onClick={() => setBranches(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-red-400">
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <Input value={branch.label} onChange={e => updateBranch(i, "label", e.target.value)} placeholder="Label" className="text-xs" />
                                        <Input value={branch.condition} onChange={e => updateBranch(i, "condition", e.target.value)} placeholder="Condition" className="text-xs" />
                                        <Input value={branch.action} onChange={e => updateBranch(i, "action", e.target.value)} placeholder="Action" className="text-xs" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    {isDraftMode ? (
                        <Button onClick={handleSubmit} disabled={!draftHasValidStep || loading}>
                            {loading ? "Saving..." : isEditingDraft ? "Save Changes" : "Create Draft Chain"}
                        </Button>
                    ) : (
                        <Button onClick={handleSubmit} disabled={!name.trim() || !triggerEvent.trim() || loading}>
                            {loading ? "Saving..." : editingChain ? "Save Changes" : "Create Chain"}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ─── PROCESS STATUS BADGE ──────────────────────────────────
function ProcessStatusBadge({ status }: { status: string }) {
    const styles: Record<string, string> = {
        active: "text-emerald-400 border-emerald-500/50 bg-emerald-500/10",
        paused: "text-amber-400 border-amber-500/50 bg-amber-500/10",
        cancelled: "text-red-400 border-red-500/50 bg-red-500/10",
        completed: "text-blue-400 border-blue-500/50 bg-blue-500/10",
    }
    return (
        <Badge variant="outline" className={`capitalize ${styles[status] || ""}`}>
            {status}
        </Badge>
    )
}

// ─── COUNTDOWN HELPER ──────────────────────────────────────
function formatCountdown(nextStepAt: string | null): string | null {
    if (!nextStepAt) return null
    const diff = new Date(nextStepAt).getTime() - Date.now()
    if (diff <= 0) return "Processing soon..."
    const days = Math.floor(diff / 86400000)
    const hours = Math.floor((diff % 86400000) / 3600000)
    const minutes = Math.floor((diff % 3600000) / 60000)
    if (days > 0) return `${days}d ${hours}h remaining`
    if (hours > 0) return `${hours}h ${minutes}m remaining`
    return `${minutes}m remaining`
}

// ─── CHAIN PROCESS CARD ────────────────────────────────────
function ChainProcessCard({
    process,
    onStatusChange,
}: {
    process: ChainProcess
    onStatusChange: (processId: string, newStatus: "active" | "paused" | "cancelled") => void
}) {
    const [expanded, setExpanded] = useState(false)
    const [updating, setUpdating] = useState(false)
    const [kicking, setKicking] = useState(false)
    const { toast } = useToast()

    const handleStatusChange = async (newStatus: "active" | "paused" | "cancelled") => {
        setUpdating(true)
        onStatusChange(process.id, newStatus)
        setUpdating(false)
    }

    const countdown = formatCountdown(process.next_step_at)
    const totalSteps = process.chain_steps?.length || 0
    const progress = totalSteps > 0 ? Math.round((process.current_step_index / totalSteps) * 100) : 0
    const isTerminal = process.status === "cancelled" || process.status === "completed"

    return (
        <Card className="border-border">
            <CardContent className="p-5">
                {/* Header Row */}
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <GitBranch className="h-4 w-4 text-amber-500 flex-shrink-0" />
                            <h3 className="font-semibold text-foreground truncate">{process.chain_name}</h3>
                            <ProcessStatusBadge status={process.status} />
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <User className="h-3.5 w-3.5" />
                            <span>{process.subscriber_first_name ? `${process.subscriber_first_name} — ` : ""}{process.subscriber_email}</span>
                        </div>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        {!isTerminal && (
                            <>
                                {process.status === "active" ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleStatusChange("paused")}
                                        disabled={updating}
                                        className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                                    >
                                        <Pause className="h-3.5 w-3.5 mr-1" /> Pause
                                    </Button>
                                ) : process.status === "paused" ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleStatusChange("active")}
                                        disabled={updating}
                                        className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                                    >
                                        <Play className="h-3.5 w-3.5 mr-1" /> Resume
                                    </Button>
                                ) : null}
                                {process.status === "active" && process.next_step_at && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={async () => {
                                            setKicking(true)
                                            const result = await kickChainStep(process.id)
                                            setKicking(false)
                                            if (result.success) {
                                                toast({ title: "Step kicked", description: `Sent "${result.stepLabel}" immediately.${result.completed ? " Chain completed!" : ""}` })
                                                onStatusChange(process.id, result.completed ? "completed" as any : "active")
                                            } else {
                                                toast({ title: "Kick failed", description: result.error, variant: "destructive" })
                                            }
                                        }}
                                        disabled={kicking}
                                        className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
                                    >
                                        {kicking ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <SkipForward className="h-3.5 w-3.5 mr-1" />}
                                        Kick
                                    </Button>
                                )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleStatusChange("cancelled")}
                                    disabled={updating}
                                    className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                                >
                                    <XCircle className="h-3.5 w-3.5 mr-1" /> Cancel
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>Step {process.current_step_index} of {totalSteps}</span>
                        <span>{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all ${process.status === "completed" ? "bg-blue-500" :
                                process.status === "cancelled" ? "bg-red-500" :
                                    process.status === "paused" ? "bg-amber-500" : "bg-emerald-500"
                                }`}
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>

                {/* Countdown */}
                {countdown && process.status === "active" && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
                        <Timer className="h-3.5 w-3.5" />
                        {countdown}
                    </div>
                )}

                {/* Expandable Timeline */}
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {expanded ? "Hide" : "Show"} History ({process.history?.length || 0} events)
                </button>

                {expanded && process.history && process.history.length > 0 && (
                    <div className="mt-3 ml-2 border-l-2 border-muted pl-4 space-y-2">
                        {process.history.map((entry: ChainProcessHistoryEntry, idx: number) => (
                            <div key={idx} className="relative">
                                <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 border-muted bg-background" />
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-foreground">{entry.action}</span>
                                    {entry.step_name !== "System" && (
                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{entry.step_name}</Badge>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] text-muted-foreground">
                                        {new Date(entry.timestamp).toLocaleString()}
                                    </span>
                                    {entry.details && (
                                        <span className="text-[10px] text-muted-foreground">— {entry.details}</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Upcoming Steps Preview */}
                {!isTerminal && totalSteps > 0 && process.current_step_index < totalSteps && (
                    <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Upcoming</p>
                        <div className="space-y-1">
                            {process.chain_steps!.slice(process.current_step_index).map((step: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Mail className="h-3 w-3" />
                                    <span>{step.label}</span>
                                    {step.wait_after && (
                                        <span className="text-[10px] text-muted-foreground/60">→ wait {step.wait_after}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Started date */}
                <p className="mt-3 text-[10px] text-muted-foreground">
                    Started {new Date(process.created_at).toLocaleString()}
                </p>
            </CardContent>
        </Card>
    )
}

// ─── MAIN PAGE ─────────────────────────────────────────────
export default function ChainsPage() {
    const { workspace } = useParams<{ workspace: string }>()
    const [chains, setChains] = useState<ChainRow[]>([])
    const [loading, setLoading] = useState(true)
    const [formOpen, setFormOpen] = useState(false)
    const [editingChain, setEditingChain] = useState<ChainRow | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<ChainRow | null>(null)
    const [deleting, setDeleting] = useState(false)
    const [forceDraftMode, setForceDraftMode] = useState(false)
    const [activeTab, setActiveTab] = useState<"journeys" | "templates" | "running" | "drafts">("journeys")
    const [processes, setProcesses] = useState<ChainProcess[]>([])
    const [loadingProcesses, setLoadingProcesses] = useState(false)
    const [pausingAll, setPausingAll] = useState(false)
    const [resumingAll, setResumingAll] = useState(false)
    // Draft chains state
    const [draftChains, setDraftChains] = useState<ChainRow[]>([])
    const [loadingDrafts, setLoadingDrafts] = useState(false)
    // Subscriber context for creating draft chains
    const [draftSubscriberId, setDraftSubscriberId] = useState<string | null>(null)
    const [draftSubscriberName, setDraftSubscriberName] = useState<string>("")
    const { toast } = useToast()

    const fetchChains = useCallback(async () => {
        const { data, error } = await getChains(workspace)
        if (error) {
            toast({ title: "Error", description: error, variant: "destructive" })
        } else {
            setChains(data || [])
        }
        setLoading(false)
    }, [toast])

    const fetchProcesses = useCallback(async () => {
        setLoadingProcesses(true)
        const { data, error } = await getChainProcesses()
        if (error) {
            toast({ title: "Error loading processes", description: error, variant: "destructive" })
        } else {
            setProcesses(data)
        }
        setLoadingProcesses(false)
    }, [toast])

    useEffect(() => { fetchChains() }, [fetchChains])
    useEffect(() => {
        if (activeTab === "running") fetchProcesses()
    }, [activeTab, fetchProcesses])

    const handleSave = async (formData: ChainFormData, chainId?: string) => {
        // Inject subscriber_id if creating a draft chain from subscriber context
        const saveData = { ...formData }
        if (!chainId && draftSubscriberId) {
            saveData.subscriber_id = draftSubscriberId
        }

        if (chainId) {
            const { error } = await updateChain(workspace, chainId, saveData)
            if (error) {
                toast({ title: "Error updating chain", description: error, variant: "destructive" })
                return
            }
            toast({ title: "Chain updated", description: `"${formData.name}" has been updated.` })
        } else {
            const { error } = await createChain(workspace, saveData)
            if (error) {
                toast({ title: "Error creating chain", description: error, variant: "destructive" })
                return
            }
            if (draftSubscriberId) {
                toast({ title: "Draft chain created", description: `"${formData.name}" created for ${draftSubscriberName}. Find it in the Drafts tab.` })
            } else {
                toast({ title: "Chain created", description: `"${formData.name}" has been created.` })
            }
        }
        setDraftSubscriberId(null)
        setDraftSubscriberName("")
        fetchChains()
        if (activeTab === "drafts") fetchDrafts()
    }

    const handleDelete = async () => {
        if (!deleteTarget) return
        setDeleting(true)
        const { error } = await deleteChain(workspace, deleteTarget.id)
        if (error) {
            toast({ title: "Error deleting chain", description: error, variant: "destructive" })
        } else {
            toast({ title: "Chain deleted", description: `"${deleteTarget.name}" has been removed.` })
            fetchChains()
        }
        setDeleting(false)
        setDeleteTarget(null)
    }

    const handleProcessStatusChange = async (processId: string, newStatus: "active" | "paused" | "cancelled") => {
        const result = await updateProcessStatus(processId, newStatus)
        if (!result.success) {
            toast({ title: "Error", description: result.error || "Failed to update status", variant: "destructive" })
        } else {
            const actionLabel = newStatus === "active" ? "resumed" : newStatus === "paused" ? "paused" : "cancelled"
            toast({ title: `Chain ${actionLabel}` })
            fetchProcesses()
        }
    }

    const handlePauseAllChains = async () => {
        setPausingAll(true)
        const result = await pauseAllActiveProcesses()
        setPausingAll(false)

        if (!result.success) {
            toast({ title: "Error", description: result.error || "Failed to pause chains", variant: "destructive" })
            return
        }

        if (result.pausedCount === 0) {
            toast({ title: "No active chains", description: "All chains are already paused or completed." })
        } else {
            toast({ title: "All active chains paused", description: `Paused ${result.pausedCount} chain${result.pausedCount === 1 ? "" : "s"}.` })
        }
        fetchProcesses()
    }

    const handleResumeAllChains = async () => {
        setResumingAll(true)
        const result = await resumeAllPausedProcesses()
        setResumingAll(false)

        if (!result.success) {
            toast({ title: "Error", description: result.error || "Failed to resume chains", variant: "destructive" })
            return
        }

        if (result.resumedCount === 0) {
            toast({ title: "No paused chains", description: "All chains are already active or completed." })
        } else {
            toast({ title: "All paused chains resumed", description: `Resumed ${result.resumedCount} chain${result.resumedCount === 1 ? "" : "s"}.` })
        }
        fetchProcesses()
    }

    const activeProcesses = processes.filter(p => p.status === "active" || p.status === "paused")
    const activelyRunningProcesses = processes.filter(p => p.status === "active")
    const pausedProcesses = processes.filter(p => p.status === "paused")
    const completedProcesses = processes.filter(p => p.status === "completed" || p.status === "cancelled")

    // Fetch draft chains
    const fetchDrafts = useCallback(async () => {
        setLoadingDrafts(true)
        const { data } = await getDraftChains(workspace)
        setDraftChains(data || [])
        setLoadingDrafts(false)
    }, [])

    useEffect(() => {
        if (activeTab === "drafts") fetchDrafts()
    }, [activeTab, fetchDrafts])

    // Callback for "Start New Chain" from Customer Journeys tab
    const handleStartNewChain = (subscriberId: string, subscriberName: string) => {
        setDraftSubscriberId(subscriberId)
        setDraftSubscriberName(subscriberName)
        setEditingChain(null)
        setFormOpen(true)
    }

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Journeys</h1>
                    <p className="text-muted-foreground">
                        Design email chains from real customer context. Browse subscribers, see their history, and build journeys that fit.
                    </p>
                </div>
                {activeTab === "templates" && (
                    <Button onClick={() => { setEditingChain(null); setForceDraftMode(true); setFormOpen(true) }}>
                        <Plus className="h-4 w-4 mr-2" />
                        New Chain
                    </Button>
                )}
            </div>

            {/* Tab Bar */}
            <div className="flex gap-1 border-b border-border">
                <button
                    onClick={() => setActiveTab("journeys")}
                    className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${activeTab === "journeys" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                >
                    Customer Journeys
                    {activeTab === "journeys" && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D4AF37]" />
                    )}
                </button>
                <button
                    onClick={() => setActiveTab("templates")}
                    className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${activeTab === "templates" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                >
                    Master Chains
                    {chains.length > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">({chains.length})</span>
                    )}
                    {activeTab === "templates" && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D4AF37]" />
                    )}
                </button>
                <button
                    onClick={() => setActiveTab("running")}
                    className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${activeTab === "running" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                >
                    Running
                    {activeProcesses.length > 0 && (
                        <span className="ml-2 text-xs text-emerald-400">({activeProcesses.length})</span>
                    )}
                    {activeTab === "running" && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D4AF37]" />
                    )}
                </button>
                <button
                    onClick={() => setActiveTab("drafts")}
                    className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${activeTab === "drafts" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                >
                    Drafts
                    {draftChains.length > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">({draftChains.length})</span>
                    )}
                    {activeTab === "drafts" && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D4AF37]" />
                    )}
                </button>
            </div>

            {/* CUSTOMER JOURNEYS TAB */}
            {activeTab === "journeys" && <CustomerJourneysTab onStartNewChain={handleStartNewChain} />}

            {/* MASTER CHAINS TAB */}
            {activeTab === "templates" && (
                <div className="space-y-4">
                    {loading ? (
                        <div className="text-center py-12 text-muted-foreground">Loading chains...</div>
                    ) : chains.length === 0 ? (
                        <div className="text-center py-12">
                            <GitBranch className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                            <p className="text-muted-foreground">No chains yet. Create your first email chain to get started.</p>
                        </div>
                    ) : (
                        chains.map(chain => (
                            <ChainCard
                                key={chain.id}
                                chain={chain}
                                onEdit={(c) => { setEditingChain(c); setFormOpen(true) }}
                                onDelete={(c) => setDeleteTarget(c)}
                            />
                        ))
                    )}
                </div>
            )}

            {/* CURRENTLY RUNNING TAB */}
            {activeTab === "running" && (
                <div className="space-y-6">
                    {loadingProcesses ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : processes.length === 0 ? (
                        <div className="text-center py-12">
                            <GitBranch className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                            <p className="text-muted-foreground">No chain processes yet. Start a chain from the Audience page.</p>
                        </div>
                    ) : (
                        <>
                            {/* Active Processes */}
                            {activeProcesses.length > 0 && (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Active / Paused</h2>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={handlePauseAllChains}
                                                disabled={pausingAll || resumingAll || activelyRunningProcesses.length === 0}
                                                className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                                            >
                                                {pausingAll ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Pause className="h-3.5 w-3.5 mr-1" />}
                                                Pause All Chains
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={handleResumeAllChains}
                                                disabled={resumingAll || pausingAll || pausedProcesses.length === 0}
                                                className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                                            >
                                                {resumingAll ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                                                Resume All Chains
                                            </Button>
                                        </div>
                                    </div>
                                    {activeProcesses.map(p => (
                                        <ChainProcessCard key={p.id} process={p} onStatusChange={handleProcessStatusChange} />
                                    ))}
                                </div>
                            )}

                            {/* Completed / Cancelled */}
                            {completedProcesses.length > 0 && (
                                <div className="space-y-3">
                                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Completed / Cancelled</h2>
                                    {completedProcesses.map(p => (
                                        <ChainProcessCard key={p.id} process={p} onStatusChange={handleProcessStatusChange} />
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* DRAFTS TAB */}
            {activeTab === "drafts" && (
                <div className="space-y-4">
                    {loadingDrafts ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : draftChains.length === 0 ? (
                        <div className="text-center py-12">
                            <GitBranch className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                            <p className="text-muted-foreground">No draft chains yet.</p>
                            <p className="text-xs text-muted-foreground mt-1">Go to Customer Journeys, click a subscriber, and hit &quot;Start New Chain&quot; to create one.</p>
                        </div>
                    ) : (
                        draftChains.map(chain => {
                            const sub = chain.subscribers as any
                            const subName = sub?.first_name
                                ? `${sub.first_name} ${sub.last_name || ""}`.trim()
                                : sub?.email || "Unknown"
                            return (
                                <Card key={chain.id} className="border-border">
                                    <CardHeader className="pb-2">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <CardTitle className="text-base">{chain.name}</CardTitle>
                                                <CardDescription className="flex items-center gap-1.5 mt-1">
                                                    <User className="h-3 w-3" />
                                                    Draft for {subName}
                                                </CardDescription>
                                            </div>
                                            <div className="flex gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={async () => {
                                                        const result = await promoteDraftToMaster(chain.id)
                                                        if (result.error) {
                                                            toast({ title: "Error promoting chain", description: result.error, variant: "destructive" })
                                                        } else {
                                                            toast({ title: "Promoted to Master Chain", description: `"${chain.name}" is now a master chain.` })
                                                            fetchDrafts()
                                                            fetchChains()
                                                        }
                                                    }}
                                                    className="text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10"
                                                    title="Promote to Master Chain"
                                                >
                                                    <Star className="h-4 w-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" onClick={() => { setEditingChain(chain); setFormOpen(true) }}>
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(chain)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="pt-0">
                                        <div className="flex flex-wrap gap-2 items-center">
                                            {chain.chain_steps.map((step: any, i: number) => (
                                                <div key={i} className="flex items-center gap-2">
                                                    <Badge variant="secondary" className="text-xs">
                                                        {i + 1}. {step.label}
                                                    </Badge>
                                                    {step.wait_after && (
                                                        <span className="text-[10px] text-amber-400/70 flex items-center gap-0.5">
                                                            <Clock className="h-2.5 w-2.5" />
                                                            {step.wait_after}
                                                        </span>
                                                    )}
                                                    {i < chain.chain_steps.length - 1 && (
                                                        <span className="text-muted-foreground/30">→</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                        {chain.description && (
                                            <p className="text-xs text-muted-foreground mt-2">{chain.description}</p>
                                        )}
                                    </CardContent>
                                </Card>
                            )
                        })
                    )}
                </div>
            )}

            {/* Create/Edit Dialog */}
            <ChainFormDialog
                open={formOpen}
                onOpenChange={(open) => {
                    setFormOpen(open)
                    if (!open) {
                        setDraftSubscriberId(null)
                        setDraftSubscriberName("")
                        setForceDraftMode(false)
                    }
                }}
                editingChain={editingChain}
                onSave={handleSave}
                subscriberName={draftSubscriberName || undefined}
                forceDraftMode={forceDraftMode}
                workspace={workspace}
            />

            {/* Delete Confirmation */}
            <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently remove this chain and all its steps and branches. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            disabled={deleting}
                            className="bg-destructive text-white hover:bg-destructive/90"
                        >
                            {deleting ? "Deleting..." : "Delete Chain"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
