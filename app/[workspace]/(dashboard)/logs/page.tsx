"use client"

import { useEffect, useState, useCallback } from "react"
import { ScrollText, RefreshCw, Trash2, Loader2, AlertCircle, AlertTriangle, Info, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { getTriggerLogs, clearTriggerLogs, type TriggerLog } from "@/app/actions/trigger-logs"

const levelConfig = {
    info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10", label: "INFO" },
    warn: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", label: "WARN" },
    error: { icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/10", label: "ERROR" },
    success: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "OK" },
}

export default function LogsPage() {
    const [logs, setLogs] = useState<TriggerLog[]>([])
    const [loading, setLoading] = useState(true)
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [filter, setFilter] = useState<string>("all")
    const { toast } = useToast()

    const loadLogs = useCallback(async () => {
        setLoading(true)
        const data = await getTriggerLogs(200)
        setLogs(data)
        setLoading(false)
    }, [])

    useEffect(() => { loadLogs() }, [loadLogs])

    // Auto-refresh every 5 seconds
    useEffect(() => {
        const interval = setInterval(async () => {
            const data = await getTriggerLogs(200)
            setLogs(data)
        }, 5000)
        return () => clearInterval(interval)
    }, [])

    const handleClear = async () => {
        if (!confirm("Clear all trigger logs?")) return
        try {
            await clearTriggerLogs()
            setLogs([])
            toast({ title: "Logs cleared" })
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        }
    }

    const filteredLogs = filter === "all" ? logs : logs.filter(l => l.level === filter)

    const formatTime = (ts: string) => {
        const d = new Date(ts)
        return d.toLocaleString("en-US", {
            month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            hour12: false,
        })
    }

    return (
        <div className="p-6 space-y-4 max-w-5xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Trigger Logs</h1>
                    <p className="text-muted-foreground mt-1">
                        Real-time log of webhook events and trigger execution.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={loadLogs} disabled={loading}>
                        <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleClear} className="text-red-400 hover:text-red-300">
                        <Trash2 className="w-4 h-4 mr-2" />
                        Clear
                    </Button>
                </div>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 border-b border-border pb-2">
                {[
                    { key: "all", label: "All", count: logs.length },
                    { key: "error", label: "Errors", count: logs.filter(l => l.level === "error").length },
                    { key: "warn", label: "Warnings", count: logs.filter(l => l.level === "warn").length },
                    { key: "success", label: "Success", count: logs.filter(l => l.level === "success").length },
                    { key: "info", label: "Info", count: logs.filter(l => l.level === "info").length },
                ].map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setFilter(tab.key)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${filter === tab.key
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            }`}
                    >
                        {tab.label}
                        {tab.count > 0 && (
                            <span className="ml-1.5 opacity-60">({tab.count})</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Log list */}
            {loading && logs.length === 0 ? (
                <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading logs...
                </div>
            ) : filteredLogs.length === 0 ? (
                <div className="border border-dashed border-border rounded-lg p-12 text-center">
                    <ScrollText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No logs yet.</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Logs will appear here when subscribers sign up and triggers execute.</p>
                </div>
            ) : (
                <div className="space-y-1">
                    {filteredLogs.map(log => {
                        const config = levelConfig[log.level] || levelConfig.info
                        const Icon = config.icon
                        const isExpanded = expandedId === log.id
                        const hasDetails = log.details && Object.keys(log.details).length > 0

                        return (
                            <div key={log.id} className={`rounded-lg border border-border/50 transition-colors ${config.bg}`}>
                                <button
                                    onClick={() => hasDetails && setExpandedId(isExpanded ? null : log.id)}
                                    className="w-full text-left px-3 py-2.5 flex items-start gap-3"
                                >
                                    <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.color}`} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-foreground">{log.event}</p>
                                        {log.details?.subscriber_email && (
                                            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{log.details.subscriber_email}</p>
                                        )}
                                        {log.details?.hint && (
                                            <p className="text-xs text-amber-400/80 mt-0.5">💡 {log.details.hint}</p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">{formatTime(log.created_at)}</span>
                                        {hasDetails && (
                                            isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />
                                        )}
                                    </div>
                                </button>
                                {isExpanded && hasDetails && (
                                    <div className="px-3 pb-3 pt-0 ml-7">
                                        <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto text-muted-foreground font-mono whitespace-pre-wrap">
                                            {JSON.stringify(log.details, null, 2)}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Auto-refresh indicator */}
            <p className="text-[10px] text-muted-foreground/40 text-center pt-2">
                Auto-refreshing every 5 seconds • Showing latest {filteredLogs.length} logs
            </p>
        </div>
    )
}
