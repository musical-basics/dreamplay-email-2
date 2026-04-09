"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { FolderOpen, Loader2, Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { getCampaignList } from "@/app/actions/campaigns"
import { DEFAULT_WORKSPACE } from "@/lib/workspace"
import { formatDistanceToNow } from "date-fns"
import { cn } from "@/lib/utils"

interface CampaignSummary {
    id: string
    name: string
    status: string
    created_at: string
}

interface CampaignPickerProps {
    currentId?: string | null
    editorType: "classic" | "modular" | "knowledge"
    className?: string
}

export function CampaignPicker({ currentId, editorType, className }: CampaignPickerProps) {
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])
    const router = useRouter()

    useEffect(() => {
        if (open) {
            const fetchCampaigns = async () => {
                setLoading(true)
                try {
                    const data = await getCampaignList(DEFAULT_WORKSPACE)
                    // Filter or sort if needed, but getCampaignList already sorts by created_at
                    setCampaigns(data as CampaignSummary[])
                } catch (error) {
                    console.error("Error fetching campaigns for picker:", error)
                } finally {
                    setLoading(false)
                }
            }
            fetchCampaigns()
        }
    }, [open])

    const handleSelect = (id: string) => {
        setOpen(false)
        const path = editorType === "classic" ? "/editor" : editorType === "knowledge" ? "/editor-v2" : "/modular-editor"
        router.push(`${path}?id=${id}`)
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className={cn("gap-2", className)}>
                    <FolderOpen className="w-4 h-4" />
                    Open
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Open Campaign</DialogTitle>
                    <DialogDescription>
                        Select a campaign to open in the {editorType === "classic" ? "Classic" : "Modular"} Editor.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto pr-2 py-4">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                            <Loader2 className="w-8 h-8 animate-spin" />
                            <p className="text-sm">Fetching campaigns...</p>
                        </div>
                    ) : campaigns.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <p>No campaigns found.</p>
                        </div>
                    ) : (
                        <div className="grid gap-2">
                            {campaigns.map((campaign) => (
                                <button
                                    key={campaign.id}
                                    onClick={() => handleSelect(campaign.id)}
                                    disabled={campaign.id === currentId}
                                    className={cn(
                                        "flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all",
                                        campaign.id === currentId
                                            ? "bg-muted border-primary/20 opacity-80 cursor-default"
                                            : "border-border bg-card hover:bg-accent hover:border-primary/50"
                                    )}
                                >
                                    <div className="flex w-full items-center justify-between">
                                        <span className="font-medium text-sm truncate pr-4">
                                            {campaign.name || "Untitled Campaign"}
                                        </span>
                                        {campaign.id === currentId && (
                                            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-bold uppercase">
                                                Current
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Calendar className="w-3 h-3" />
                                        <span>
                                            Created {formatDistanceToNow(new Date(campaign.created_at), { addSuffix: true })}
                                        </span>
                                        <span className="text-[10px] border border-border px-1 rounded uppercase">
                                            {campaign.status}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
