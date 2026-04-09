"use client"

import { useEffect, useState, useRef } from "react"
import { useParams } from "next/navigation"
import { TicketPercent, Plus, Trash2, Save, Loader2, Power, ChevronDown, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import {
    getDiscountPresets,
    createDiscountPreset,
    updateDiscountPreset,
    deleteDiscountPreset,
    reorderDiscountPresets,
    type DiscountPreset
} from "@/app/actions/discount-presets"


type PresetDraft = Omit<DiscountPreset, "id" | "created_at"> & { id?: string }

export default function DiscountsPage() {
    const { workspace } = useParams<{ workspace: string }>()
    const [presets, setPresets] = useState<DiscountPreset[]>([])
    const [loading, setLoading] = useState(true)
    const [savingId, setSavingId] = useState<string | null>(null)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const { toast } = useToast()

    // Drafts for editing (keyed by id or "new-{idx}")
    const [drafts, setDrafts] = useState<Record<string, PresetDraft>>({})
    const [newPresets, setNewPresets] = useState<PresetDraft[]>([])

    // Drag state
    const [dragIndex, setDragIndex] = useState<number | null>(null)
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

    useEffect(() => {
        loadPresets()
    }, [])

    const loadPresets = async () => {
        try {
            const data = await getDiscountPresets(workspace)
            setPresets(data)
            const d: Record<string, PresetDraft> = {}
            data.forEach(p => { d[p.id] = { ...p } })
            setDrafts(d)
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }

    const addNew = () => {
        setNewPresets(prev => [...prev, {
            name: "",
            type: "percentage",
            value: 5,
            duration_days: 2,
            expiry_mode: "duration",
            expires_on: null,
            code_prefix: "VIP",
            target_url_key: "",
            usage_limit: 1,
            code_mode: "all_users",
            variant_id: null,
            sort_order: presets.length + newPresets.length,
            is_active: true,
        }])
    }

    const updateDraft = (id: string, field: string, value: any) => {
        setDrafts(prev => ({
            ...prev,
            [id]: { ...prev[id], [field]: value }
        }))
    }

    const updateNewPreset = (idx: number, field: string, value: any) => {
        setNewPresets(prev => {
            const updated = [...prev]
            updated[idx] = { ...updated[idx], [field]: value }
            return updated
        })
    }

    const handleSave = async (id: string) => {
        setSavingId(id)
        try {
            const draft = drafts[id]
            const { id: _id, ...rest } = draft as any
            await updateDiscountPreset(workspace, id, rest)
            toast({ title: "Saved", description: `"${draft.name}" updated.` })
            await loadPresets()
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        } finally {
            setSavingId(null)
        }
    }

    const handleCreate = async (idx: number) => {
        setSavingId(`new-${idx}`)
        try {
            const preset = newPresets[idx]
            if (!preset.name.trim()) {
                toast({ title: "Error", description: "Name is required.", variant: "destructive" })
                setSavingId(null)
                return
            }
            await createDiscountPreset(workspace, preset)
            toast({ title: "Created", description: `"${preset.name}" added.` })
            setNewPresets(prev => prev.filter((_, i) => i !== idx))
            await loadPresets()
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        } finally {
            setSavingId(null)
        }
    }

    const handleDelete = async (id: string, name: string) => {
        setDeletingId(id)
        try {
            await deleteDiscountPreset(workspace, id)
            toast({ title: "Deleted", description: `"${name}" removed.` })
            await loadPresets()
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        } finally {
            setDeletingId(null)
        }
    }

    const handleToggleActive = async (id: string) => {
        const draft = drafts[id]
        if (!draft) return
        const next = !draft.is_active
        updateDraft(id, "is_active", next)
        try {
            await updateDiscountPreset(workspace, id, { is_active: next })
            toast({ title: next ? "Enabled" : "Disabled", description: `"${draft.name}" is now ${next ? "active" : "inactive"}.` })
            await loadPresets()
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        }
    }

    // ─── Drag-and-drop handlers ──────────────────────────────
    const handleDragStart = (index: number) => {
        setDragIndex(index)
    }

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault()
        if (dragIndex === null || index === dragIndex) return
        setDragOverIndex(index)
    }

    const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault()
        if (dragIndex === null || dragIndex === dropIndex) {
            setDragIndex(null)
            setDragOverIndex(null)
            return
        }

        // Reorder locally first for instant feedback
        const reordered = [...presets]
        const [moved] = reordered.splice(dragIndex, 1)
        reordered.splice(dropIndex, 0, moved)
        setPresets(reordered)
        setDragIndex(null)
        setDragOverIndex(null)

        // Persist the new order
        try {
            await reorderDiscountPresets(workspace, reordered.map(p => p.id))
        } catch (e: any) {
            toast({ title: "Error", description: "Failed to save order.", variant: "destructive" })
            await loadPresets() // revert on failure
        }
    }

    const handleDragEnd = () => {
        setDragIndex(null)
        setDragOverIndex(null)
    }

    if (loading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                        <TicketPercent className="w-6 h-6 text-emerald-400" />
                        Discounts
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Design discount presets. Active ones appear as buttons in the email editor.
                    </p>
                </div>
                <Button onClick={addNew} className="gap-2">
                    <Plus className="w-4 h-4" />
                    Add Preset
                </Button>
            </div>

            <div className="space-y-2">
                {/* Existing presets */}
                {presets.map((preset, index) => {
                    const draft = drafts[preset.id] || preset
                    return (
                        <PresetCard
                            key={preset.id}
                            draft={draft}
                            onChange={(field, value) => updateDraft(preset.id, field, value)}
                            onSave={() => handleSave(preset.id)}
                            onDelete={() => handleDelete(preset.id, draft.name)}
                            onToggleActive={() => handleToggleActive(preset.id)}
                            saving={savingId === preset.id}
                            deleting={deletingId === preset.id}
                            // Drag props
                            isDragging={dragIndex === index}
                            isDragOver={dragOverIndex === index}
                            onDragStart={() => handleDragStart(index)}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDrop={(e) => handleDrop(e, index)}
                            onDragEnd={handleDragEnd}
                        />
                    )
                })}

                {/* New presets (unsaved) */}
                {newPresets.map((preset, idx) => (
                    <PresetCard
                        key={`new-${idx}`}
                        draft={preset}
                        isNew
                        onChange={(field, value) => updateNewPreset(idx, field, value)}
                        onSave={() => handleCreate(idx)}
                        onDelete={() => setNewPresets(prev => prev.filter((_, i) => i !== idx))}
                        saving={savingId === `new-${idx}`}
                        deleting={false}
                    />
                ))}

                {presets.length === 0 && newPresets.length === 0 && (
                    <Card className="border-dashed">
                        <CardContent className="flex flex-col items-center justify-center py-12">
                            <TicketPercent className="w-10 h-10 text-muted-foreground/30 mb-3" />
                            <p className="text-sm text-muted-foreground mb-4">No discount presets yet.</p>
                            <Button variant="outline" onClick={addNew} className="gap-2">
                                <Plus className="w-4 h-4" />
                                Create your first preset
                            </Button>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    )
}

// ─── Preset Card Component ──────────────────────────────────

function PresetCard({
    draft,
    isNew,
    onChange,
    onSave,
    onDelete,
    onToggleActive,
    saving,
    deleting,
    isDragging,
    isDragOver,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
}: {
    draft: PresetDraft
    isNew?: boolean
    onChange: (field: string, value: any) => void
    onSave: () => void
    onDelete: () => void
    onToggleActive?: () => void
    saving: boolean
    deleting: boolean
    isDragging?: boolean
    isDragOver?: boolean
    onDragStart?: () => void
    onDragOver?: (e: React.DragEvent) => void
    onDrop?: (e: React.DragEvent) => void
    onDragEnd?: () => void
}) {
    const [expanded, setExpanded] = useState(!!isNew)
    const typeLabel = draft.type === "percentage" ? "%" : "$"
    const previewCode = `${draft.code_prefix}-XXXXXX`
    const expiryMode = draft.expiry_mode || "duration"
    const valueLabel = draft.type === "percentage" ? `${draft.value}%` : `$${draft.value}`

    const durationMs = (draft.duration_days || 0) * 24 * 60 * 60 * 1000
    const previewExpiryDate = new Date(Date.now() + (isNaN(durationMs) ? 0 : durationMs))
    const previewExpiryStr = isNaN(previewExpiryDate.getTime()) ? "" : previewExpiryDate.toISOString().split("T")[0]
    const fixedDateStr = draft.expires_on || ""

    const toggleExpiryMode = () => {
        if (expiryMode === "duration") {
            onChange("expiry_mode", "fixed_date")
            onChange("expires_on", previewExpiryStr)
        } else {
            onChange("expiry_mode", "duration")
        }
    }

    const handleDateChange = (dateStr: string) => {
        if (!dateStr) return
        const date = new Date(dateStr)
        if (isNaN(date.getTime())) return
        onChange("expires_on", dateStr)
    }

    return (
        <div
            className={`border rounded-lg bg-card transition-all ${!draft.is_active && !isNew ? "opacity-50" : ""
                } ${isDragging ? "opacity-40 scale-[0.98] border-dashed" : "border-border"} ${isDragOver ? "border-emerald-400 bg-emerald-500/5" : ""
                }`}
            draggable={!isNew}
            onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move"
                onDragStart?.()
            }}
            onDragOver={(e) => onDragOver?.(e)}
            onDrop={(e) => onDrop?.(e)}
            onDragEnd={() => onDragEnd?.()}
        >
            {/* Collapsed row */}
            <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-muted/30 transition-colors rounded-lg"
                onClick={() => setExpanded(!expanded)}
            >
                {/* Drag handle */}
                {!isNew && (
                    <div
                        className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground flex-shrink-0 -ml-1"
                        onMouseDown={(e) => e.stopPropagation()}
                        title="Drag to reorder"
                    >
                        <GripVertical className="w-4 h-4" />
                    </div>
                )}
                <div className={`flex h-7 w-7 items-center justify-center rounded-md flex-shrink-0 ${draft.type === "percentage" ? "bg-emerald-500/10 text-emerald-400" : "bg-violet-500/10 text-violet-400"}`}>
                    <TicketPercent className="w-3.5 h-3.5" />
                </div>
                <span className="text-sm font-semibold text-foreground truncate min-w-0">
                    {draft.name || (isNew ? "New Preset" : "Untitled")}
                </span>
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${draft.type === "percentage" ? "bg-emerald-500/10 text-emerald-400" : "bg-violet-500/10 text-violet-400"}`}>
                    {valueLabel} off
                </span>
                <span className="text-[11px] text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded flex-shrink-0">
                    {previewCode}
                </span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${draft.code_mode === "per_user" ? "bg-violet-500/10 text-violet-400" : "bg-sky-500/10 text-sky-400"}`}>
                    {draft.code_mode === "per_user" ? "Per User" : "Shared"}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${expiryMode === "fixed_date" ? "bg-amber-500/10 text-amber-400" : "bg-muted text-muted-foreground"}`}>
                    {expiryMode === "fixed_date" ? `Exp ${fixedDateStr}` : `${draft.duration_days}d`}
                </span>
                <div className="flex-1" />
                <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    {!isNew && onToggleActive && (
                        <Button variant="ghost" size="icon"
                            className={`h-7 w-7 ${draft.is_active ? "text-emerald-400 hover:text-emerald-300" : "text-muted-foreground"}`}
                            onClick={onToggleActive}
                            title={draft.is_active ? "Active — click to disable" : "Inactive — click to enable"}
                        >
                            <Power className="w-3.5 h-3.5" />
                        </Button>
                    )}
                    <Button variant="ghost" size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-red-400"
                        onClick={onDelete} disabled={deleting}
                    >
                        {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </Button>
                </div>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${expanded ? "rotate-180" : ""}`} />
            </div>

            {/* Expanded settings */}
            {expanded && (
                <div className="px-4 pb-4 pt-1 border-t border-border">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Name</Label>
                            <Input value={draft.name} onChange={e => onChange("name", e.target.value)} placeholder="Preset name" className="h-9 text-sm font-semibold" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Type</Label>
                            <Select value={draft.type} onValueChange={v => onChange("type", v)}>
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="percentage">Percentage (%)</SelectItem>
                                    <SelectItem value="fixed_amount">Fixed Amount ($)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Value ({typeLabel})</Label>
                            <Input type="number" value={draft.value} onChange={e => onChange("value", Number(e.target.value))} min={1} className="h-9" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Code Prefix</Label>
                            <Input value={draft.code_prefix} onChange={e => onChange("code_prefix", e.target.value.toUpperCase())} placeholder="VIP" className="h-9 font-mono" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className={`text-xs ${expiryMode === "duration" ? "text-muted-foreground" : "text-muted-foreground/40"} flex items-center gap-1.5`}>
                                Duration (days)
                                <button type="button" onClick={toggleExpiryMode}
                                    className={`text-[9px] font-semibold px-1.5 py-0.5 rounded cursor-pointer transition-colors ${expiryMode === "fixed_date" ? "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"}`}
                                    title="Toggle between Duration and Fixed Date"
                                >
                                    {expiryMode === "fixed_date" ? "⏱ Fixed" : "⟳ Duration"}
                                </button>
                            </Label>
                            <Input type="number" value={draft.duration_days} onChange={e => onChange("duration_days", Math.max(1, Number(e.target.value)))} min={1}
                                className={`h-9 ${expiryMode !== "duration" ? "opacity-30" : ""}`} disabled={expiryMode !== "duration"}
                            />
                            {expiryMode === "duration" && <p className="text-[10px] text-muted-foreground/60">Expires ~{previewExpiryStr}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <Label className={`text-xs ${expiryMode === "fixed_date" ? "text-muted-foreground" : "text-muted-foreground/40"}`}>Expires on (fixed date)</Label>
                            <Input type="date" value={expiryMode === "fixed_date" ? fixedDateStr : ""} onChange={e => handleDateChange(e.target.value)}
                                className={`h-9 ${expiryMode !== "fixed_date" ? "opacity-30" : ""}`} disabled={expiryMode !== "fixed_date"}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Code Mode</Label>
                            <Select value={draft.code_mode || "all_users"} onValueChange={v => { onChange("code_mode", v); if (v === "per_user") onChange("usage_limit", 1) }}>
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all_users">All Users (shared code)</SelectItem>
                                    <SelectItem value="per_user">Per User (unique codes)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">
                                Usage Limit{draft.code_mode === "per_user" && <span className="text-[10px] text-amber-400 ml-1">(1 per code)</span>}
                            </Label>
                            <Input type="number" value={draft.code_mode === "per_user" ? 1 : draft.usage_limit}
                                onChange={e => onChange("usage_limit", Math.max(1, Number(e.target.value)))} min={1}
                                disabled={draft.code_mode === "per_user"} className={`h-9 ${draft.code_mode === "per_user" ? "opacity-50" : ""}`}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Variant ID <span className="text-[10px] text-muted-foreground/50">(optional)</span></Label>
                            <Input value={draft.variant_id || ""} onChange={e => onChange("variant_id", e.target.value || null)} placeholder="All products" className="h-9 font-mono text-xs" />
                        </div>
                    </div>
                    <div className="flex justify-end mt-4">
                        <Button onClick={onSave} disabled={saving} size="sm" className="gap-2">
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {isNew ? "Create" : "Save"}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
