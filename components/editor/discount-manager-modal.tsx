"use client"

import { useState, useEffect, useMemo } from "react"
import { TicketPercent, Plus, Trash2, Loader2, Link2, Code2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog"
import { getActiveDiscountPresets, type DiscountPreset } from "@/app/actions/discount-presets"
import { createShopifyDiscount } from "@/app/actions/shopify-discount"
import { useToast } from "@/hooks/use-toast"
import { DEFAULT_WORKSPACE } from "@/lib/workspace"
import { cn } from "@/lib/utils"

export interface DiscountSlot {
    preset_id: string
    config: {
        type: "percentage" | "fixed_amount"
        value: number
        durationDays: number
        codePrefix: string
        expiresOn?: string
    }
    preview_code: string
    target_url_key: string     // which {{variable}} gets ?discount=CODE appended
    code_variable: string      // which {{variable}} displays the code text, e.g. "discount_code1"
    label: string              // human-readable, e.g. "$300 off (14 days)"
}

// Available code variable options
const CODE_VARIABLE_OPTIONS = [
    { value: "discount_code", label: "{{discount_code}}" },
    { value: "discount_code1", label: "{{discount_code1}}" },
    { value: "discount_code2", label: "{{discount_code2}}" },
    { value: "discount_code3", label: "{{discount_code3}}" },
]

interface DiscountManagerModalProps {
    assets: Record<string, any>
    onAssetsChange: (assets: Record<string, any>) => void
    templateVariables?: string[]
}

/**
 * Detect URL-like asset variables for the CTA link mapper dropdown.
 */
function getUrlEntries(assets: Record<string, any>): { key: string; value: string }[] {
    return Object.entries(assets)
        .filter(([key, value]) => {
            if (typeof value !== "string" && value !== undefined && value !== null && value !== "") return false
            const k = key.toLowerCase()
            const v = (typeof value === "string" ? value : "").toLowerCase()
            if (k.includes("discount") || k.includes("preset") || k.includes("slot") || k.includes("from_")) return false
            // Always include keys that look like URL variables by name
            if (k.includes("url") || k.includes("link") || k.includes("cta") || k.includes("href")) return true
            // Also include if the value looks like a URL
            if (v.startsWith("http") || v.includes(".com") || v.includes(".io")) return true
            return false
        })
        .map(([key, value]) => ({ key, value: (value as string) || "" }))
}

export function DiscountManagerModal({ assets, onAssetsChange, templateVariables = [] }: DiscountManagerModalProps) {
    const [open, setOpen] = useState(false)
    const [presets, setPresets] = useState<DiscountPreset[]>([])
    const [loadingPresets, setLoadingPresets] = useState(false)
    const [generatingId, setGeneratingId] = useState<string | null>(null)
    const { toast } = useToast()

    // Read current slots from assets
    const slots: DiscountSlot[] = useMemo(() => assets.discount_slots || [], [assets.discount_slots])

    // URL entries available for mapping — merge assets + unset template variables
    const urlEntries = useMemo(() => {
        const fromAssets = getUrlEntries(assets)
        const assetKeys = new Set(Object.keys(assets))
        // Include template variables that look URL-like but aren't in assets yet
        const fromTemplate = templateVariables
            .filter(v => {
                if (assetKeys.has(v)) return false
                const k = v.toLowerCase()
                if (k.includes("discount") || k.includes("preset") || k.includes("slot") || k.includes("from_")) return false
                return k.includes("url") || k.includes("link") || k.includes("cta") || k.includes("href")
            })
            .map(v => ({ key: v, value: "" }))
        return [...fromAssets, ...fromTemplate]
    }, [assets, templateVariables])

    // Load presets when modal opens
    useEffect(() => {
        if (open && presets.length === 0) {
            setLoadingPresets(true)
            getActiveDiscountPresets(DEFAULT_WORKSPACE)
                .then(setPresets)
                .catch(() => { })
                .finally(() => setLoadingPresets(false))
        }
    }, [open])

    // Which code variables are already taken by other slots
    const usedCodeVars = useMemo(() => new Set(slots.map(s => s.code_variable).filter(Boolean)), [slots])

    const updateSlots = (newSlots: DiscountSlot[]) => {
        const updated = { ...assets, discount_slots: newSlots }
        // Clean up legacy fields if present
        delete (updated as any).discount_preset_id
        delete (updated as any).discount_preset_config
        // Sync code variables from slots into assets
        syncCodeVariables(updated, newSlots)
        onAssetsChange(updated)
    }

    /**
     * Write each slot's preview_code to its mapped code_variable in assets.
     * Also clears any code variables that are no longer mapped.
     */
    const syncCodeVariables = (target: Record<string, any>, slotsArr: DiscountSlot[]) => {
        // Clear all possible code variable keys first
        for (const opt of CODE_VARIABLE_OPTIONS) {
            delete target[opt.value]
        }
        // Write mapped ones
        for (const slot of slotsArr) {
            if (slot.code_variable && slot.preview_code) {
                target[slot.code_variable] = slot.preview_code
            }
        }
    }

    const handleActivatePreset = async (preset: DiscountPreset) => {
        if (slots.length >= 3) {
            toast({ title: "Maximum 3 discounts", description: "Remove one before adding another.", variant: "destructive" })
            return
        }

        // Prevent duplicates
        if (slots.some(s => s.preset_id === preset.id)) {
            toast({ title: "Already added", description: `"${preset.name}" is already active.`, variant: "destructive" })
            return
        }

        setGeneratingId(preset.id)
        try {
            const res = await createShopifyDiscount({
                type: preset.type,
                value: preset.value,
                durationDays: preset.duration_days,
                codePrefix: preset.code_prefix,
                usageLimit: preset.code_mode === "per_user" ? 1 : preset.usage_limit,
                ...(preset.expiry_mode === "fixed_date" && preset.expires_on ? { expiresOn: preset.expires_on } : {}),
            })

            if (!res.success || !res.code) {
                toast({ title: "Error", description: res.error || "Failed to generate discount.", variant: "destructive" })
                setGeneratingId(null)
                return
            }

            const label = preset.type === "percentage" ? `${preset.value}% off` : `$${preset.value} off`
            const validity = preset.expiry_mode === "fixed_date" && preset.expires_on
                ? `expires ${preset.expires_on}`
                : `${preset.duration_days} days`

            // Auto-pick the first available code variable
            const autoCodeVar = CODE_VARIABLE_OPTIONS.find(o => !usedCodeVars.has(o.value))?.value || ""

            const newSlot: DiscountSlot & { code_mode: string } = {
                preset_id: preset.id,
                config: {
                    type: preset.type,
                    value: preset.value,
                    durationDays: preset.duration_days,
                    codePrefix: preset.code_prefix,
                    ...(preset.expiry_mode === "fixed_date" && preset.expires_on ? { expiresOn: preset.expires_on } : {}),
                },
                preview_code: res.code,
                target_url_key: "",       // user must map this
                code_variable: autoCodeVar,
                label: `${label} (${validity})`,
                code_mode: preset.code_mode,
            }

            const newSlots = [...slots, newSlot]
            updateSlots(newSlots)

            if (preset.code_mode === "per_user") {
                toast({ title: "Preview Code Created", description: `${res.code} — ${label}. Each recipient gets a unique code at send time.` })
            } else {
                toast({ title: "Discount Code Created", description: `${res.code} — ${label}, ${validity}.` })
            }
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" })
        }
        setGeneratingId(null)
    }

    const handleRemoveSlot = (index: number) => {
        const slot = slots[index]
        const updated = { ...assets }
        // Remove ?discount= from any URL it was mapped to
        if (slot.target_url_key && updated[slot.target_url_key]) {
            const url = updated[slot.target_url_key] as string
            updated[slot.target_url_key] = url
                .replace(new RegExp(`[?&]discount=${slot.preview_code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '')
                .replace(/\?&/, '?')
                .replace(/\?$/, '')
        }
        const newSlots = slots.filter((_, i) => i !== index)
        updated.discount_slots = newSlots
        delete updated.discount_preset_id
        delete updated.discount_preset_config
        // Re-sync code variables
        syncCodeVariables(updated, newSlots)
        onAssetsChange(updated)
    }

    const handleMapUrl = (slotIndex: number, urlKey: string) => {
        const slot = slots[slotIndex]
        const updated = { ...assets }

        // Remove discount from previous URL if it was mapped
        if (slot.target_url_key && updated[slot.target_url_key]) {
            const oldUrl = updated[slot.target_url_key] as string
            updated[slot.target_url_key] = oldUrl
                .replace(new RegExp(`[?&]discount=${slot.preview_code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '')
                .replace(/\?&/, '?')
                .replace(/\?$/, '')
        }

        // Append discount to new URL
        if (urlKey && updated[urlKey]) {
            const baseUrl = updated[urlKey] as string
            if (baseUrl.includes("discount=")) {
                updated[urlKey] = baseUrl.replace(/discount=[^&]+/, `discount=${slot.preview_code}`)
            } else {
                const sep = baseUrl.includes("?") ? "&" : "?"
                updated[urlKey] = `${baseUrl}${sep}discount=${slot.preview_code}`
            }
        }

        // Update slot
        const newSlots = [...slots]
        newSlots[slotIndex] = { ...slot, target_url_key: urlKey }
        updated.discount_slots = newSlots
        onAssetsChange(updated)
    }

    const handleMapCodeVariable = (slotIndex: number, codeVar: string) => {
        const updated = { ...assets }
        const newSlots = [...slots]
        const slot = newSlots[slotIndex]

        // Clear old code variable if it was set
        if (slot.code_variable) {
            delete updated[slot.code_variable]
        }

        // Set new code variable
        newSlots[slotIndex] = { ...slot, code_variable: codeVar }
        if (codeVar && slot.preview_code) {
            updated[codeVar] = slot.preview_code
        }

        updated.discount_slots = newSlots
        onAssetsChange(updated)
    }

    // Presets not yet activated
    const availablePresets = presets.filter(p => !slots.some(s => s.preset_id === p.id))

    // Count active slots
    const slotCount = slots.length

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        "w-full flex items-center justify-center gap-2 border py-2 rounded text-xs font-semibold transition-colors cursor-pointer mt-2",
                        slotCount > 0
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                            : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
                    )}
                >
                    <TicketPercent className="w-3.5 h-3.5" />
                    {slotCount > 0 ? `${slotCount} Discount${slotCount > 1 ? "s" : ""} Active` : "Manage Discounts"}
                </button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <TicketPercent className="w-5 h-5 text-emerald-400" />
                        Email Discounts
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground text-sm">
                        Activate up to 3 discounts. Map each to a CTA link and a code variable.
                    </DialogDescription>
                </DialogHeader>

                {/* Active Slots */}
                <div className="space-y-3 mt-2">
                    {slots.length === 0 && (
                        <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
                            No discounts attached to this email yet.
                        </div>
                    )}

                    {slots.map((slot, i) => (
                        <div key={i} className="border border-border rounded-lg p-3 space-y-2 bg-card">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className={cn(
                                        "text-xs font-semibold px-2 py-0.5 rounded",
                                        slot.config.type === "percentage"
                                            ? "bg-emerald-500/10 text-emerald-400"
                                            : "bg-violet-500/10 text-violet-400"
                                    )}>
                                        {slot.label}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                        {(slot as any).code_mode === "per_user" ? "(per user)" : "(shared)"}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleRemoveSlot(i)}
                                    className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                    title="Remove discount"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            {/* Preview code */}
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground">Preview Code:</span>
                                <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded tracking-wider">
                                    {slot.preview_code}
                                </code>
                            </div>

                            {/* Code variable mapper */}
                            <div className="flex items-center gap-2">
                                <Code2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                <select
                                    value={slot.code_variable || ""}
                                    onChange={(e) => handleMapCodeVariable(i, e.target.value)}
                                    className="flex-1 bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer"
                                >
                                    <option value="">Select a code variable...</option>
                                    {CODE_VARIABLE_OPTIONS.map(opt => {
                                        const taken = usedCodeVars.has(opt.value) && slot.code_variable !== opt.value
                                        return (
                                            <option key={opt.value} value={opt.value} disabled={taken}>
                                                {opt.label}{taken ? " (in use)" : ""}
                                            </option>
                                        )
                                    })}
                                </select>
                            </div>
                            {!slot.code_variable && (
                                <p className="text-[10px] text-amber-500">⚠ Map this to a code variable so the code appears in your email.</p>
                            )}

                            {/* CTA Link mapper */}
                            <div className="flex items-center gap-2">
                                <Link2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                <select
                                    value={slot.target_url_key}
                                    onChange={(e) => handleMapUrl(i, e.target.value)}
                                    className="flex-1 bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer"
                                >
                                    <option value="">Select a CTA link...</option>
                                    {urlEntries.map(({ key, value }) => (
                                        <option key={key} value={key}>
                                            {`{{${key}}}`} → {value.length > 40 ? value.substring(0, 40) + "…" : value}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {!slot.target_url_key && (
                                <p className="text-[10px] text-amber-500">⚠ Map this discount to a link before sending.</p>
                            )}
                        </div>
                    ))}
                </div>

                {/* Add Discount section */}
                {slots.length < 3 && (
                    <div className="mt-4 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Add a Discount</p>
                        {loadingPresets ? (
                            <div className="flex items-center justify-center py-4">
                                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            </div>
                        ) : availablePresets.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2">
                                {presets.length === 0
                                    ? "No discount presets found. Create one in the Discounts page."
                                    : "All available presets are already active."}
                            </p>
                        ) : (
                            <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                {availablePresets.map(preset => {
                                    const label = preset.type === "percentage" ? `${preset.value}% off` : `$${preset.value} off`
                                    return (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            onClick={() => handleActivatePreset(preset)}
                                            disabled={generatingId === preset.id}
                                            className={cn(
                                                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-left disabled:opacity-40",
                                                preset.type === "percentage"
                                                    ? "border-emerald-500/20 hover:bg-emerald-500/5"
                                                    : "border-violet-500/20 hover:bg-violet-500/5"
                                            )}
                                        >
                                            {generatingId === preset.id
                                                ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />
                                                : <Plus className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                            }
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-medium text-foreground">
                                                    {preset.name}
                                                    <span className="ml-2 text-muted-foreground font-normal">{label}</span>
                                                </p>
                                                <p className="text-[10px] text-muted-foreground">
                                                    {preset.code_prefix}-XXXXXX · {preset.code_mode === "per_user" ? "per user" : "shared"} · {preset.duration_days} days
                                                </p>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
