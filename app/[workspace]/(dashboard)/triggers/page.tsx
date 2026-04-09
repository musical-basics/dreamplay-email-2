"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Zap, Plus, Trash2, Power, Loader2, TicketPercent, Mail, Pencil, Save, X, GitBranch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { getTriggers, createTrigger, updateTrigger, deleteTrigger, type EmailTrigger } from "@/app/actions/triggers"
import { getTags, type TagDefinition } from "@/app/actions/tags"
import { createClient } from "@/lib/supabase/client"

interface CampaignOption {
    id: string
    name: string
}

interface ChainOption {
    id: string
    name: string
}

export default function TriggersPage() {
    const { workspace } = useParams<{ workspace: string }>()
    const [triggers, setTriggers] = useState<EmailTrigger[]>([])
    const [automatedEmails, setAutomatedEmails] = useState<CampaignOption[]>([])
    const [chains, setChains] = useState<ChainOption[]>([])
    const [availableTags, setAvailableTags] = useState<TagDefinition[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState<string | null>(null)
    const [deleting, setDeleting] = useState<string | null>(null)
    const [showCreate, setShowCreate] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const { toast } = useToast()

    // New trigger form state
    const [newName, setNewName] = useState("")
    const [newTriggerValue, setNewTriggerValue] = useState("")
    const [newActionType, setNewActionType] = useState<"send_automated_email" | "start_chain">("send_automated_email")
    const [newCampaignId, setNewCampaignId] = useState("")
    const [newChainId, setNewChainId] = useState("")
    const [newGenerateDiscount, setNewGenerateDiscount] = useState(false)
    const [newDiscountType, setNewDiscountType] = useState<"fixed_amount" | "percentage">("fixed_amount")
    const [newDiscountValue, setNewDiscountValue] = useState(300)
    const [newDiscountDays, setNewDiscountDays] = useState(30)
    const [newDiscountPrefix, setNewDiscountPrefix] = useState("SAVE300")
    const [newDiscountLimit, setNewDiscountLimit] = useState(1)

    // Edit form state
    const [editName, setEditName] = useState("")
    const [editTriggerValue, setEditTriggerValue] = useState("")
    const [editActionType, setEditActionType] = useState<"send_automated_email" | "start_chain">("send_automated_email")
    const [editCampaignId, setEditCampaignId] = useState("")
    const [editChainId, setEditChainId] = useState("")
    const [editGenerateDiscount, setEditGenerateDiscount] = useState(false)
    const [editDiscountType, setEditDiscountType] = useState<"fixed_amount" | "percentage">("fixed_amount")
    const [editDiscountValue, setEditDiscountValue] = useState(300)
    const [editDiscountDays, setEditDiscountDays] = useState(30)
    const [editDiscountPrefix, setEditDiscountPrefix] = useState("SAVE300")
    const [editDiscountLimit, setEditDiscountLimit] = useState(1)

    const loadData = async () => {
        setLoading(true)
        const [triggerData, tagData] = await Promise.all([getTriggers(workspace), getTags(workspace)])

        // Fetch automated emails and chains for dropdowns
        const supabase = createClient()
        const [{ data: campaigns }, { data: chainData }] = await Promise.all([
            supabase.from("campaigns").select("id, name").eq("email_type", "automated").order("name"),
            supabase.from("email_chains").select("id, name").is("subscriber_id", null).or("is_snapshot.is.null,is_snapshot.eq.false").order("name"),
        ])

        setTriggers(triggerData)
        setAvailableTags(tagData.tags || [])
        setAutomatedEmails(campaigns || [])
        setChains(chainData || [])
        setLoading(false)
    }

    useEffect(() => { loadData() }, [])

    const resetCreateForm = () => {
        setNewName("")
        setNewTriggerValue("")
        setNewActionType("send_automated_email")
        setNewCampaignId("")
        setNewChainId("")
        setNewGenerateDiscount(false)
        setNewDiscountType("fixed_amount")
        setNewDiscountValue(300)
        setNewDiscountDays(30)
        setNewDiscountPrefix("SAVE300")
        setNewDiscountLimit(1)
    }

    const handleCreate = async () => {
        if (!newName.trim() || !newTriggerValue) {
            toast({ title: "Missing fields", description: "Name and trigger tag are required.", variant: "destructive" })
            return
        }
        if (newActionType === "send_automated_email" && !newCampaignId) {
            toast({ title: "Missing email", description: "Select an automated email to send.", variant: "destructive" })
            return
        }
        if (newActionType === "start_chain" && !newChainId) {
            toast({ title: "Missing journey", description: "Select a journey to start.", variant: "destructive" })
            return
        }
        setSaving("new")
        try {
            await createTrigger(workspace, {
                name: newName.trim(),
                trigger_type: "subscriber_tag",
                trigger_value: newTriggerValue,
                action_type: newActionType,
                campaign_id: newActionType === "send_automated_email" ? newCampaignId : null,
                chain_id: newActionType === "start_chain" ? newChainId : null,
                generate_discount: newGenerateDiscount,
                discount_config: newGenerateDiscount ? {
                    type: newDiscountType,
                    value: newDiscountValue,
                    durationDays: newDiscountDays,
                    codePrefix: newDiscountPrefix,
                    usageLimit: newDiscountLimit,
                } : null,
                is_active: true,
            })
            toast({ title: "Trigger created", description: `"${newName}" is now active.` })
            setShowCreate(false)
            resetCreateForm()
            await loadData()
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        }
        setSaving(null)
    }

    const startEdit = (trigger: EmailTrigger) => {
        setEditingId(trigger.id)
        setEditName(trigger.name)
        setEditTriggerValue(trigger.trigger_value)
        setEditActionType(trigger.chain_id ? "start_chain" : "send_automated_email")
        setEditCampaignId(trigger.campaign_id || "")
        setEditChainId(trigger.chain_id || "")
        setEditGenerateDiscount(trigger.generate_discount)
        setEditDiscountType(trigger.discount_config?.type || "fixed_amount")
        setEditDiscountValue(trigger.discount_config?.value || 300)
        setEditDiscountDays(trigger.discount_config?.durationDays || 30)
        setEditDiscountPrefix(trigger.discount_config?.codePrefix || "SAVE300")
        setEditDiscountLimit(trigger.discount_config?.usageLimit || 1)
    }

    const handleSaveEdit = async (triggerId: string) => {
        if (!editName.trim() || !editTriggerValue) {
            toast({ title: "Missing fields", description: "Name and trigger tag are required.", variant: "destructive" })
            return
        }
        setSaving(triggerId)
        try {
            await updateTrigger(workspace, triggerId, {
                name: editName.trim(),
                trigger_value: editTriggerValue,
                action_type: editActionType,
                campaign_id: editActionType === "send_automated_email" ? (editCampaignId || null) : null,
                chain_id: editActionType === "start_chain" ? (editChainId || null) : null,
                generate_discount: editGenerateDiscount,
                discount_config: editGenerateDiscount ? {
                    type: editDiscountType,
                    value: editDiscountValue,
                    durationDays: editDiscountDays,
                    codePrefix: editDiscountPrefix,
                    usageLimit: editDiscountLimit,
                } : null,
            })
            toast({ title: "Trigger saved", description: `"${editName}" updated successfully.` })
            setEditingId(null)
            await loadData()
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        }
        setSaving(null)
    }

    const handleToggle = async (trigger: EmailTrigger) => {
        setSaving(trigger.id)
        try {
            await updateTrigger(workspace, trigger.id, { is_active: !trigger.is_active })
            await loadData()
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        }
        setSaving(null)
    }

    const handleDelete = async (trigger: EmailTrigger) => {
        if (!confirm(`Delete trigger "${trigger.name}"?`)) return
        setDeleting(trigger.id)
        try {
            await deleteTrigger(workspace, trigger.id)
            toast({ title: "Deleted", description: `"${trigger.name}" has been removed.` })
            await loadData()
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        }
        setDeleting(null)
    }

    // ─── Shared components ──────────────────────────────────

    const TagSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary cursor-pointer"
        >
            <option value="">— Select a tag —</option>
            {availableTags.map(tag => (
                <option key={tag.id} value={tag.name}>{tag.name}</option>
            ))}
        </select>
    )

    const ActionTypeToggle = ({ value, onChange }: { value: "send_automated_email" | "start_chain"; onChange: (v: "send_automated_email" | "start_chain") => void }) => (
        <div className="flex rounded-lg border border-border overflow-hidden">
            <button
                type="button"
                onClick={() => onChange("send_automated_email")}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold transition-colors ${value === "send_automated_email"
                    ? "bg-primary/10 text-primary border-r border-border"
                    : "bg-background text-muted-foreground hover:bg-muted/50 border-r border-border"
                    }`}
            >
                <Mail className="w-3.5 h-3.5" />
                Send Email
            </button>
            <button
                type="button"
                onClick={() => onChange("start_chain")}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold transition-colors ${value === "start_chain"
                    ? "bg-violet-500/10 text-violet-400"
                    : "bg-background text-muted-foreground hover:bg-muted/50"
                    }`}
            >
                <GitBranch className="w-3.5 h-3.5" />
                Start Journey
            </button>
        </div>
    )

    const CampaignSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <div>
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary cursor-pointer"
            >
                <option value="">— No email linked yet —</option>
                {automatedEmails.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
            {automatedEmails.length === 0 && (
                <p className="text-xs text-amber-400 mt-1">No automated emails found. Create one first from the Automated Emails page.</p>
            )}
        </div>
    )

    const ChainSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <div>
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary cursor-pointer"
            >
                <option value="">— No journey linked yet —</option>
                {chains.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
            {chains.length === 0 && (
                <p className="text-xs text-amber-400 mt-1">No journeys found. Create one first from the Journeys page.</p>
            )}
        </div>
    )

    const DiscountConfig = ({
        enabled, onToggle,
        type, onTypeChange,
        value, onValueChange,
        days, onDaysChange,
        prefix, onPrefixChange,
        limit, onLimitChange,
    }: {
        enabled: boolean; onToggle: (v: boolean) => void
        type: "fixed_amount" | "percentage"; onTypeChange: (v: "fixed_amount" | "percentage") => void
        value: number; onValueChange: (v: number) => void
        days: number; onDaysChange: (v: number) => void
        prefix: string; onPrefixChange: (v: string) => void
        limit: number; onLimitChange: (v: number) => void
    }) => (
        <div className="border-t border-border pt-4 space-y-3">
            <div className="flex items-center gap-3">
                <Switch checked={enabled} onCheckedChange={onToggle} />
                <Label className="text-sm font-medium cursor-pointer" onClick={() => onToggle(!enabled)}>
                    Generate Shopify discount code
                </Label>
            </div>
            {enabled && (
                <div className="grid grid-cols-2 gap-3 pl-2 border-l-2 border-primary/20 ml-1">
                    <div className="space-y-1">
                        <Label className="text-xs">Type</Label>
                        <select value={type} onChange={e => onTypeChange(e.target.value as any)} className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm">
                            <option value="fixed_amount">Fixed Amount ($)</option>
                            <option value="percentage">Percentage (%)</option>
                        </select>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Value</Label>
                        <Input type="number" value={value} onChange={e => onValueChange(Number(e.target.value))} />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Code Prefix</Label>
                        <Input value={prefix} onChange={e => onPrefixChange(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Valid Days</Label>
                        <Input type="number" value={days} onChange={e => onDaysChange(Number(e.target.value))} />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Usage Limit</Label>
                        <Input type="number" value={limit} onChange={e => onLimitChange(Number(e.target.value))} />
                    </div>
                </div>
            )}
        </div>
    )

    if (loading) {
        return (
            <div className="p-6 flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading triggers...
            </div>
        )
    }

    return (
        <div className="p-6 space-y-6 max-w-4xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Triggers</h1>
                    <p className="text-muted-foreground mt-1">
                        Connect incoming events to automated emails or journeys.
                    </p>
                </div>
                <Button onClick={() => { setShowCreate(!showCreate); setEditingId(null) }}>
                    <Plus className="mr-2 h-4 w-4" />
                    New Trigger
                </Button>
            </div>

            {/* Create Form */}
            {showCreate && (
                <div className="border border-border rounded-lg p-6 bg-card space-y-4">
                    <h3 className="font-semibold text-foreground">Create New Trigger</h3>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label className="text-xs">Trigger Name</Label>
                            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g., $300 Off Discount Email" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">When subscriber tagged with</Label>
                            <TagSelect value={newTriggerValue} onChange={setNewTriggerValue} />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-xs">Then do</Label>
                        <ActionTypeToggle value={newActionType} onChange={setNewActionType} />
                        {newActionType === "send_automated_email" ? (
                            <CampaignSelect value={newCampaignId} onChange={setNewCampaignId} />
                        ) : (
                            <ChainSelect value={newChainId} onChange={setNewChainId} />
                        )}
                    </div>

                    <DiscountConfig
                        enabled={newGenerateDiscount} onToggle={setNewGenerateDiscount}
                        type={newDiscountType} onTypeChange={setNewDiscountType}
                        value={newDiscountValue} onValueChange={setNewDiscountValue}
                        days={newDiscountDays} onDaysChange={setNewDiscountDays}
                        prefix={newDiscountPrefix} onPrefixChange={setNewDiscountPrefix}
                        limit={newDiscountLimit} onLimitChange={setNewDiscountLimit}
                    />

                    <div className="flex gap-2 pt-2">
                        <Button onClick={handleCreate} disabled={saving === "new"}>
                            {saving === "new" ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Creating...</> : "Create Trigger"}
                        </Button>
                        <Button variant="outline" onClick={() => { setShowCreate(false); resetCreateForm() }}>Cancel</Button>
                    </div>
                </div>
            )}

            {/* Trigger List */}
            {triggers.length === 0 && !showCreate ? (
                <div className="border border-dashed border-border rounded-lg p-12 text-center">
                    <Zap className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No triggers configured yet.</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Create one to automatically send emails or start journeys when subscribers are tagged.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {triggers.map(trigger => {
                        const isEditing = editingId === trigger.id
                        const isChain = !!trigger.chain_id
                        return (
                            <div key={trigger.id} className={`border rounded-lg transition-colors ${trigger.is_active ? "border-border bg-card" : "border-border/50 bg-muted/30 opacity-70"}`}>
                                {isEditing ? (
                                    /* ─── Edit Mode ─── */
                                    <div className="p-5 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-semibold text-foreground text-sm">Editing Trigger</h3>
                                            <button onClick={() => setEditingId(null)} className="p-1 rounded hover:bg-muted text-muted-foreground">
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <Label className="text-xs">Trigger Name</Label>
                                                <Input value={editName} onChange={e => setEditName(e.target.value)} />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">When subscriber tagged with</Label>
                                                <TagSelect value={editTriggerValue} onChange={setEditTriggerValue} />
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <Label className="text-xs">Then do</Label>
                                            <ActionTypeToggle value={editActionType} onChange={setEditActionType} />
                                            {editActionType === "send_automated_email" ? (
                                                <CampaignSelect value={editCampaignId} onChange={setEditCampaignId} />
                                            ) : (
                                                <ChainSelect value={editChainId} onChange={setEditChainId} />
                                            )}
                                        </div>

                                        <DiscountConfig
                                            enabled={editGenerateDiscount} onToggle={setEditGenerateDiscount}
                                            type={editDiscountType} onTypeChange={setEditDiscountType}
                                            value={editDiscountValue} onValueChange={setEditDiscountValue}
                                            days={editDiscountDays} onDaysChange={setEditDiscountDays}
                                            prefix={editDiscountPrefix} onPrefixChange={setEditDiscountPrefix}
                                            limit={editDiscountLimit} onLimitChange={setEditDiscountLimit}
                                        />

                                        <div className="flex gap-2 pt-2 border-t border-border">
                                            <Button onClick={() => handleSaveEdit(trigger.id)} disabled={saving === trigger.id} className="gap-2">
                                                {saving === trigger.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                                {saving === trigger.id ? "Saving..." : "Save Changes"}
                                            </Button>
                                            <Button variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                                        </div>
                                    </div>
                                ) : (
                                    /* ─── View Mode ─── */
                                    <div className="p-4 flex items-center gap-4">
                                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${trigger.is_active ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />

                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-sm text-foreground truncate">{trigger.name}</p>
                                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                                                <span className="bg-primary/10 text-primary px-2 py-0.5 rounded font-mono">{trigger.trigger_value}</span>
                                                <span>→</span>
                                                {isChain ? (
                                                    <span className="flex items-center gap-1 text-violet-400">
                                                        <GitBranch className="w-3 h-3" />
                                                        {trigger.chain_name || <span className="italic text-amber-400">No journey linked</span>}
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1">
                                                        <Mail className="w-3 h-3" />
                                                        {trigger.campaign_name || <span className="italic text-amber-400">No email linked</span>}
                                                    </span>
                                                )}
                                                {trigger.generate_discount && (
                                                    <span className="flex items-center gap-1 text-violet-400">
                                                        <TicketPercent className="w-3 h-3" />
                                                        {trigger.discount_config?.type === "percentage"
                                                            ? `${trigger.discount_config.value}% off`
                                                            : `$${trigger.discount_config?.value} off`
                                                        }
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                            <button
                                                onClick={() => startEdit(trigger)}
                                                className="p-1.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                                title="Edit trigger"
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleToggle(trigger)}
                                                disabled={saving === trigger.id}
                                                className={`p-1.5 rounded transition-colors ${trigger.is_active ? "text-emerald-500 hover:bg-emerald-500/10" : "text-muted-foreground hover:bg-muted"}`}
                                                title={trigger.is_active ? "Deactivate" : "Activate"}
                                            >
                                                {saving === trigger.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                                            </button>
                                            <button
                                                onClick={() => handleDelete(trigger)}
                                                disabled={deleting === trigger.id}
                                                className="p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors"
                                                title="Delete trigger"
                                            >
                                                {deleting === trigger.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                            </button>
                                        </div>
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
