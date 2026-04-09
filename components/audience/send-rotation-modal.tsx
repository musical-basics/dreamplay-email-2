"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { RefreshCw, Loader2, ChevronRight } from "lucide-react"
import { getRotations } from "@/app/actions/rotations"
import { DEFAULT_WORKSPACE } from "@/lib/workspace"
import { useToast } from "@/hooks/use-toast"

interface SendRotationModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    selectedIds: string[]
}

export function SendRotationModal({ open, onOpenChange, selectedIds }: SendRotationModalProps) {
    const { toast } = useToast()
    const router = useRouter()
    const [rotations, setRotations] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedRotation, setSelectedRotation] = useState<any>(null)

    useEffect(() => {
        if (!open) return
        const fetch = async () => {
            setLoading(true)
            const data = await getRotations(DEFAULT_WORKSPACE)
            setRotations(data)
            setLoading(false)
        }
        fetch()
    }, [open])

    const handleReview = () => {
        if (!selectedRotation) return
        onOpenChange(false)
        router.push(`/rotation-send/${selectedRotation.id}?subscriberIds=${selectedIds.join(",")}`)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <RefreshCw className="w-5 h-5 text-primary" />
                        Send via Rotation
                    </DialogTitle>
                    <DialogDescription>
                        Round-robin {selectedIds.length} subscriber{selectedIds.length !== 1 ? "s" : ""} across the selected rotation's campaigns.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-2">
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : rotations.length === 0 ? (
                        <div className="text-center py-8">
                            <p className="text-muted-foreground">No rotations found.</p>
                            <p className="text-xs text-muted-foreground/60 mt-1">Create one in the Rotations page first.</p>
                        </div>
                    ) : (
                        <ScrollArea className="h-[300px] pr-2">
                            <div className="space-y-2">
                                {rotations.map((rot: any) => {
                                    const isSelected = selectedRotation?.id === rot.id
                                    const nextCampaign = rot.campaigns[rot.cursor_position % rot.campaigns.length]
                                    return (
                                        <button
                                            key={rot.id}
                                            onClick={() => setSelectedRotation(isSelected ? null : rot)}
                                            className={`w-full text-left p-3 rounded-lg border transition-all ${isSelected
                                                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                                                : "border-border hover:border-primary/30 hover:bg-muted/20"
                                                }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-sm text-foreground">{rot.name}</p>
                                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                                        {rot.campaigns.length} campaigns
                                                    </p>
                                                </div>
                                                <ChevronRight className={`w-4 h-4 transition-transform ${isSelected ? "rotate-90 text-primary" : "text-muted-foreground"}`} />
                                            </div>

                                            {isSelected && (
                                                <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
                                                    <p className="text-[10px] text-muted-foreground uppercase font-semibold">Campaign order:</p>
                                                    {rot.campaigns.map((c: any, i: number) => {
                                                        const isCurrent = i === rot.cursor_position % rot.campaigns.length
                                                        return (
                                                            <p
                                                                key={c.id}
                                                                className={`text-xs px-2 py-1 rounded ${isCurrent
                                                                    ? "bg-primary/10 text-primary font-semibold"
                                                                    : "text-muted-foreground"
                                                                    }`}
                                                            >
                                                                {i + 1}. {c.name} {isCurrent && "← starts here"}
                                                            </p>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        </ScrollArea>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button
                        onClick={handleReview}
                        disabled={!selectedRotation}
                        className="gap-2"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Review & Send
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
