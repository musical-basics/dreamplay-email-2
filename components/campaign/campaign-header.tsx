"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronRight, Pencil, Rocket, CheckCircle2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Campaign } from "@/lib/types"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"

interface CampaignHeaderProps {
    campaign: Campaign
    onSendBroadcast?: () => void
    isSent?: boolean
    broadcastStatus?: "idle" | "success" | "error"
    broadcastMessage?: string
}

const statusConfig: Record<string, { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-zinc-700 text-zinc-300 hover:bg-zinc-700" },
    active: { label: "Scheduled", className: "bg-amber-900/50 text-amber-400 hover:bg-amber-900/50" },
    completed: { label: "Sent", className: "bg-emerald-900/50 text-emerald-400 hover:bg-emerald-900/50" },
    sent: { label: "Sent", className: "bg-emerald-900/50 text-emerald-400 hover:bg-emerald-900/50" },
}

export function CampaignHeader({ campaign, onSendBroadcast, isSent, broadcastStatus, broadcastMessage }: CampaignHeaderProps) {
    // Fallback for status if not in config
    const status = statusConfig[campaign.status] || statusConfig.draft
    const [isEditSubjectOpen, setIsEditSubjectOpen] = useState(false)
    const [subjectInput, setSubjectInput] = useState(campaign.subject_line || "")
    const [saving, setSaving] = useState(false)

    const router = useRouter()
    const { toast } = useToast()
    const supabase = createClient()

    const handleSaveSubject = async () => {
        setSaving(true)
        const { error } = await supabase
            .from("campaigns")
            .update({ subject_line: subjectInput, updated_at: new Date().toISOString() })
            .eq("id", campaign.id)

        if (error) {
            toast({
                title: "Error updating subject line",
                description: error.message || "Unknown error",
                variant: "destructive",
            })
        } else {
            toast({
                title: "Subject line updated",
                description: "Your changes have been saved.",
            })
            setIsEditSubjectOpen(false)
            router.refresh()
        }
        setSaving(false)
    }

    return (
        <div className="space-y-4">
            {/* Breadcrumbs */}
            <nav className="flex items-center gap-2 text-sm text-muted-foreground">
                <Link href="/" className="transition-colors hover:text-foreground">
                    Home
                </Link>
                <ChevronRight className="h-4 w-4" />
                <Link href="/campaigns" className="text-muted-foreground hover:text-foreground transition-colors">
                    Campaigns
                </Link>
                <ChevronRight className="h-4 w-4" />
                <span className="text-foreground">{campaign.name}</span>
            </nav>

            {/* Title Row */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{campaign.name}</h1>
                    <Badge variant="secondary" className={status.className}>
                        {status.label}
                    </Badge>
                </div>

                <div className="flex items-center gap-2">
                    <Button variant="outline" asChild className="w-fit gap-2 border-border hover:bg-secondary bg-transparent">
                        <Link href={
                            campaign.html_content?.includes('"_marker":"__dnd_blocks__"')
                                ? `/dnd-editor?id=${campaign.id}`
                                : `/editor?id=${campaign.id}`
                        }>
                            <Pencil className="h-4 w-4" />
                            Edit Design
                        </Link>
                    </Button>

                    {onSendBroadcast && !campaign.is_template && campaign.status !== "draft" && (
                        <Button
                            onClick={onSendBroadcast}
                            disabled={isSent}
                            className="w-fit gap-2 bg-[#D4AF37] text-[#050505] hover:bg-[#b8962e] disabled:opacity-50"
                        >
                            <Rocket className="h-4 w-4" />
                            Send Broadcast
                        </Button>
                    )}
                </div>

                {broadcastStatus === "success" && broadcastMessage && (
                    <div className="flex items-center gap-2 rounded-lg border border-green-500/50 bg-green-500/10 px-3 py-2 text-sm text-green-500 animate-in fade-in slide-in-from-top-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        <span>{broadcastMessage}</span>
                    </div>
                )}

                {broadcastStatus === "error" && broadcastMessage && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-500 animate-in fade-in slide-in-from-top-2">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>{broadcastMessage}</span>
                    </div>
                )}
            </div>

            {/* Subject Line Preview */}
            <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between group">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Subject Line</p>
                    </div>
                    <p className="text-foreground">{campaign.subject_line || "(No subject)"}</p>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        setSubjectInput(campaign.subject_line || "")
                        setIsEditSubjectOpen(true)
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                </Button>
            </div>

            {/* Edit Subject Dialog */}
            <Dialog open={isEditSubjectOpen} onOpenChange={setIsEditSubjectOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Edit Subject Line</DialogTitle>
                        <DialogDescription>
                            Make changes to your email subject line here. Click save when you're done.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="subject" className="text-right">
                                Subject
                            </Label>
                            <Input
                                id="subject"
                                value={subjectInput}
                                onChange={(e) => setSubjectInput(e.target.value)}
                                className="col-span-3"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditSubjectOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveSubject} disabled={saving}>
                            {saving ? "Saving..." : "Save changes"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
