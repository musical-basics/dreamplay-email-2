"use client"

import { useEffect, useRef } from "react"
import { Terminal, CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export interface LogEntry {
    ts: string
    level: "info" | "success" | "warn" | "error"
    message: string
    done?: boolean
    stats?: { sent: number; failed: number; total: number }
    [key: string]: any
}

interface SendConsoleCardProps {
    logs: LogEntry[]
    isStreaming: boolean
}

export function SendConsoleCard({ logs, isStreaming }: SendConsoleCardProps) {
    const scrollRef = useRef<HTMLDivElement>(null)

    // Auto-scroll to bottom as new logs arrive
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [logs])

    const getIcon = (level: LogEntry["level"]) => {
        switch (level) {
            case "success":
                return <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
            case "warn":
                return <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
            case "error":
                return <XCircle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" />
            default:
                return <Info className="h-3 w-3 text-blue-400 shrink-0 mt-0.5" />
        }
    }

    const getTextColor = (level: LogEntry["level"]) => {
        switch (level) {
            case "success":
                return "text-emerald-400"
            case "warn":
                return "text-amber-400"
            case "error":
                return "text-red-400"
            default:
                return "text-zinc-300"
        }
    }

    const formatTime = (ts: string) => {
        try {
            return new Date(ts).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            })
        } catch {
            return ""
        }
    }

    const finalLog = logs.find(l => l.done)

    return (
        <Card className="border-border bg-zinc-950">
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base font-medium text-foreground">
                    <Terminal className="h-5 w-5 text-emerald-500" />
                    Send Console
                    {isStreaming && (
                        <span className="ml-auto flex items-center gap-1.5">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                            </span>
                            <span className="text-xs text-emerald-500 font-medium">Live</span>
                        </span>
                    )}
                    {!isStreaming && finalLog && (
                        <span className="ml-auto rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-500">
                            Complete — {finalLog.stats?.sent ?? 0} sent, {finalLog.stats?.failed ?? 0} failed
                        </span>
                    )}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div
                    ref={scrollRef}
                    className="bg-zinc-900 rounded-md border border-zinc-800 font-mono text-[11px] leading-[1.6] overflow-y-auto max-h-[320px] p-3 space-y-0.5"
                >
                    {logs.length === 0 && (
                        <div className="text-zinc-600 italic">Waiting for broadcast to start...</div>
                    )}
                    {logs.map((log, i) => (
                        <div key={i} className="flex items-start gap-2">
                            {getIcon(log.level)}
                            <span className="text-zinc-600 shrink-0">{formatTime(log.ts)}</span>
                            <span className={getTextColor(log.level)}>{log.message}</span>
                        </div>
                    ))}
                    {isStreaming && (
                        <div className="flex items-center gap-2 text-zinc-600 mt-1">
                            <span className="animate-pulse">▍</span>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
