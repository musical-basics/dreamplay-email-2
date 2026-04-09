"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2, GitBranch } from "lucide-react"
import { useRouter } from "next/navigation"
import type { ChainRow } from "@/app/actions/chains"
import type { Subscriber } from "@/lib/types"

interface ChainPickerDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    bulkChainMode: boolean
    onBulkChainModeChange: (mode: boolean) => void
    selectedIds: string[]
    chainTarget: Subscriber | null
    availableChains: ChainRow[]
    loadingChains: boolean
}

export function ChainPickerDialog({
    open,
    onOpenChange,
    bulkChainMode,
    onBulkChainModeChange,
    selectedIds,
    chainTarget,
    availableChains,
    loadingChains,
}: ChainPickerDialogProps) {
    const router = useRouter()

    return (
        <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) onBulkChainModeChange(false) }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{bulkChainMode ? 'Bulk Start Chain' : 'Start Email Chain'}</DialogTitle>
                    <DialogDescription>
                        {bulkChainMode
                            ? `Select a chain to start for ${selectedIds.length} selected subscriber${selectedIds.length !== 1 ? 's' : ''}.`
                            : `Select a chain to review and start for ${chainTarget?.email}.`
                        }
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {loadingChains ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : availableChains.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">No chains found. Create one first.</p>
                    ) : (
                        <ScrollArea className="h-[300px] pr-4">
                            <div className="space-y-2">
                                {availableChains.map(chain => (
                                    <div
                                        key={chain.id}
                                        onClick={() => {
                                            if (bulkChainMode) {
                                                onOpenChange(false)
                                                onBulkChainModeChange(false)
                                                router.push(`/chain/${chain.id}?subscriberIds=${selectedIds.join(",")}`)
                                            } else if (chainTarget) {
                                                onOpenChange(false)
                                                router.push(`/chain/${chain.id}?subscriberId=${chainTarget.id}`)
                                            }
                                        }}
                                        className="p-3 rounded-lg border border-border cursor-pointer hover:bg-accent transition-colors"
                                    >
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <GitBranch className="h-4 w-4 text-amber-500 flex-shrink-0" />
                                                <h4 className="font-medium text-sm text-foreground">{chain.name}</h4>
                                            </div>
                                            {chain.description && (
                                                <p className="text-xs text-muted-foreground line-clamp-2 pl-6">{chain.description}</p>
                                            )}
                                            <p className="text-[10px] text-muted-foreground pl-6">
                                                {chain.chain_steps?.length || 0} steps · {chain.chain_branches?.length || 0} branches
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
