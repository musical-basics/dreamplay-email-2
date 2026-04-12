"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
    RefreshCw, Mail, ChevronDown, ChevronRight,
    Users, Play, Loader2, Home, AlertCircle, CheckCircle2,
    CalendarClock, X, Clock, CalendarIcon
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ChainStepPreview } from "@/components/chain/chain-step-preview"
import { SendConsoleCard, type LogEntry } from "@/components/campaign/send-console-card"

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 15, 30, 45]

/** Returns the next 15-minute boundary in Pacific Time. */
function getDefaultScheduleTime(): { date: Date; hour: number; minute: number } {
    const now = new Date()
    const ptParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
    }).formatToParts(now)
    const get = (t: string) => parseInt(ptParts.find(p => p.type === t)?.value ?? "0", 10)
    const ptMinute = get("minute")
    const ptHour = get("hour") % 24

    const minutesOver = ptMinute % 15
    const minutesToAdd = minutesOver === 0 ? 15 : 15 - minutesOver
    const totalMinutes = ptHour * 60 + ptMinute + minutesToAdd
    const nextHour = Math.floor(totalMinutes / 60) % 24
    const nextMinute = totalMinutes % 60

    const ptDateStr = `${ptParts.find(p => p.type === "year")?.value}-${ptParts.find(p => p.type === "month")?.value}-${ptParts.find(p => p.type === "day")?.value}`
    const dayOffset = totalMinutes >= 24 * 60 ? 1 : 0
    const calDate = new Date(`${ptDateStr}T00:00:00`)
    if (dayOffset) calDate.setDate(calDate.getDate() + 1)

    return { date: calDate, hour: nextHour, minute: nextMinute }
}

type SubscriberInfo = {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    tags: string[] | null
    status: string
}

type CampaignInfo = {
    id: string
    name: string
    subject_line: string
    html_content: string | null
    variable_values: Record<string, any> | null
}

interface RotationLaunchProps {
    rotation: {
        id: string
        name: string
        campaign_ids: string[]
        cursor_position: number
        campaigns: CampaignInfo[]
        scheduled_at?: string | null
        scheduled_status?: string | null
    }
    subscribers: SubscriberInfo[]
    assignments: { subscriberId: string; campaignId: string }[]
    campaignMap: Record<string, CampaignInfo>
}

