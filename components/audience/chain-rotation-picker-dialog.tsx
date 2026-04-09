"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Loader2, RefreshCw, UserPlus } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { enrollInChainRotation } from "@/app/actions/chain-rotations"

interface ChainRotationPickerDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    selectedIds: string[]
    availableChainRotations: any[]
    loadingChainRotations: boolean
    onEnrollComplete: () => void
}

export function ChainRotationPickerDialog({
    open,
    onOpenChange,
    selectedIds,
    availableChainRotations,
    loadingChainRotations,
    onEnrollComplete,
}: ChainRotationPickerDialogProps) {
    const [selectedChainRotation, setSelectedChainRotation] = useState<any>(null)
    const [enrolling, setEnrolling] = useState(false)
    const { toast } = useToast()

    const handleEnroll = async (rotationId: string, rotationName: string) => {
        setEnrolling(true)
        try {
            const result = await enrollInChainRotation(rotationId, selectedIds)
            if (result.success) {
                const successCount = result.results?.filter((r: any) => r.success).length || 0
                toast({
                    title: "Subscribers enrolled",
                    description: `${successCount} of ${selectedIds.length} subscriber(s) enrolled into "${rotationName}".`,
                })
                onOpenChange(false)
                onEnrollComplete()
            } else {
                toast({ title: "Error", description: result.error || "Failed to enroll", variant: "destructive" })
            }
        } catch (error) {
            console.error("Failed to enroll in chain rotation", error)
            toast({ title: "Enrollment failed", variant: "destructive" })
        } finally {
            setEnrolling(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setSelectedChainRotation(null) }}>
            <DialogContent className="sm:max-w-md">
                {!selectedChainRotation ? (
                    /* Step 1: Pick a rotation */
                    <>
                        <DialogHeader>
                            <DialogTitle>Bulk Chain Rotation</DialogTitle>
                            <DialogDescription>
                                Select a chain rotation to enroll {selectedIds.length} selected subscriber{selectedIds.length !== 1 ? 's' : ''} into.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="py-4">
                            {loadingChainRotations ? (
                                <div className="flex justify-center py-8">
                                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                </div>
                            ) : availableChainRotations.length === 0 ? (
                                <p className="text-center text-muted-foreground py-8">No chain rotations found. Create one first in Chain Rotations.</p>
                            ) : (
                                <ScrollArea className="h-[300px] pr-4">
                                    <div className="space-y-2">
                                        {availableChainRotations.map((rot: any) => (
                                            <div
                                                key={rot.id}
                                                onClick={() => setSelectedChainRotation(rot)}
                                                className="p-3 rounded-lg border border-border cursor-pointer hover:bg-accent transition-colors"
                                            >
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <RefreshCw className="h-4 w-4 text-primary flex-shrink-0" />
                                                        <h4 className="font-medium text-sm text-foreground">{rot.name}</h4>
                                                    </div>
                                                    <div className="flex flex-wrap gap-1 pl-6">
                                                        {rot.chains.map((c: any, i: number) => (
                                                            <span
                                                                key={c.id}
                                                                className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                                                    i === (rot.cursor_position || 0) % rot.chains.length
                                                                        ? "bg-primary/10 text-primary border-primary/30 font-semibold"
                                                                        : "bg-muted text-muted-foreground border-border"
                                                                }`}
                                                            >
                                                                {c.name}
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground pl-6">
                                                        {rot.chains.length} chains · Cursor at position {(rot.cursor_position || 0) + 1}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            )}
                        </div>
                    </>
                ) : (
                    /* Step 2: Confirmation */
                    <>
                        <DialogHeader>
                            <DialogTitle>Confirm Enrollment</DialogTitle>
                            <DialogDescription>
                                Review the details below, then confirm to start enrolling subscribers.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="py-4 space-y-4">
                            {enrolling ? (
                                <div className="flex flex-col items-center justify-center py-8 gap-2">
                                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground">Enrolling {selectedIds.length} subscribers…</p>
                                </div>
                            ) : (
                                <>
                                    {/* Rotation info */}
                                    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                                        <div className="flex items-center gap-2">
                                            <RefreshCw className="h-4 w-4 text-primary" />
                                            <span className="font-semibold text-sm">{selectedChainRotation.name}</span>
                                        </div>
                                        <div className="flex flex-wrap gap-1 pl-6">
                                            {selectedChainRotation.chains.map((c: any, i: number) => {
                                                const cursor = selectedChainRotation.cursor_position || 0
                                                const totalChains = selectedChainRotation.chains.length
                                                let count = 0
                                                for (let s = 0; s < selectedIds.length; s++) {
                                                    if ((cursor + s) % totalChains === i) count++
                                                }
                                                return (
                                                    <span
                                                        key={c.id}
                                                        className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                                            count > 0
                                                                ? "bg-primary/10 text-primary border-primary/30 font-semibold"
                                                                : "bg-muted text-muted-foreground border-border"
                                                        }`}
                                                    >
                                                        {c.name} ({count})
                                                    </span>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    {/* Summary */}
                                    <div className="rounded-lg border border-border p-3 space-y-1">
                                        <p className="text-sm"><span className="font-medium">{selectedIds.length}</span> subscriber{selectedIds.length !== 1 ? 's' : ''} will be enrolled</p>
                                        <p className="text-xs text-muted-foreground">Each subscriber will be round-robin assigned to the next chain in the rotation, starting from position {(selectedChainRotation.cursor_position || 0) + 1}.</p>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex justify-end gap-2 pt-1">
                                        <Button variant="outline" onClick={() => setSelectedChainRotation(null)}>Back</Button>
                                        <Button onClick={() => handleEnroll(selectedChainRotation.id, selectedChainRotation.name)}>
                                            <UserPlus className="h-4 w-4 mr-2" />
                                            Confirm & Enroll
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
