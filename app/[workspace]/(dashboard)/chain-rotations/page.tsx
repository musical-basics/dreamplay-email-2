"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { getChainRotations, createChainRotation, deleteChainRotation } from "@/app/actions/chain-rotations"
import { getChains, type ChainRow } from "@/app/actions/chains"
import { RefreshCw, Plus, Trash2, ChevronRight, GitBranch, Route, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export default function ChainRotationsPage() {
    const { workspace } = useParams<{ workspace: string }>()
    const router = useRouter()
    const { toast } = useToast()
    const [rotations, setRotations] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [createOpen, setCreateOpen] = useState(false)
    const [newName, setNewName] = useState("")
    const [masterChains, setMasterChains] = useState<ChainRow[]>([])
    const [selectedChainIds, setSelectedChainIds] = useState<string[]>([])
    const [creating, setCreating] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)

    const fetchData = async () => {
        setLoading(true)
        const [rots, chainsResult] = await Promise.all([
            getChainRotations(workspace),
            getChains(workspace),
        ])
        setRotations(rots)
        setMasterChains(chainsResult.data || [])
        setLoading(false)
    }

    useEffect(() => { fetchData() }, [])

    const handleCreate = async () => {
        if (!newName.trim() || selectedChainIds.length < 2) return
        setCreating(true)
        const result = await createChainRotation(workspace, newName.trim(), selectedChainIds)
        if (result.success) {
            toast({ title: "Chain rotation created", description: `"${newName}" with ${selectedChainIds.length} chains.` })
            setCreateOpen(false)
            setNewName("")
            setSelectedChainIds([])
            fetchData()
        } else {
            toast({ title: "Error", description: result.error, variant: "destructive" })
        }
        setCreating(false)
    }

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this chain rotation? Existing chain processes will be preserved.")) return
        setDeletingId(id)
        await deleteChainRotation(workspace, id)
        toast({ title: "Chain rotation deleted" })
        fetchData()
        setDeletingId(null)
    }

    const toggleChain = (id: string) => {
        setSelectedChainIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                        <Route className="w-6 h-6 text-primary" />
                        Chain Rotations
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        A/B test entire email journeys — rotate subscribers through different chains to compare performance.
                    </p>
                </div>
                <Button onClick={() => setCreateOpen(true)} className="gap-2">
                    <Plus className="w-4 h-4" />
                    New Chain Rotation
                </Button>
            </div>

            {/* List */}
            {loading ? (
                <div className="text-center py-12 text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                    Loading...
                </div>
            ) : rotations.length === 0 ? (
                <div className="text-center py-16 border border-dashed border-border rounded-xl">
                    <Route className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-muted-foreground">No chain rotations yet</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                        Create one to start A/B testing between email journeys.
                    </p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {rotations.map((rot: any) => (
                        <button
                            key={rot.id}
                            onClick={() => router.push(`/chain-rotations/${rot.id}`)}
                            className="w-full text-left p-4 rounded-xl border border-border bg-card hover:bg-muted/30 transition-all group"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                        <RefreshCw className="w-5 h-5 text-primary" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-semibold text-foreground truncate">{rot.name}</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {rot.chains.length} chains · Cursor at position {(rot.cursor_position || 0) + 1}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {/* Chain pills */}
                                    <div className="hidden sm:flex items-center gap-1.5">
                                        {rot.chains.slice(0, 4).map((c: any, i: number) => (
                                            <span
                                                key={c.id}
                                                className={`text-[10px] px-2 py-0.5 rounded-full border ${i === (rot.cursor_position || 0) % rot.chains.length
                                                    ? "bg-primary/10 text-primary border-primary/30 font-semibold"
                                                    : "bg-muted text-muted-foreground border-border"
                                                    }`}
                                            >
                                                {c.name.length > 20 ? c.name.slice(0, 20) + "…" : c.name}
                                                <span className="text-muted-foreground/50 ml-1">({c.stepsCount} steps)</span>
                                            </span>
                                        ))}
                                        {rot.chains.length > 4 && (
                                            <span className="text-[10px] text-muted-foreground">+{rot.chains.length - 4}</span>
                                        )}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={(e) => { e.stopPropagation(); handleDelete(rot.id) }}
                                        disabled={deletingId === rot.id}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {/* Create Dialog */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Create Chain Rotation</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Rotation Name</Label>
                            <Input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="e.g. Onboarding A/B Test"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Select Chains (min 2)</Label>
                            <p className="text-xs text-muted-foreground">
                                Subscribers will be distributed evenly across the selected chains in round-robin order.
                            </p>
                            <div className="max-h-60 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                                {masterChains.length === 0 ? (
                                    <p className="p-3 text-sm text-muted-foreground text-center">No chains available</p>
                                ) : masterChains.map((chain) => {
                                    const isSelected = selectedChainIds.includes(chain.id)
                                    const order = isSelected ? selectedChainIds.indexOf(chain.id) + 1 : null
                                    return (
                                        <button
                                            key={chain.id}
                                            onClick={() => toggleChain(chain.id)}
                                            className={`w-full text-left px-3 py-2.5 text-sm flex items-center justify-between transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-muted/30"
                                                }`}
                                        >
                                            <div>
                                                <span className={isSelected ? "text-foreground font-medium" : "text-muted-foreground"}>
                                                    {chain.name}
                                                </span>
                                                <span className="text-[10px] text-muted-foreground/60 ml-2">
                                                    {chain.chain_steps.length} steps
                                                    {chain.chain_branches.length > 0 && ` + ${chain.chain_branches.length} branches`}
                                                </span>
                                            </div>
                                            {order && (
                                                <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                                    #{order}
                                                </span>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                            {selectedChainIds.length > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    Order: {selectedChainIds.map((id, i) => {
                                        const c = masterChains.find(c => c.id === id)
                                        return `${i + 1}. ${c?.name || "?"}`
                                    }).join(" → ")}
                                </p>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                        <Button
                            onClick={handleCreate}
                            disabled={creating || !newName.trim() || selectedChainIds.length < 2}
                        >
                            {creating ? "Creating..." : `Create (${selectedChainIds.length} chains)`}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