export function RotationLaunch({ rotation, subscribers, assignments, campaignMap }: RotationLaunchProps) {
    const [selectedSubIdx, setSelectedSubIdx] = useState(0)
    const [showPreview, setShowPreview] = useState(false)
    const [showConfirmDialog, setShowConfirmDialog] = useState(false)
    const [sending, setSending] = useState(false)
    const [sendStatus, setSendStatus] = useState<"idle" | "success" | "error">("idle")
    const [sendMessage, setSendMessage] = useState("")
    const [sendLogs, setSendLogs] = useState<LogEntry[]>([])
    const [isStreaming, setIsStreaming] = useState(false)
    const [showConsole, setShowConsole] = useState(false)

    // Schedule state
    const [showSchedulePicker, setShowSchedulePicker] = useState(false)
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)
    const [selectedHour, setSelectedHour] = useState<number | null>(null)
    const [selectedMinute, setSelectedMinute] = useState<number | null>(null)
    const [calendarOpen, setCalendarOpen] = useState(false)
    const [timeOpen, setTimeOpen] = useState(false)
    const [scheduledAt, setScheduledAt] = useState<string | null>(rotation.scheduled_at || null)
    const [scheduledStatus, setScheduledStatus] = useState<string | null>(rotation.scheduled_status || null)
    const [scheduling, setScheduling] = useState(false)

    const openSchedulePicker = () => {
        if (!showSchedulePicker) {
            const defaults = getDefaultScheduleTime()
            setSelectedDate(defaults.date)
            setSelectedHour(defaults.hour)
            setSelectedMinute(defaults.minute)
        }
        setShowSchedulePicker(!showSchedulePicker)
    }

    const isScheduled = scheduledAt && scheduledStatus === "pending"
    const { toast } = useToast()
    const router = useRouter()

    // Build subscriber → assignment lookup
    const assignmentMap = new Map(assignments.map(a => [a.subscriberId, a.campaignId]))

    const activeSubscriber = subscribers[selectedSubIdx]
    const activeCampaignId = assignmentMap.get(activeSubscriber?.id || "")
    const activeCampaign = activeCampaignId ? campaignMap[activeCampaignId] : null

    const getSubscriberName = (sub: SubscriberInfo | null) =>
        sub?.first_name
            ? `${sub.first_name} ${sub.last_name || ""}`.trim()
            : sub?.email || "Unknown"

    // Count how many subscribers are assigned to each campaign
    const campaignCounts: Record<string, number> = {}
    for (const a of assignments) {
        campaignCounts[a.campaignId] = (campaignCounts[a.campaignId] || 0) + 1
    }

    const formatScheduledTime = (isoString: string) => {
        const d = new Date(isoString)
        return d.toLocaleString("en-US", {
            weekday: "short", month: "short", day: "numeric",
            hour: "numeric", minute: "2-digit", hour12: true,
        })
    }

    const formatSelectedDate = (date: Date) => {
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    }

    const formatTime = (hour: number, minute: number) => {
        const period = hour >= 12 ? "PM" : "AM"
        const h = hour % 12 || 12
        const m = minute.toString().padStart(2, "0")
        return `${h}:${m} ${period}`
    }

    const canConfirmSchedule = selectedDate && selectedHour !== null && selectedMinute !== null

    const handleScheduleSubmit = async () => {
        if (!selectedDate || selectedHour === null || selectedMinute === null) return
        const dt = new Date(selectedDate)
        dt.setHours(selectedHour, selectedMinute, 0, 0)
        if (dt <= new Date()) {
            toast({ title: "Invalid time", description: "Scheduled time must be in the future.", variant: "destructive" })
            return
        }
        setScheduling(true)
        try {
            const res = await fetch("/api/schedule-rotation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type: "schedule",
                    rotationId: rotation.id,
                    subscriberIds: subscribers.map(s => s.id),
                    scheduledAt: dt.toISOString(),
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Failed to schedule")
            setScheduledAt(data.scheduledAt)
            setScheduledStatus("pending")
            setShowSchedulePicker(false)
            setSelectedDate(undefined)
            setSelectedHour(null)
            setSelectedMinute(null)
            toast({ title: "Rotation Scheduled!", description: data.message })
        } catch (err: any) {
            toast({ title: "Schedule failed", description: err.message, variant: "destructive" })
        } finally {
            setScheduling(false)
        }
    }

    const handleCancelSchedule = async () => {
        try {
            const res = await fetch("/api/schedule-rotation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "cancel_schedule", rotationId: rotation.id }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Failed to cancel")
            setScheduledAt(null)
            setScheduledStatus("cancelled")
            toast({ title: "Schedule cancelled" })
        } catch (err: any) {
            toast({ title: "Cancel failed", description: err.message, variant: "destructive" })
        }
    }

    const handleSendAll = async () => {
        setShowConfirmDialog(false)
        setSending(true)
        setSendStatus("idle")
        setSendMessage("")
        setSendLogs([])
        setShowConsole(true)
        setIsStreaming(true)

        toast({ title: "Initiating rotation send...", description: "Watch the console for real-time progress." })

        try {
            const res = await fetch("/api/send-rotation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    rotationId: rotation.id,
                    subscriberIds: subscribers.map(s => s.id),
                }),
            })

            if (!res.ok) {
                const errText = await res.text()
                setSendStatus("error")
                setSendMessage(errText || "Rotation send failed")
                setIsStreaming(false)
                toast({ title: "Rotation send failed", description: errText, variant: "destructive" })
                return
            }

            const reader = res.body?.getReader()
            if (!reader) {
                setIsStreaming(false)
                return
            }

            const decoder = new TextDecoder()
            let buffer = ""

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split("\n")
                buffer = lines.pop() || ""

                for (const line of lines) {
                    if (!line.trim()) continue
                    try {
                        const entry: LogEntry = JSON.parse(line)
                        setSendLogs(prev => [...prev, entry])

                        if (entry.done) {
                            setSendStatus("success")
                            setSendMessage(entry.message || "Rotation send complete")
                            toast({ title: "Rotation Send Complete!", description: entry.message })
                            router.refresh()
                        }
                    } catch {
                        // skip malformed lines
                    }
                }
            }

            // Process remaining buffer
            if (buffer.trim()) {
                try {
                    const entry: LogEntry = JSON.parse(buffer)
                    setSendLogs(prev => [...prev, entry])
                    if (entry.done) {
                        setSendStatus("success")
                        setSendMessage(entry.message || "Rotation send complete")
                        router.refresh()
                    }
                } catch {
                    // skip
                }
            }

        } catch (error: any) {
            setSendStatus("error")
            setSendMessage(error.message)
            toast({
                title: "Rotation send failed",
                description: error.message,
                variant: "destructive",
            })
        } finally {
            setSending(false)
            setIsStreaming(false)
        }
    }

    return (
        <div className="min-h-screen bg-background">
            <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">

                {/* Breadcrumb */}
                <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                    <Link href="/" className="hover:text-foreground transition-colors">
                        <Home className="h-4 w-4" />
                    </Link>
                    <ChevronRight className="h-3.5 w-3.5" />
                    <Link href="/audience" className="hover:text-foreground transition-colors">
                        Audience
                    </Link>
                    <ChevronRight className="h-3.5 w-3.5" />
                    <span className="text-foreground font-medium truncate">Send via Rotation</span>
                </nav>

                {/* Header */}
                <div className="flex items-start justify-between gap-4 mb-8">
                    <div>
                        <div className="flex items-center gap-3">
                            <RefreshCw className="h-6 w-6 text-primary" />
                            <h1 className="text-2xl font-bold tracking-tight">{rotation.name}</h1>
                            <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/10 text-xs">
                                {rotation.campaigns.length} campaign{rotation.campaigns.length !== 1 ? "s" : ""}
                            </Badge>
                            <Badge variant="outline" className="text-blue-400 border-blue-500/30 bg-blue-500/10 text-xs">
                                <Users className="h-3 w-3 mr-1" />
                                {subscribers.length} subscriber{subscribers.length !== 1 ? "s" : ""}
                            </Badge>
                        </div>
                        <p className="text-muted-foreground mt-1 text-sm">
                            Round-robin distribution across {rotation.campaigns.length} campaigns. Review assignments below before sending.
                        </p>
                    </div>

                    {!isScheduled && (
                        <div className="flex gap-2 flex-shrink-0">
                            <Button
                                onClick={() => setShowConfirmDialog(true)}
                                disabled={sending || sendStatus === "success"}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white"
                            >
                                {sending ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Sending...
                                    </>
                                ) : (
                                    <>
                                        <Play className="h-4 w-4 mr-2" />
                                        Send All
                                    </>
                                )}
                            </Button>
                            <Button
                                onClick={openSchedulePicker}
                                disabled={sending || sendStatus === "success"}
                                variant="outline"
                                className="gap-2 border-[#D4AF37]/30 text-[#D4AF37] hover:bg-[#D4AF37]/10"
                            >
                                <CalendarClock className="h-4 w-4" />
                                Schedule
                            </Button>
                        </div>
                    )}
                </div>

                {/* Scheduled indicator */}
                {isScheduled && (
                    <div className="mb-6 flex items-center justify-between rounded-lg border border-sky-500/20 bg-sky-500/5 p-4">
                        <div className="flex items-center gap-3">
                            <Clock className="h-5 w-5 text-sky-400" />
                            <div>
                                <p className="text-sm font-medium text-sky-300">Scheduled</p>
                                <p className="text-xs text-muted-foreground">{formatScheduledTime(scheduledAt!)}</p>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCancelSchedule}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                            <X className="h-4 w-4 mr-1" />
                            Cancel
                        </Button>
                    </div>
                )}

                {/* Schedule picker */}
                {showSchedulePicker && !isScheduled && (
                    <div className="mb-6 rounded-lg border border-border bg-card/50 p-4 space-y-3">
                        <p className="text-sm font-medium text-foreground">Pick a date and time</p>
                        <div className="flex gap-2">
                            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "flex-1 justify-start text-left font-normal gap-2",
                                            !selectedDate && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="h-4 w-4 shrink-0" />
                                        {selectedDate ? formatSelectedDate(selectedDate) : "Pick date"}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={selectedDate}
                                        onSelect={(date) => {
                                            setSelectedDate(date)
                                            setCalendarOpen(false)
                                        }}
                                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                                    />
                                </PopoverContent>
                            </Popover>

                            <Popover open={timeOpen} onOpenChange={setTimeOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "w-[130px] justify-start text-left font-normal gap-2",
                                            selectedHour === null && "text-muted-foreground"
                                        )}
                                    >
                                        <Clock className="h-4 w-4 shrink-0" />
                                        {selectedHour !== null && selectedMinute !== null
                                            ? formatTime(selectedHour, selectedMinute)
                                            : "Pick time"
                                        }
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[200px] p-0" align="start">
                                    <ScrollArea className="h-[240px]">
                                        <div className="p-1">
                                            {HOURS.map(hour =>
                                                MINUTES.map(minute => {
                                                    const isSelected = selectedHour === hour && selectedMinute === minute
                                                    return (
                                                        <Button
                                                            key={`${hour}-${minute}`}
                                                            variant={isSelected ? "default" : "ghost"}
                                                            size="sm"
                                                            className={cn(
                                                                "w-full justify-start text-sm font-normal",
                                                                isSelected && "bg-[#D4AF37] text-[#050505] hover:bg-[#b8962e]"
                                                            )}
                                                            onClick={() => {
                                                                setSelectedHour(hour)
                                                                setSelectedMinute(minute)
                                                                setTimeOpen(false)
                                                            }}
                                                        >
                                                            {formatTime(hour, minute)}
                                                        </Button>
                                                    )
                                                })
                                            )}
                                        </div>
                                    </ScrollArea>
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                onClick={handleScheduleSubmit}
                                disabled={!canConfirmSchedule || scheduling}
                                className="flex-1 gap-2 bg-sky-600 text-white hover:bg-sky-500"
                                size="sm"
                            >
                                {scheduling ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <CalendarClock className="h-4 w-4" />
                                )}
                                Confirm Schedule
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowSchedulePicker(false)}
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}

                {/* Status Alerts */}
                {sendStatus === "success" && (
                    <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-start gap-3">
                        <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-emerald-400">Rotation Send Complete</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{sendMessage}</p>
                            <Button
                                variant="link"
                                size="sm"
                                className="text-emerald-400 px-0 mt-1 h-auto"
                                onClick={() => router.push("/audience")}
                            >
                                Back to Audience →
                            </Button>
                        </div>
                    </div>
                )}

                {sendStatus === "error" && (
                    <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-red-400">Rotation Send Failed</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{sendMessage}</p>
                        </div>
                    </div>
                )}

                <div className="grid gap-6 lg:grid-cols-3">
                    {/* Left Column */}
                    <div className="space-y-6">
                        {/* Subscribers List */}
                        <Card className="border-border bg-card">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                                    <Users className="h-4 w-4 text-[#D4AF37]" />
                                    Subscribers
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Click a subscriber to preview their assigned email.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                <ScrollArea className="h-[260px]">
                                    <div className="divide-y divide-border">
                                        {subscribers.map((sub, idx) => {
                                            const campaignId = assignmentMap.get(sub.id)
                                            const campaign = campaignId ? campaignMap[campaignId] : null
                                            const isActive = idx === selectedSubIdx
                                            return (
                                                <button
                                                    key={sub.id}
                                                    onClick={() => { setSelectedSubIdx(idx); setShowPreview(false) }}
                                                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isActive ? "bg-[#D4AF37]/10 border-l-2 border-l-[#D4AF37]" : "hover:bg-muted/30 border-l-2 border-l-transparent"}`}
                                                >
                                                    <div className="flex-1 min-w-0">
                                                        <p className={`text-xs font-medium truncate ${isActive ? "text-[#D4AF37]" : "text-foreground"}`}>
                                                            {getSubscriberName(sub)}
                                                        </p>
                                                        <p className="text-[10px] text-muted-foreground truncate">{sub.email}</p>
                                                    </div>
                                                    {campaign && (
                                                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-primary/10 text-primary border-primary/20 flex-shrink-0 max-w-[120px] truncate">
                                                            {campaign.name}
                                                        </Badge>
                                                    )}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </ScrollArea>
                            </CardContent>
                        </Card>

                        {/* Rotation Overview */}
                        <Card className="border-border bg-card">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                                    <RefreshCw className="h-4 w-4 text-[#D4AF37]" />
                                    Rotation Overview
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Distribution across campaigns starting at cursor position {rotation.cursor_position}.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2">
                                    {rotation.campaigns.map((c, i) => {
                                        const count = campaignCounts[c.id] || 0
                                        const isCursorStart = i === rotation.cursor_position % rotation.campaigns.length
                                        return (
                                            <div
                                                key={c.id}
                                                className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${isCursorStart
                                                    ? "bg-primary/10 border border-primary/20"
                                                    : "bg-muted/20"
                                                    }`}
                                            >
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className={`font-bold ${isCursorStart ? "text-primary" : "text-muted-foreground"}`}>
                                                        {i + 1}.
                                                    </span>
                                                    <span className={`truncate ${isCursorStart ? "text-primary font-medium" : "text-foreground"}`}>
                                                        {c.name}
                                                    </span>
                                                    {isCursorStart && (
                                                        <span className="text-[9px] text-primary/60">← start</span>
                                                    )}
                                                </div>
                                                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 flex-shrink-0">
                                                    {count} recipient{count !== 1 ? "s" : ""}
                                                </Badge>
                                            </div>
                                        )
                                    })}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Send Console */}
                        {showConsole && (
                            <SendConsoleCard logs={sendLogs} isStreaming={isStreaming} />
                        )}
                    </div>

                    {/* Right Column — Assigned Campaign Preview */}
                    <div className="lg:col-span-2">
                        <Card className="border-border bg-card">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                                    <Mail className="h-4 w-4 text-[#D4AF37]" />
                                    Assigned Email
                                    {activeSubscriber && (
                                        <span className="text-muted-foreground font-normal ml-1">
                                            for {getSubscriberName(activeSubscriber)}
                                        </span>
                                    )}
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    This subscriber will receive this campaign via rotation.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                {activeCampaign ? (
                                    <div>
                                        {/* Campaign Row */}
                                        <button
                                            onClick={() => setShowPreview(prev => !prev)}
                                            className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-muted/30 transition-colors"
                                        >
                                            {/* Step Number */}
                                            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-xs font-bold flex-shrink-0">
                                                <Mail className="h-3.5 w-3.5" />
                                            </div>

                                            {/* Content */}
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-foreground truncate">
                                                    {activeCampaign.name}
                                                </p>
                                                <p className="text-xs text-muted-foreground truncate mt-0.5">
                                                    {activeCampaign.subject_line
                                                        ? <>Subject: <span className="text-foreground/70">{activeCampaign.subject_line}</span></>
                                                        : <span className="italic">No subject line set</span>
                                                    }
                                                </p>
                                            </div>

                                            {/* Chevron */}
                                            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 flex-shrink-0 ${showPreview ? "rotate-180" : ""}`} />
                                        </button>

                                        {/* Expanded Preview */}
                                        {showPreview && (
                                            <div className="px-6 pb-6 pt-2 bg-muted/10 border-t border-border/50">
                                                <ChainStepPreview
                                                    htmlContent={activeCampaign.html_content}
                                                    variableValues={activeCampaign.variable_values}
                                                />
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                        <Mail className="h-10 w-10 mb-3 opacity-30" />
                                        <p className="text-sm">No campaign assigned.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>

            {/* Confirm Dialog */}
            <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Send Rotation &quot;{rotation.name}&quot;?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will immediately send emails to{" "}
                            <span className="text-foreground font-medium">{subscribers.length} subscriber{subscribers.length !== 1 ? "s" : ""}</span>{" "}
                            distributed across{" "}
                            <span className="text-foreground font-medium">{rotation.campaigns.length} campaign{rotation.campaigns.length !== 1 ? "s" : ""}</span>.
                            <br />
                            <span className="text-muted-foreground/80 text-xs mt-2 block">
                                {rotation.campaigns.map(c => {
                                    const count = campaignCounts[c.id] || 0
                                    return `${c.name}: ${count}`
                                }).join(" · ")}
                            </span>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleSendAll}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white"
                        >
                            <Play className="h-4 w-4 mr-2" />
                            Send All ({subscribers.length})
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
