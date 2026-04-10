"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { CampaignHeader } from "./campaign-header"
import { AudienceCard, Audience } from "./audience-card"
import { SenderIdentityCard } from "./sender-identity-card"
import { PreflightCheckCard } from "./preflight-check-card"
import { DiscountAuditCard } from "./discount-audit-card"
import { ImageHealthCard } from "./image-health-card"

import { LaunchpadCard } from "./launchpad-card"
import { EmailPreviewCard } from "./email-preview-card"
import { MergeTagAuditCard } from "./merge-tag-audit-card"
import { AnalyticsSection } from "./analytics-section"
import { BroadcastConfirmDialog } from "./broadcast-confirm-dialog"
import { SendConsoleCard, type LogEntry } from "./send-console-card"
import { Music, AlertCircle, CheckCircle2 } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Campaign } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "next/navigation"
import { getTrackingSettings, type TrackingFlags } from "@/app/actions/settings"

import { Subscriber } from "@/lib/types"

interface CampaignLaunchChecksProps {
    campaign: Campaign
    audience: Audience
    targetSubscriber?: Subscriber | null
}

export function CampaignLaunchChecks({ campaign, audience, targetSubscriber }: CampaignLaunchChecksProps) {
    const [showConfirmDialog, setShowConfirmDialog] = useState(false)
    const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop")
    // Default values since they are not in DB schema yet
    const [fromName, setFromName] = useState(campaign.variable_values?.from_name || "Lionel Yu")
    const [fromEmail, setFromEmail] = useState(campaign.variable_values?.from_email || "lionel@email.dreamplaypianos.com")
    const [broadcastStatus, setBroadcastStatus] = useState<"idle" | "success" | "error">("idle")
    const [broadcastMessage, setBroadcastMessage] = useState("")
    const [scheduledAt, setScheduledAt] = useState<string | null>(campaign.scheduled_at ?? null)
    const [scheduledStatus, setScheduledStatus] = useState<string | null>(campaign.scheduled_status ?? null)

    const { toast } = useToast()
    const router = useRouter()

    // Send console state
    const [sendLogs, setSendLogs] = useState<LogEntry[]>([])
    const [isStreaming, setIsStreaming] = useState(false)
    const [showConsole, setShowConsole] = useState(false)

    // Load tracking settings from DB on mount and when fromEmail changes
    const [trackingFlags, setTrackingFlags] = useState<TrackingFlags>({ click: false, open: true, resendClick: false, resendOpen: false })
    useEffect(() => {
        getTrackingSettings(fromEmail).then(setTrackingFlags)
    }, [fromEmail])

    // Compute effective subscriber count based on targeting mode
    const lockedSubscriberIds: string[] | undefined = campaign.variable_values?.subscriber_ids
    const lockedSubscriberId = campaign.variable_values?.subscriber_id
    const effectiveSubscriberCount = lockedSubscriberIds?.length
        ? lockedSubscriberIds.length
        : lockedSubscriberId
            ? 1
            : audience.active_subscribers

    const handleLaunchClick = () => {
        setShowConfirmDialog(true)
    }



    const handleConfirmBroadcast = async () => {
        setShowConfirmDialog(false)
        setBroadcastStatus("idle")
        setBroadcastMessage("")
        setSendLogs([])
        setShowConsole(true)
        setIsStreaming(true)

        // Prevent browser from throttling this tab when user switches away
        let wakeLock: WakeLockSentinel | null = null
        try {
            wakeLock = await navigator.wakeLock?.request("screen")
        } catch {
            // Wake Lock not supported or denied — send will still work if tab stays active
        }

        toast({ title: "Initiating broadcast...", description: "Watch the console for real-time progress." })

        try {
            const response = await fetch("/api/send-stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    campaignId: campaign.id,
                    fromName,
                    fromEmail,
                    clickTracking: trackingFlags.click,
                    openTracking: trackingFlags.open,
                    resendClickTracking: trackingFlags.resendClick,
                    resendOpenTracking: trackingFlags.resendOpen,
                })
            })

            if (!response.ok) {
                const errText = await response.text()
                setBroadcastStatus("error")
                setBroadcastMessage(errText || "Broadcast failed")
                setIsStreaming(false)
                toast({ title: "Broadcast failed", description: errText, variant: "destructive" })
                return
            }

            const reader = response.body?.getReader()
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
                buffer = lines.pop() || "" // keep incomplete last line in buffer

                for (const line of lines) {
                    if (!line.trim()) continue
                    try {
                        const entry: LogEntry = JSON.parse(line)
                        setSendLogs(prev => [...prev, entry])

                        // Check for final log
                        if (entry.done) {
                            setBroadcastStatus("success")
                            setBroadcastMessage(entry.message || "Broadcast complete")
                            toast({ title: "Campaign Sent!", description: entry.message })
                            router.refresh()
                        }
                    } catch {
                        // skip malformed lines
                    }
                }
            }

            // Process any remaining buffer
            if (buffer.trim()) {
                try {
                    const entry: LogEntry = JSON.parse(buffer)
                    setSendLogs(prev => [...prev, entry])
                    if (entry.done) {
                        setBroadcastStatus("success")
                        setBroadcastMessage(entry.message || "Broadcast complete")
                        router.refresh()
                    }
                } catch {
                    // skip
                }
            }

        } catch (err: any) {
            setBroadcastStatus("error")
            setBroadcastMessage(err.message || "Network error")
            toast({ title: "Broadcast error", description: err.message, variant: "destructive" })
        } finally {
            setIsStreaming(false)
            // Release wake lock so screen can sleep again
            wakeLock?.release().catch(() => { })
        }
    }

    const handleSchedule = async (date: Date) => {
        toast({ title: "Scheduling campaign...", description: `For ${date.toLocaleString()}` })

        const response = await fetch("/api/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "schedule",
                campaignId: campaign.id,
                scheduledAt: date.toISOString(),
                fromName,
                fromEmail,
                clickTracking: trackingFlags.click,
                openTracking: trackingFlags.open,
                resendClickTracking: trackingFlags.resendClick,
                resendOpenTracking: trackingFlags.resendOpen,
            })
        })

        const data = await response.json()

        if (!response.ok) {
            toast({ title: "Scheduling failed", description: data.error || data.message, variant: "destructive" })
        } else {
            setScheduledAt(data.scheduledAt)
            setScheduledStatus("pending")
            toast({ title: "Campaign Scheduled!", description: data.message })
            router.refresh()
        }
    }

    const handleCancelSchedule = async () => {
        const response = await fetch("/api/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "cancel_schedule",
                campaignId: campaign.id,
            })
        })

        const data = await response.json()

        if (!response.ok) {
            toast({ title: "Error", description: data.error || data.message, variant: "destructive" })
        } else {
            setScheduledAt(null)
            setScheduledStatus("cancelled")
            toast({ title: "Schedule Cancelled", description: "The scheduled send has been cancelled." })
            router.refresh()
        }
    }

    return (
        <div className="min-h-screen bg-background">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                {/* Header */}
                <CampaignHeader campaign={campaign} onSendBroadcast={handleLaunchClick} isSent={campaign.status === "completed"} broadcastStatus={broadcastStatus} broadcastMessage={broadcastMessage} />



                <div className="mt-6 grid gap-6 lg:grid-cols-5">
                    {/* Left Column - Controls */}
                    <div className="flex flex-col gap-6 lg:col-span-2">
                        <AudienceCard audience={audience} campaign={campaign} targetSubscriber={targetSubscriber} />
                        <SenderIdentityCard
                            fromName={fromName}
                            fromEmail={fromEmail}
                            onFromNameChange={setFromName}
                            onFromEmailChange={setFromEmail}
                            readOnly={campaign.status === "completed"}
                        />
                        <DiscountAuditCard variableValues={campaign.variable_values} />

                        <LaunchpadCard
                            subscriberCount={effectiveSubscriberCount}
                            onLaunch={handleLaunchClick}
                            onSchedule={handleSchedule}
                            onCancelSchedule={handleCancelSchedule}
                            isDisabled={campaign.status === "completed"}
                            scheduledAt={scheduledAt}
                            scheduledStatus={scheduledStatus}
                        />

                        {broadcastStatus === "error" && (
                            <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-2">
                                <AlertCircle className="h-4 w-4" />
                                <AlertTitle>Broadcast Failed</AlertTitle>
                                <AlertDescription>
                                    {broadcastMessage}
                                </AlertDescription>
                            </Alert>
                        )}

                        {broadcastStatus === "success" && (
                            <Alert className="border-green-500/50 bg-green-500/10 text-green-600 animate-in fade-in slide-in-from-top-2">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                <AlertTitle>Success</AlertTitle>
                                <AlertDescription>
                                    {broadcastMessage}
                                </AlertDescription>
                            </Alert>
                        )}

                        <PreflightCheckCard
                            subjectLine={campaign.subject_line}
                            previewText={campaign.variable_values?.preview_text ?? null}
                        />

                        <ImageHealthCard htmlContent={campaign.html_content} />

                        {showConsole && (
                            <SendConsoleCard logs={sendLogs} isStreaming={isStreaming} />
                        )}
                    </div>

                    {/* Right Column - Preview + Merge Tag Audit */}
                    <div className="lg:col-span-3 space-y-6">
                        <EmailPreviewCard campaign={campaign} previewMode={previewMode} onPreviewModeChange={setPreviewMode} />
                        <MergeTagAuditCard
                            campaignId={campaign.id}
                            campaignStatus={campaign.status}
                            htmlContent={campaign.html_content}
                            variableValues={campaign.variable_values}
                        />
                    </div>
                </div>

                {/* Analytics Section */}
                <div className="mt-8">
                    <AnalyticsSection status={campaign.status} />
                </div>
            </div>

            {/* Confirmation Dialog */}
            <BroadcastConfirmDialog
                open={showConfirmDialog}
                onOpenChange={setShowConfirmDialog}
                subscriberCount={effectiveSubscriberCount}
                campaignName={campaign.name}
                subjectLine={campaign.subject_line}
                onConfirm={handleConfirmBroadcast}
            />
        </div>
    )
}
