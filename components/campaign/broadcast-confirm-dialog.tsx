"use client"

import { AlertTriangle, Rocket, X } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface BroadcastConfirmDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    subscriberCount: number
    campaignName: string
    subjectLine: string | null
    onConfirm: () => void
}

export function BroadcastConfirmDialog({
    open,
    onOpenChange,
    subscriberCount,
    campaignName,
    subjectLine,
    onConfirm,
}: BroadcastConfirmDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="border-border bg-card sm:max-w-md">
                <DialogHeader className="space-y-3">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
                        <AlertTriangle className="h-6 w-6 text-amber-500" />
                    </div>
                    <DialogTitle className="text-center text-foreground">Confirm Broadcast</DialogTitle>
                    <DialogDescription className="text-center text-muted-foreground">
                        You are about to send this campaign. This action cannot be undone.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 rounded-lg border border-border bg-background p-4">
                    <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Campaign</p>
                        <p className="text-foreground">{campaignName}</p>
                    </div>
                    <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Subject Line</p>
                        <p className="text-foreground">{subjectLine || "(No Subject)"}</p>
                    </div>
                    <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recipients</p>
                        <p className="text-lg font-semibold text-[#D4AF37]">
                            {subscriberCount === 1 ? "1 subscriber" : `${subscriberCount.toLocaleString()} subscribers`}
                        </p>
                    </div>
                </div>

                <DialogFooter className="flex-col gap-2 sm:flex-col">
                    <Button onClick={onConfirm} className="w-full gap-2 bg-[#D4AF37] text-[#050505] hover:bg-[#b8962e]">
                        <Rocket className="h-4 w-4" />
                        Yes, Send Broadcast Now
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        className="w-full gap-2 border-border hover:bg-secondary"
                    >
                        <X className="h-4 w-4" />
                        Cancel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
