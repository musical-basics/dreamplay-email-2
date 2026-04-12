"use client"

import { useEffect, useState, useCallback } from "react"
import { ScrollText, RefreshCw, Trash2, Loader2, AlertCircle, AlertTriangle, Info, CheckCircle2, ChevronDown, ChevronUp, Mail, Clock, Send, Image } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { getTriggerLogs, clearTriggerLogs, type TriggerLog } from "@/app/actions/trigger-logs"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const levelConfig = {
    info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10", label: "INFO" },
    warn: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", label: "WARN" },
    error: { icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/10", label: "ERROR" },
    success: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "OK" },
}

type SendLog = {
    id: string
    campaign_id: string | null
    triggered_by: string
    status: string
    summary: { sent: number; failed: number; total: number } | null
    image_logs: Array<{ ts: string; level: string; message: string }> | null
    raw_log: string | null
    created_at: string
    campaigns?: { name: string } | null
}

function formatTime(ts: string) {
    return new Date(ts).toLocaleString("en-US", {
        month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
    })
}

function SendLogsTab() {
    const [logs, setLogs] = useState<SendLog[]>([])
    const [loading, setLoading] = useState(true)
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [tab, setTab] = useState<"all" | "scheduled" | "manual" | "rotation">("all")

    const load = useCallback(async () => {
        setLoading(true)
        const { data } = await supabase
            .from("send_logs")
            .select("*, campaigns(name)")
            .order("created_at", { ascending: false })
            .limit(100)
        setLogs((data as SendLog[]) ?? [])
        setLoading(false)
    }, [])

    useEffect(() => { load() }, [load])
    useEffect(() => {
        const interval = setInterval(load, 8000)
        return () => clearInterval(interval)
    }, [load])

    const filtered = tab === "all" ? logs : logs.filter(l => l.triggered_by === tab)

    return (
        <div className="space-y-4">
            {/* Filters */}
            <div className="flex items-center justify-between">
                <div className="flex gap-1">
                    {(["all", "manual", "scheduled", "rotation"] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                                tab === t
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            }`}
                        >
                            {t}
                            <span className="ml-1 opacity-50">
                                ({t === "all" ? logs.length : logs.filter(l => l.triggered_by === t).length})
                            </span>
                        </button>
                    ))}
                </div>
                <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
                    Refresh
                </Button>
            </div>

            {/* Log list */}
            {loading && logs.length === 0 ? (
                <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading send logs...
                </div>
            ) : filtered.length === 0 ? (
                <div className="border border-dashed border-border rounded-lg p-12 text-center">
                    <Mail className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No send logs yet.</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Logs appear here after campaigns are sent.</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {filtered.map(log => {
                        const isExpanded = expandedId === log.id
                        const statusColor = log.status === "success"
                            ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                            : log.status === "error"
                                ? "text-red-400 bg-red-500/10 border-red-500/20"
                                : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                        const triggerColor = log.triggered_by === "scheduled"
                            ? "text-violet-400 bg-violet-500/10"
                            : log.triggered_by === "rotation"
                                ? "text-sky-400 bg-sky-500/10"
                                : "text-zinc-400 bg-zinc-500/10"

                        const proxiedCount = log.image_logs
                            ? log.image_logs.filter(l => l.message.includes("✅") || l.message.includes("proxied")).length
                            : 0
                        const imageWarning = log.image_logs
                            ? log.image_logs.find(l => l.message.includes("⚠️") || l.message.includes("No images"))
                            : null

                        return (
                            <div key={log.id} className="rounded-lg border border-border/50 bg-card overflow-hidden">
                                <button
                                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                                    className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors"
                                >
                                    {/* Status badge */}
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border capitalize ${statusColor}`}>
                                        {log.status}
                                    </span>

                                    {/* Campaign name */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-foreground truncate">
                                            {(log.campaigns as any)?.name ?? log.campaign_id ?? "Unknown Campaign"}
                                        </p>
                                        {log.summary && (
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {log.summary.sent} sent · {log.summary.failed} failed · {log.summary.total} total
                                            </p>
                                        )}
                                    </div>

                                    {/* Image proxy status */}
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                        {imageWarning ? (
                                            <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                                <Image className="w-3 h-3" /> ⚠️ no proxy
                                            </span>
                                        ) : proxiedCount > 0 ? (
                                            <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                                <Image className="w-3 h-3" /> {proxiedCount} proxied
                                            </span>
                                        ) : null}
                                    </div>

                                    {/* Trigger type */}
                                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded capitalize flex-shrink-0 ${triggerColor}`}>
                                        {log.triggered_by === "scheduled" ? <Clock className="w-3 h-3 inline mr-0.5" /> : <Send className="w-3 h-3 inline mr-0.5" />}
                                        {log.triggered_by}
                                    </span>

                                    {/* Time */}
                                    <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap flex-shrink-0">
                                        {formatTime(log.created_at)}
                                    </span>

                                    {isExpanded
                                        ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
                                        : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
                                    }
                                </button>

                                {isExpanded && (
                                    <div className="border-t border-border/50 px-4 py-3 space-y-3">
                                        {/* Image proxy logs */}
                                        {log.image_logs && log.image_logs.length > 0 && (
                                            <div>
                                                <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                                                    <Image className="w-3.5 h-3.5" /> Image Proxy Decisions
                                                </p>
                                                <div className="space-y-1">
                                                    {log.image_logs.map((entry, i) => (
                                                        <div key={i} className={`text-xs font-mono px-2 py-1 rounded ${
                                                            entry.message.includes("✅") || entry.message.includes("Cache hit")
                                                                ? "text-emerald-400 bg-emerald-500/5"
                                                                : entry.message.includes("⚠️") || entry.message.includes("warn")
                                                                    ? "text-amber-400 bg-amber-500/5"
                                                                    : entry.message.includes("❌")
                                                                        ? "text-red-400 bg-red-500/5"
                                                                        : "text-muted-foreground bg-muted/30"
                                                        }`}>
                                                            {entry.message}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Full raw log */}
                                        {log.raw_log && (
                                            <details>
                                                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                                    Full raw log ({log.raw_log.split("\n").length} lines)
                                                </summary>
                                                <pre className="mt-2 text-[10px] bg-background/50 rounded p-3 overflow-x-auto text-muted-foreground font-mono whitespace-pre-wrap max-h-96 overflow-y-auto">
                                                    {log.raw_log}
                                                </pre>
                                            </details>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
            <p className="text-[10px] text-muted-foreground/40 text-center pt-2">
                Auto-refreshing every 8 seconds · Showing latest {filtered.length} of {logs.length} send logs
            </p>
        </div>
    )
}

export default function LogsPage() {
    const [activeTab, setActiveTab] = useState<"send" | "trigger">("send")
    const [triggerLogs, setTriggerLogs] = useState<TriggerLog[]>([])
    const [triggerLoading, setTriggerLoading] = useState(true)
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [filter, setFilter] = useState<string>("all")
    const { toast } = useToast()

    const loadTriggerLogs = useCallback(async () => {
        setTriggerLoading(true)
        const data = await getTriggerLogs(200)
        setTriggerLogs(data)
        setTriggerLoading(false)
    }, [])

    useEffect(() => { loadTriggerLogs() }, [loadTriggerLogs])
    useEffect(() => {
        const interval = setInterval(async () => {
            const data = await getTriggerLogs(200)
            setTriggerLogs(data)
        }, 5000)
        return () => clearInterval(interval)
    }, [])

    const handleClear = async () => {
        if (!confirm("Clear all trigger logs?")) return
        try {
            await clearTriggerLogs()
            setTriggerLogs([])
            toast({ title: "Logs cleared" })
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        }
    }

    const filteredTriggerLogs = filter === "all" ? triggerLogs : triggerLogs.filter(l => l.level === filter)

    return (
        <div className="p-6 space-y-4 max-w-5xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Logs</h1>
                    <p className="text-muted-foreground mt-1">
                        Send history, image proxy decisions, and trigger events.
                    </p>
                </div>
            </div>

            {/* Tab switcher */}
            <div className="flex gap-1 border-b border-border pb-0">
                <button
                    onClick={() => setActiveTab("send")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                        activeTab === "send"
                            ? "border-primary text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                >
                    <Mail className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                    Send Logs
                </button>
                <button
                    onClick={() => setActiveTab("trigger")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                        activeTab === "trigger"
                            ? "border-primary text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                >
                    <ScrollText className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                    Trigger Logs
                </button>
            </div>

            {/* Send Logs tab */}
            {activeTab === "send" && <SendLogsTab />}

            {/* Trigger Logs tab */}
            {activeTab === "trigger" && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex gap-1 border-b border-border pb-2">
                            {[
                                { key: "all", label: "All", count: triggerLogs.length },
                                { key: "error", label: "Errors", count: triggerLogs.filter(l => l.level === "error").length },
                                { key: "warn", label: "Warnings", count: triggerLogs.filter(l => l.level === "warn").length },
                                { key: "success", label: "Success", count: triggerLogs.filter(l => l.level === "success").length },
                                { key: "info", label: "Info", count: triggerLogs.filter(l => l.level === "info").length },
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
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={loadTriggerLogs} disabled={triggerLoading}>
                                <RefreshCw className={`w-4 h-4 mr-2 ${triggerLoading ? "animate-spin" : ""}`} />
                                Refresh
                            </Button>
                            <Button variant="outline" size="sm" onClick={handleClear} className="text-red-400 hover:text-red-300">
                                <Trash2 className="w-4 h-4 mr-2" />
                                Clear
                            </Button>
                        </div>
                    </div>

                    {triggerLoading && triggerLogs.length === 0 ? (
                        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
                            <Loader2 className="w-4 h-4 animate-spin" /> Loading logs...
                        </div>
                    ) : filteredTriggerLogs.length === 0 ? (
                        <div className="border border-dashed border-border rounded-lg p-12 text-center">
                            <ScrollText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                            <p className="text-muted-foreground">No logs yet.</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {filteredTriggerLogs.map(log => {
                                const config = levelConfig[log.level as keyof typeof levelConfig] || levelConfig.info
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
                    <p className="text-[10px] text-muted-foreground/40 text-center pt-2">
                        Auto-refreshing every 5 seconds · Showing latest {filteredTriggerLogs.length} logs
                    </p>
                </div>
            )}
        </div>
    )
}
