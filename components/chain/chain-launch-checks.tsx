"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
    GitBranch, Mail, Clock, ChevronDown, ChevronRight,
    User, Play, CalendarClock, ArrowRight, Loader2, Home,
    AlertCircle, CheckCircle2, SkipForward, Users
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useToast } from "@/hooks/use-toast"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { startChainProcess } from "@/app/actions/chain-processes"
import { ChainStepPreview } from "./chain-step-preview"
import type { ChainWithDetails, ChainStepWithCampaign } from "@/app/actions/chains"

type SubscriberInfo = {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    tags: string[] | null
    status: string
}

interface ChainLaunchChecksProps {
    chain: ChainWithDetails
    subscriber: SubscriberInfo | null
    alreadySentCampaignIds?: string[]
    // Bulk mode
    subscribers?: SubscriberInfo[]
    sentMap?: Record<string, string[]>
}

export function ChainLaunchChecks({ chain, subscriber, alreadySentCampaignIds = [], subscribers, sentMap }: ChainLaunchChecksProps) {
    const isBulkMode = !!subscribers && subscribers.length > 1
    const [selectedSubIdx, setSelectedSubIdx] = useState(0)

    // Current subscriber + sent set (changes when clicking in bulk mode)
    const activeSubscriber = isBulkMode ? subscribers![selectedSubIdx] : subscriber
    const activeSentIds = isBulkMode ? (sentMap?.[activeSubscriber?.id || ""] || []) : alreadySentCampaignIds
    const sentSet = new Set(activeSentIds)

    const [expandedStep, setExpandedStep] = useState<number | null>(null)
    const [showConfirmDialog, setShowConfirmDialog] = useState(false)
    const [launching, setLaunching] = useState(false)
    const [launchStatus, setLaunchStatus] = useState<"idle" | "success" | "error">("idle")
    const [launchMessage, setLaunchMessage] = useState("")
    const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 })
    const { toast } = useToast()
    const router = useRouter()

    const getSubscriberName = (sub: SubscriberInfo | null) =>
        sub?.first_name
            ? `${sub.first_name} ${sub.last_name || ""}`.trim()
            : sub?.email || "Unknown"

    const subscriberName = getSubscriberName(activeSubscriber)

    const toggleStep = (index: number) => {
        setExpandedStep(prev => prev === index ? null : index)
    }

    const handleStartNow = async () => {
        setShowConfirmDialog(false)
        setLaunching(true)
        setLaunchStatus("idle")

        try {
            if (isBulkMode) {
                // Start chain for ALL subscribers
                const subs = subscribers!
                setBulkProgress({ done: 0, total: subs.length })
                let successCount = 0
                let failCount = 0

                for (let idx = 0; idx < subs.length; idx++) {
                    try {
                        const result = await startChainProcess(subs[idx].id, chain.id)
                        if (result.success) {
                            successCount++
                        } else {
                            failCount++
                        }
                    } catch {
                        failCount++
                    }
                    setBulkProgress({ done: idx + 1, total: subs.length })
                }

                const msg = `Chain "${chain.name}" started for ${successCount} subscriber${successCount !== 1 ? "s" : ""}${failCount > 0 ? ` (${failCount} failed)` : ""}`
                setLaunchStatus("success")
                setLaunchMessage(msg)
                toast({ title: "Bulk Chain Started!", description: msg })
            } else {
                // Single subscriber
                if (!activeSubscriber) return
                const result = await startChainProcess(activeSubscriber.id, chain.id)
                if (!result.success) {
                    throw new Error(result.error || "Failed to start chain")
                }

                const skippedMsg = result.skippedCount && result.skippedCount > 0
                    ? ` (${result.skippedCount} already-sent step(s) skipped)`
                    : ""

                setLaunchStatus("success")
                setLaunchMessage(`Chain "${chain.name}" is now running for ${activeSubscriber.email}${skippedMsg}`)
                toast({
                    title: "Chain Started!",
                    description: `"${chain.name}" is now running for ${activeSubscriber.email}${skippedMsg}`,
                })
            }
        } catch (error: any) {
            setLaunchStatus("error")
            setLaunchMessage(error.message)
            toast({
                title: "Error starting chain",
                description: error.message,
                variant: "destructive",
            })
        } finally {
            setLaunching(false)
        }
    }

    // Compute total journey duration
    const totalDuration = chain.steps.reduce((acc, step) => {
        if (!step.wait_after) return acc
        const match = step.wait_after.match(/^(\d+)\s*(minutes?|hours?|days?|weeks?)$/i)
        if (!match) return acc
        const num = parseInt(match[1])
        const unit = match[2].toLowerCase()
        if (unit.startsWith("min")) return acc + num * 60
        if (unit.startsWith("hour")) return acc + num * 3600
        if (unit.startsWith("day")) return acc + num * 86400
        if (unit.startsWith("week")) return acc + num * 604800
        return acc
    }, 0)

    const formatDuration = (seconds: number) => {
        if (seconds === 0) return "Immediate"
        const weeks = Math.floor(seconds / 604800)
        const days = Math.floor((seconds % 604800) / 86400)
        const hours = Math.floor((seconds % 86400) / 3600)
        const parts = []
        if (weeks > 0) parts.push(`${weeks}w`)
        if (days > 0) parts.push(`${days}d`)
        if (hours > 0) parts.push(`${hours}h`)
        return parts.join(" ") || "< 1h"
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
                    <Link href="/journeys" className="hover:text-foreground transition-colors">
                        Journeys
                    </Link>
                    <ChevronRight className="h-3.5 w-3.5" />
                    <span className="text-foreground font-medium truncate">{chain.name}</span>
                </nav>

                {/* Header */}
                <div className="flex items-start justify-between gap-4 mb-8">
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold tracking-tight">{chain.name}</h1>
                            <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/10 text-xs">
                                {chain.steps.length} email{chain.steps.length !== 1 ? "s" : ""}
                            </Badge>
                            {isBulkMode && (
                                <Badge variant="outline" className="text-blue-400 border-blue-500/30 bg-blue-500/10 text-xs">
                                    <Users className="h-3 w-3 mr-1" />
                                    {subscribers!.length} subscribers
                                </Badge>
                            )}
                        </div>
                        {chain.description && (
                            <p className="text-muted-foreground mt-1">{chain.description}</p>
                        )}
                    </div>

                    <div className="flex gap-2 flex-shrink-0">
                        <Button
                            variant="outline"
                            onClick={() => toast({ title: "Scheduling coming soon", description: "Schedule feature will be available in a future update." })}
                            disabled={!activeSubscriber || launchStatus === "success"}
                        >
                            <CalendarClock className="h-4 w-4 mr-2" />
                            Schedule
                        </Button>
                        <Button
                            onClick={() => setShowConfirmDialog(true)}
                            disabled={!activeSubscriber || launching || launchStatus === "success"}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white"
                        >
                            {launching ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    {isBulkMode ? `${bulkProgress.done}/${bulkProgress.total}` : "Starting..."}
                                </>
                            ) : (
                                <>
                                    <Play className="h-4 w-4 mr-2" />
                                    {isBulkMode ? "Start All" : "Start Now"}
                                </>
                            )}
                        </Button>
                    </div>
                </div>

                {/* Status Alerts */}
                {launchStatus === "success" && (
                    <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-start gap-3">
                        <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-emerald-400">Chain Started Successfully</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{launchMessage}</p>
                            <Button
                                variant="link"
                                size="sm"
                                className="text-emerald-400 px-0 mt-1 h-auto"
                                onClick={() => router.push("/journeys")}
                            >
                                View in Journeys →
                            </Button>
                        </div>
                    </div>
                )}

                {launchStatus === "error" && (
                    <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-red-400">Failed to Start Chain</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{launchMessage}</p>
                        </div>
                    </div>
                )}

                <div className="grid gap-6 lg:grid-cols-3">
                    {/* Left Column - Info */}
                    <div className="space-y-6">
                        {/* Subscribers List (Bulk Mode) */}
                        {isBulkMode && (
                            <Card className="border-border bg-card">
                                <CardHeader className="pb-3">
                                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                                        <Users className="h-4 w-4 text-[#D4AF37]" />
                                        Subscribers
                                    </CardTitle>
                                    <CardDescription className="text-xs">
                                        Click a subscriber to preview their chain status.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <ScrollArea className="h-[200px]">
                                        <div className="divide-y divide-border">
                                            {subscribers!.map((sub, idx) => {
                                                const subSentIds = sentMap?.[sub.id] || []
                                                const subSentCount = subSentIds.length
                                                const isActive = idx === selectedSubIdx
                                                return (
                                                    <button
                                                        key={sub.id}
                                                        onClick={() => setSelectedSubIdx(idx)}
                                                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isActive ? "bg-[#D4AF37]/10 border-l-2 border-l-[#D4AF37]" : "hover:bg-muted/30 border-l-2 border-l-transparent"}`}
                                                    >
                                                        <div className="flex-1 min-w-0">
                                                            <p className={`text-xs font-medium truncate ${isActive ? "text-[#D4AF37]" : "text-foreground"}`}>
                                                                {getSubscriberName(sub)}
                                                            </p>
                                                            <p className="text-[10px] text-muted-foreground truncate">{sub.email}</p>
                                                        </div>
                                                        {subSentCount > 0 && (
                                                            <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-zinc-500/20 text-zinc-400 flex-shrink-0">
                                                                {subSentCount}/{chain.steps.length} sent
                                                            </Badge>
                                                        )}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </ScrollArea>
                                </CardContent>
                            </Card>
                        )}

                        {/* Target Subscriber (Single Mode) */}
                        {!isBulkMode && (
                            <Card className="border-border bg-card">
                                <CardHeader className="pb-3">
                                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                                        <User className="h-4 w-4 text-[#D4AF37]" />
                                        Target Subscriber
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {activeSubscriber ? (
                                        <div className="space-y-2">
                                            <p className="text-sm font-semibold text-[#D4AF37]">
                                                {subscriberName}
                                            </p>
                                            <p className="text-xs text-muted-foreground">{activeSubscriber.email}</p>
                                            {activeSubscriber.tags && activeSubscriber.tags.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-2">
                                                    {activeSubscriber.tags.slice(0, 4).map(tag => (
                                                        <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                                                            {tag}
                                                        </Badge>
                                                    ))}
                                                    {activeSubscriber.tags.length > 4 && (
                                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                                            +{activeSubscriber.tags.length - 4}
                                                        </Badge>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">No subscriber selected.</p>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        {/* Journey Overview */}
                        <Card className="border-border bg-card">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                                    <GitBranch className="h-4 w-4 text-[#D4AF37]" />
                                    Journey Overview
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    {chain.steps.length} step{chain.steps.length !== 1 ? "s" : ""} · Total span: {formatDuration(totalDuration)}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-0">
                                    {chain.steps.map((step, i) => {
                                        const isSent = sentSet.has(step.template_key)
                                        return (
                                            <div key={step.id || i}>
                                                {/* Step */}
                                                <div className="flex items-start gap-3">
                                                    <div className="flex flex-col items-center">
                                                        {isSent ? (
                                                            <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-zinc-500/40 bg-zinc-500/10 flex-shrink-0">
                                                                <CheckCircle2 className="h-3.5 w-3.5 text-zinc-400" />
                                                            </div>
                                                        ) : (
                                                            <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold flex-shrink-0">
                                                                {i + 1}
                                                            </div>
                                                        )}
                                                        {(i < chain.steps.length - 1) && (
                                                            <div className="w-px flex-1 min-h-[16px] bg-border" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 pb-1 min-w-0">
                                                        <p className={`text-xs font-medium truncate ${isSent ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                                                            {step.campaign_name || step.label}
                                                        </p>
                                                        {step.campaign_subject && (
                                                            <p className={`text-[10px] truncate mt-0.5 ${isSent ? 'text-muted-foreground/50 line-through' : 'text-muted-foreground'}`}>
                                                                Subject: {step.campaign_subject}
                                                            </p>
                                                        )}
                                                        {isSent && (
                                                            <p className="text-[10px] text-zinc-500 italic mt-0.5">Already sent — will be skipped</p>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Wait */}
                                                {step.wait_after && i < chain.steps.length - 1 && (
                                                    <div className="flex items-start gap-3">
                                                        <div className="flex flex-col items-center">
                                                            <div className="w-px min-h-[4px] bg-border" />
                                                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted flex-shrink-0">
                                                                <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                                                            </div>
                                                            <div className="w-px min-h-[4px] bg-border" />
                                                        </div>
                                                        <div className="flex items-center h-5 mt-1">
                                                            <p className="text-[10px] text-amber-400/70 italic">
                                                                Wait {step.wait_after}
                                                            </p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right Column - Steps Table */}
                    <div className="lg:col-span-2">
                        <Card className="border-border bg-card">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                                    <Mail className="h-4 w-4 text-[#D4AF37]" />
                                    Email Steps
                                    {isBulkMode && activeSubscriber && (
                                        <span className="text-muted-foreground font-normal ml-1">
                                            for {getSubscriberName(activeSubscriber)}
                                        </span>
                                    )}
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Click a step to preview the email content.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="divide-y divide-border">
                                    {chain.steps.map((step, i) => {
                                        const isExpanded = expandedStep === i
                                        return (
                                            <div key={step.id || i}>
                                                {/* Step Row */}
                                                <button
                                                    onClick={() => toggleStep(i)}
                                                    className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-muted/30 transition-colors"
                                                >
                                                    {/* Step Number */}
                                                    <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-xs font-bold flex-shrink-0">
                                                        {i + 1}
                                                    </div>

                                                    {/* Content */}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <p className={`text-sm font-medium truncate ${sentSet.has(step.template_key) ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                                                                {step.campaign_name || step.label || "Untitled Step"}
                                                            </p>
                                                            {sentSet.has(step.template_key) && (
                                                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-zinc-500/20 text-zinc-400 border-zinc-500/30 flex-shrink-0">
                                                                    <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                                                                    Sent
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <p className={`text-xs truncate mt-0.5 ${sentSet.has(step.template_key) ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>
                                                            {step.campaign_subject
                                                                ? <>Subject: <span className={sentSet.has(step.template_key) ? 'text-muted-foreground/50' : 'text-foreground/70'}>{step.campaign_subject}</span></>
                                                                : <span className="italic">No subject line set</span>
                                                            }
                                                        </p>
                                                    </div>

                                                    {/* Wait Badge */}
                                                    {step.wait_after && (
                                                        <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 bg-amber-500/5 flex-shrink-0">
                                                            <Clock className="h-2.5 w-2.5 mr-1" />
                                                            {step.wait_after}
                                                        </Badge>
                                                    )}

                                                    {/* Chevron */}
                                                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`} />
                                                </button>

                                                {/* Expanded Preview (lazy) */}
                                                {isExpanded && (
                                                    <div className="px-6 pb-6 pt-2 bg-muted/10 border-t border-border/50">
                                                        <ChainStepPreview
                                                            htmlContent={step.campaign_html}
                                                            variableValues={step.campaign_variable_values}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>

                                {chain.steps.length === 0 && (
                                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                        <Mail className="h-10 w-10 mb-3 opacity-30" />
                                        <p className="text-sm">No steps in this chain.</p>
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
                        <AlertDialogTitle>Start Chain &quot;{chain.name}&quot;?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {isBulkMode ? (
                                <>
                                    This will immediately begin sending emails to{" "}
                                    <span className="text-foreground font-medium">{subscribers!.length} subscribers</span>.
                                    {" "}Each subscriber&apos;s already-sent steps will be automatically skipped.
                                </>
                            ) : (
                                (() => {
                                    const sentCount = chain.steps.filter(s => sentSet.has(s.template_key)).length
                                    const willSend = chain.steps.length - sentCount
                                    return (
                                        <>
                                            This will immediately begin sending emails to{" "}
                                            <span className="text-foreground font-medium">{subscriberName}</span>
                                            {" "}({activeSubscriber?.email}).
                                            {sentCount > 0 && (
                                                <> <span className="text-amber-400 font-medium">{sentCount} step{sentCount !== 1 ? "s" : ""} will be skipped</span> (already sent).</>
                                            )}
                                            {" "}{willSend} email{willSend !== 1 ? "s" : ""} will be sent.
                                        </>
                                    )
                                })()
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleStartNow}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white"
                        >
                            <Play className="h-4 w-4 mr-2" />
                            {isBulkMode ? `Start All (${subscribers!.length})` : "Start Chain"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
