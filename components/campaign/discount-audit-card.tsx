"use client"

import { TicketPercent, CheckCircle2, AlertCircle, Link2, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

interface DiscountAuditCardProps {
    variableValues: Record<string, any> | null
}

interface DiscountSlotDisplay {
    label: string
    preview_code: string
    target_url_key: string
    config: {
        type: string
        value: number
        durationDays: number
        codePrefix: string
    }
    code_mode: string
    target_url?: string
    has_discount_attached: boolean
}

export function DiscountAuditCard({ variableValues }: DiscountAuditCardProps) {
    const vars = variableValues || {}

    // Build slots list from new format or legacy
    const rawSlots: any[] = vars.discount_slots || []
    const legacyConfig = vars.discount_preset_config
    const legacyCode = vars.discount_code
    const legacyIsPerUser = !!vars.discount_preset_id && !!legacyConfig

    // Backward compat: wrap legacy into a slot (requires config — bare discount_code is vestigial)
    if (rawSlots.length === 0 && legacyCode && legacyConfig) {
        rawSlots.push({
            config: legacyConfig || {},
            preview_code: legacyCode,
            target_url_key: legacyConfig?.targetUrlKey || "",
            code_mode: legacyIsPerUser ? "per_user" : "all_users",
            label: legacyConfig
                ? `${legacyConfig.type === "percentage" ? `${legacyConfig.value}%` : `$${legacyConfig.value}`} off`
                : "Discount",
        })
    }

    if (rawSlots.length === 0) return null

    // Enrich slots with URL info
    const slots: DiscountSlotDisplay[] = rawSlots.map((slot: any) => {
        const targetUrl = slot.target_url_key ? vars[slot.target_url_key] : undefined
        const hasDiscount = targetUrl ? String(targetUrl).includes("discount=") : false
        return {
            label: slot.label || `${slot.config?.codePrefix || "DISCOUNT"}-XXXXXX`,
            preview_code: slot.preview_code || "",
            target_url_key: slot.target_url_key || "",
            config: slot.config || {},
            code_mode: slot.code_mode || "per_user",
            target_url: targetUrl,
            has_discount_attached: hasDiscount || !!slot.target_url_key,
        }
    })

    const unmappedSlots = slots.filter(s => !s.target_url_key)
    const hasIssues = unmappedSlots.length > 0

    return (
        <Card className="border-border bg-card">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium text-foreground">
                    <TicketPercent className="h-5 w-5 text-emerald-400" />
                    Discount Audit
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                        ({slots.length} slot{slots.length !== 1 ? "s" : ""})
                    </span>
                    {hasIssues ? (
                        <span className="ml-auto rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500">
                            Unmapped
                        </span>
                    ) : (
                        <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
                            Active
                        </span>
                    )}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                    Discount codes and link mapping overview.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {slots.map((slot, i) => (
                    <div key={i} className="border border-border rounded-lg p-3 space-y-2 bg-background/50">
                        <div className="flex items-center justify-between">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${slot.config.type === "percentage"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : "bg-violet-500/10 text-violet-400"
                                }`}>
                                {slot.label}
                            </span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${slot.code_mode === "per_user"
                                ? "bg-violet-500/10 text-violet-400"
                                : "bg-emerald-500/10 text-emerald-400"
                                }`}>
                                {slot.code_mode === "per_user" ? "Per User" : "Shared"}
                            </span>
                        </div>

                        {/* Preview code */}
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">Preview Code:</span>
                            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded tracking-wider">
                                {slot.preview_code}
                            </code>
                        </div>

                        {/* Per-user details */}
                        {slot.code_mode === "per_user" && slot.config.codePrefix && (
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <Clock className="w-3 h-3 text-violet-400 flex-shrink-0" />
                                <span>
                                    {slot.config.codePrefix}-XXXXXX · {slot.config.durationDays} days · 1 use each
                                </span>
                            </div>
                        )}

                        {/* Mapped URL */}
                        {slot.target_url_key ? (
                            <div className="flex items-start gap-2 text-[11px] bg-emerald-500/5 rounded px-2.5 py-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                                <div className="min-w-0">
                                    <span className="font-mono text-emerald-400">{"{{" + slot.target_url_key + "}}"}</span>
                                    {slot.target_url && (
                                        <p className="text-muted-foreground truncate mt-0.5">{slot.target_url}</p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-start gap-2 bg-amber-500/5 rounded px-2.5 py-1.5">
                                <AlertCircle className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                                <p className="text-[11px] text-amber-500/80">
                                    Not mapped to any CTA link. Go to the editor to map it.
                                </p>
                            </div>
                        )}
                    </div>
                ))}
            </CardContent>
        </Card>
    )
}
