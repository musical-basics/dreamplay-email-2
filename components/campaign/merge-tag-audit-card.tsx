"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tag, CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import { getMergeTagLogs, dryRunMergeTags, MergeTagLogData } from "@/app/actions/merge-tag-logs"
import type { MergeTagLog } from "@/lib/merge-tags"

interface MergeTagAuditCardProps {
    campaignId: string
    campaignStatus: string
    htmlContent?: string | null
    variableValues?: Record<string, any> | null
}

export function MergeTagAuditCard({ campaignId, campaignStatus, htmlContent, variableValues }: MergeTagAuditCardProps) {
    // Post-send state
    const [logs, setLogs] = useState<MergeTagLogData[]>([])
    const [expandedRecipient, setExpandedRecipient] = useState<string | null>(null)

    // Pre-send dry-run state
    const [dryRunLog, setDryRunLog] = useState<MergeTagLog | null>(null)
    const [dryRunEmail, setDryRunEmail] = useState<string>("")

    const [loading, setLoading] = useState(true)

    const isSent = campaignStatus === "completed" || campaignStatus === "active"

    useEffect(() => {
        setLoading(true)

        if (isSent) {
            // Post-send: fetch actual logs
            getMergeTagLogs(campaignId)
                .then(setLogs)
                .finally(() => setLoading(false))
        } else {
            // Pre-send: run dry-run simulation
            dryRunMergeTags(campaignId)
                .then(result => {
                    if (result) {
                        setDryRunLog(result.log)
                        setDryRunEmail(result.subscriber_email)
                    }
                })
                .finally(() => setLoading(false))
        }
    }, [campaignId, isSent])

    // ─── LOADING ───
    if (loading) {
        return (
            <Card className="border-border bg-card">
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base font-medium text-foreground">
                        <Tag className="h-5 w-5 text-[#D4AF37]" />
                        Merge Tag Audit
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Simulating merge tag resolution...
                    </div>
                </CardContent>
            </Card>
        )
    }

    // ─── PRE-SEND MODE: full dry-run results ───
    if (!isSent) {
        if (!dryRunLog || dryRunLog.entries.length === 0) {
            return (
                <Card className="border-border bg-card">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base font-medium text-foreground">
                            <Tag className="h-5 w-5 text-[#D4AF37]" />
                            Merge Tag Audit
                        </CardTitle>
                        <CardDescription className="text-muted-foreground">
                            No merge tags detected in template.
                        </CardDescription>
                    </CardHeader>
                </Card>
            )
        }

        const hasUnresolved = dryRunLog.tags_unresolved.length > 0

        return (
            <Card className="border-border bg-card">
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base font-medium text-foreground">
                        <Tag className="h-5 w-5 text-[#D4AF37]" />
                        Merge Tag Audit
                        {hasUnresolved ? (
                            <span className="ml-auto rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500">
                                {dryRunLog.tags_unresolved.length} Unresolved
                            </span>
                        ) : (
                            <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
                                Ready
                            </span>
                        )}
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                        Dry-run simulation using <span className="text-foreground font-medium">{dryRunEmail}</span> — {dryRunLog.tags_found.length} tag{dryRunLog.tags_found.length !== 1 ? "s" : ""} processed
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ul className="space-y-2">
                        {dryRunLog.entries.map((entry, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm">
                                {entry.resolved ? (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                                ) : (
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                                )}
                                <div className="min-w-0">
                                    <code className="text-xs px-1.5 py-0.5 bg-muted rounded font-mono text-foreground">
                                        {`{{${entry.tag}}}`}
                                    </code>
                                    <span className="text-xs text-muted-foreground ml-1">
                                        ({entry.category})
                                    </span>
                                    {entry.resolved ? (
                                        <div className="mt-0.5 text-xs text-muted-foreground">
                                            → <span className="text-foreground break-all">{entry.value.length > 80 ? entry.value.slice(0, 80) + "…" : entry.value}</span>
                                            <span className="text-muted-foreground/50 ml-1">via {entry.source}</span>
                                        </div>
                                    ) : (
                                        <span className="text-xs text-amber-500 ml-1">— {entry.source}</span>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                </CardContent>
            </Card>
        )
    }

    // ─── POST-SEND MODE: actual resolution logs ───

    if (logs.length === 0) {
        return (
            <Card className="border-border bg-card">
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base font-medium text-foreground">
                        <Tag className="h-5 w-5 text-[#D4AF37]" />
                        Merge Tag Audit Log
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                        No merge tag data recorded. This campaign may have been sent before this feature was added.
                    </CardDescription>
                </CardHeader>
            </Card>
        )
    }

    // Aggregate stats
    const allResolved = new Set<string>()
    const allUnresolved = new Set<string>()
    const allFound = new Set<string>()
    logs.forEach(l => {
        if (!l.merge_tag_log) return
        l.merge_tag_log.tags_found.forEach(t => allFound.add(t))
        Object.keys(l.merge_tag_log.tags_resolved).forEach(t => allResolved.add(t))
        l.merge_tag_log.tags_unresolved.forEach(t => allUnresolved.add(t))
    })

    const hasWarnings = allUnresolved.size > 0

    return (
        <Card className="border-border bg-card">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium text-foreground">
                    <Tag className="h-5 w-5 text-[#D4AF37]" />
                    Merge Tag Audit Log
                    {hasWarnings ? (
                        <span className="ml-auto rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500">
                            {allUnresolved.size} Unresolved
                        </span>
                    ) : (
                        <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
                            All Resolved
                        </span>
                    )}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                    {allFound.size} tag{allFound.size !== 1 ? "s" : ""} detected across {logs.length} recipient{logs.length !== 1 ? "s" : ""}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Summary */}
                <div className="space-y-2">
                    {Array.from(allFound).sort().map(tag => {
                        const isResolved = allResolved.has(tag)
                        const isUnresolved = allUnresolved.has(tag)
                        return (
                            <div key={tag} className="flex items-center gap-2 text-sm">
                                {isUnresolved ? (
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                ) : isResolved ? (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                ) : (
                                    <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                                )}
                                <code className="text-xs px-1.5 py-0.5 bg-muted rounded font-mono text-foreground">
                                    {`{{${tag}}}`}
                                </code>
                                {isUnresolved && (
                                    <span className="text-xs text-amber-500">— not registered or empty</span>
                                )}
                            </div>
                        )
                    })}
                </div>

                {/* Per-recipient details */}
                {logs.length > 0 && (
                    <div className="border-t border-border pt-3 mt-3">
                        <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Per-Recipient Detail</p>
                        <div className="space-y-1">
                            {logs.map(log => {
                                const isExpanded = expandedRecipient === log.subscriber_id
                                const entries = log.merge_tag_log?.entries || []
                                const unresolvedCount = entries.filter(e => !e.resolved).length

                                return (
                                    <div key={log.subscriber_id} className="border border-border/50 rounded-md overflow-hidden">
                                        <button
                                            onClick={() => setExpandedRecipient(isExpanded ? null : log.subscriber_id)}
                                            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                                        >
                                            {isExpanded ? (
                                                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            ) : (
                                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            )}
                                            <span className="text-sm text-foreground truncate">{log.subscriber_email}</span>
                                            {unresolvedCount > 0 && (
                                                <span className="ml-auto text-xs text-amber-500">{unresolvedCount} unresolved</span>
                                            )}
                                            {unresolvedCount === 0 && entries.length > 0 && (
                                                <span className="ml-auto text-xs text-emerald-500">✓</span>
                                            )}
                                        </button>
                                        {isExpanded && (
                                            <div className="px-3 pb-3 space-y-1.5 border-t border-border/30">
                                                {entries.map((entry, i) => (
                                                    <div key={i} className="flex items-start gap-2 text-xs mt-1.5">
                                                        {entry.resolved ? (
                                                            <CheckCircle2 className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
                                                        ) : (
                                                            <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                                                        )}
                                                        <div className="min-w-0">
                                                            <code className="text-foreground font-mono">{`{{${entry.tag}}}`}</code>
                                                            <span className="text-muted-foreground ml-1">
                                                                ({entry.category})
                                                            </span>
                                                            {entry.resolved ? (
                                                                <div className="mt-0.5">
                                                                    <span className="text-foreground break-all">{entry.value.length > 60 ? entry.value.slice(0, 60) + "…" : entry.value}</span>
                                                                    <span className="text-muted-foreground/50 ml-1">via {entry.source}</span>
                                                                </div>
                                                            ) : (
                                                                <span className="text-amber-500 ml-1">— {entry.source}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
