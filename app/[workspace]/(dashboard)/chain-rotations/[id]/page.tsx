"use client"

import { useEffect, useState, useMemo, use } from "react"
import { useRouter, useParams } from "next/navigation"
import { getChainRotation, getChainRotationAnalytics, enrollInChainRotation, updateChainRotation } from "@/app/actions/chain-rotations"
import { getTags, type TagDefinition } from "@/app/actions/tags"
import { ArrowLeft, RefreshCw, Users, Eye, MousePointer2, GitBranch, Loader2, UserPlus, CheckCircle2, BarChart3, Search, Tag, X, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"

export default function ChainRotationDetailPage({ params }: { params: Promise<{ id: string; workspace: string }> }) {
    const { id, workspace } = use(params)
    const router = useRouter()
    const { toast } = useToast()

    const [rotation, setRotation] = useState<any>(null)
    const [analytics, setAnalytics] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [enrolling, setEnrolling] = useState(false)
    const [testSubscribers, setTestSubscribers] = useState<any[]>([])
    const [selectedSubIds, setSelectedSubIds] = useState<string[]>([])
    const [showEnrollPanel, setShowEnrollPanel] = useState(false)
    const [loadingSubs, setLoadingSubs] = useState(false)
    const [editingName, setEditingName] = useState(false)
    const [editName, setEditName] = useState("")

    // Search & Tag filter state
    const [subSearch, setSubSearch] = useState("")
    const [selectedTags, setSelectedTags] = useState<string[]>([])
    const [tagDefinitions, setTagDefinitions] = useState<TagDefinition[]>([])
    const [tagPopoverOpen, setTagPopoverOpen] = useState(false)

    const fetchData = async () => {
        setLoading(true)
        const [rotData, analyticsData] = await Promise.all([
            getChainRotation(id),
            getChainRotationAnalytics(id),
        ])
        setRotation(rotData)
        setAnalytics(analyticsData)
        if (rotData) setEditName(rotData.name)
        setLoading(false)
    }

    useEffect(() => { fetchData() }, [id])

    const handleEnroll = async () => {
        if (selectedSubIds.length === 0) return
        setEnrolling(true)
        const result = await enrollInChainRotation(id, selectedSubIds)
        if (result.success) {
            const successCount = result.results?.filter((r: any) => r.success).length || 0
            toast({
                title: "Subscribers enrolled",
                description: `${successCount} subscriber(s) enrolled into chain rotation.`,
            })
            setSelectedSubIds([])
            setShowEnrollPanel(false)
            fetchData()
        } else {
            toast({ title: "Error", description: "Failed to enroll subscribers", variant: "destructive" })
        }
        setEnrolling(false)
    }

    const loadTestSubscribers = async () => {
        setLoadingSubs(true)
        const supabase = createClient()

        // Fetch all active subscribers in batches
        const allData: any[] = []
        const batchSize = 1000
        let from = 0
        while (true) {
            const { data, error } = await supabase
                .from("subscribers")
                .select("id, email, first_name, last_name, tags, status")
                .eq("status", "active")
                .order("created_at", { ascending: false })
                .range(from, from + batchSize - 1)
            if (error || !data || data.length === 0) break
            allData.push(...data)
            if (data.length < batchSize) break
            from += batchSize
        }
        setTestSubscribers(allData)

        // Load tag definitions
        const { tags: defs } = await getTags(workspace)
        setTagDefinitions(defs)

        setLoadingSubs(false)
    }

    const handleSaveName = async () => {
        if (!editName.trim() || !rotation) return
        await updateChainRotation(workspace, id, editName.trim(), rotation.chain_ids)
        setEditingName(false)
        fetchData()
        toast({ title: "Name updated" })
    }

    // Derive available tags from tag definitions + subscriber tags
    const availableTags = useMemo(() => {
        const tagSet = new Set<string>()
        tagDefinitions.forEach(td => tagSet.add(td.name))
        testSubscribers.forEach(sub => sub.tags?.forEach((t: string) => tagSet.add(t)))
        return Array.from(tagSet).sort()
    }, [tagDefinitions, testSubscribers])

    // Tag color lookup
    const tagColors = useMemo(() => {
        const colors: Record<string, string> = {}
        tagDefinitions.forEach(td => { colors[td.name] = td.color })
        return colors
    }, [tagDefinitions])

    // Filtered subscribers
    const filteredSubscribers = useMemo(() => {
        return testSubscribers.filter((sub) => {
            // Search filter
            const query = subSearch.toLowerCase()
            const matchesSearch = !query ||
                sub.email.toLowerCase().includes(query) ||
                (sub.first_name || "").toLowerCase().includes(query) ||
                (sub.last_name || "").toLowerCase().includes(query)

            // Tag filter (include — subscriber must have at least one of the selected tags)
            const subTags: string[] = sub.tags || []
            const matchesTags = selectedTags.length === 0 || selectedTags.some(tag => subTags.includes(tag))

            return matchesSearch && matchesTags
        })
    }, [testSubscribers, subSearch, selectedTags])

    const handleToggleTag = (tag: string) => {
        setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
    }

    const handleSelectAllFiltered = () => {
        const filteredIds = filteredSubscribers.map(s => s.id)
        const allAlreadySelected = filteredIds.every(id => selectedSubIds.includes(id))
        if (allAlreadySelected) {
            // Deselect all filtered
            setSelectedSubIds(prev => prev.filter(id => !filteredIds.includes(id)))
        } else {
            // Select all filtered
            setSelectedSubIds(prev => {
                const combined = new Set([...prev, ...filteredIds])
                return Array.from(combined)
            })
        }
    }

    if (loading) {
        return (
            <div className="flex justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!rotation) {
        return (
            <div className="text-center py-24">
                <p className="text-muted-foreground">Chain rotation not found.</p>
                <Button variant="outline" className="mt-4" onClick={() => router.push("/chain-rotations")}>
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back to Chain Rotations
                </Button>
            </div>
        )
    }

    // Determine leader
    const maxOpens = Math.max(...analytics.map((a: any) => a.openRate), 0)
    const maxClicks = Math.max(...analytics.map((a: any) => a.clickRate), 0)

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" onClick={() => router.push("/chain-rotations")}>
                    <ArrowLeft className="w-5 h-5" />
                </Button>
                <div className="flex-1">
                    {editingName ? (
                        <div className="flex items-center gap-2">
                            <Input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="text-xl font-bold h-10 max-w-sm"
                                autoFocus
                                onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") setEditingName(false) }}
                            />
                            <Button size="sm" onClick={handleSaveName}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingName(false)}>Cancel</Button>
                        </div>
                    ) : (
                        <h1
                            className="text-2xl font-bold text-foreground cursor-pointer hover:text-primary transition-colors"
                            onClick={() => setEditingName(true)}
                            title="Click to edit name"
                        >
                            {rotation.name}
                        </h1>
                    )}
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {rotation.chains.length} chains · Cursor at position {(rotation.cursor_position || 0) + 1}
                    </p>
                </div>
                <Button
                    onClick={() => { setShowEnrollPanel(!showEnrollPanel); if (!showEnrollPanel) loadTestSubscribers() }}
                    className="gap-2"
                >
                    <UserPlus className="w-4 h-4" />
                    Enroll Subscribers
                </Button>
            </div>

            {/* Chains in Rotation */}
            <div className="space-y-2">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <GitBranch className="h-3.5 w-3.5" /> Chains in Rotation
                </h2>
                <div className="grid gap-2">
                    {rotation.chains.map((chain: any, i: number) => {
                        const isNext = i === (rotation.cursor_position || 0) % rotation.chains.length
                        return (
                            <div
                                key={chain.id}
                                className={`rounded-lg border p-3 flex items-center justify-between ${isNext ? "border-primary/50 bg-primary/5" : "border-border bg-card"
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <span className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center ${isNext ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                        }`}>
                                        {i + 1}
                                    </span>
                                    <div>
                                        <p className="text-sm font-medium">{chain.name}</p>
                                        <p className="text-[10px] text-muted-foreground">
                                            {chain.chain_steps?.length || 0} steps
                                        </p>
                                    </div>
                                </div>
                                {isNext && (
                                    <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                                        Next Up
                                    </Badge>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Analytics Comparison */}
            <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5" /> Performance Comparison
                </h2>
                {analytics.length === 0 || analytics.every((a: any) => a.enrolled === 0) ? (
                    <div className="text-center py-8 border border-dashed border-border rounded-xl">
                        <BarChart3 className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No data yet</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">Enroll subscribers to start collecting performance data.</p>
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {analytics.map((stat: any) => {
                            const isOpenLeader = stat.openRate === maxOpens && maxOpens > 0
                            const isClickLeader = stat.clickRate === maxClicks && maxClicks > 0
                            return (
                                <div
                                    key={stat.chainId}
                                    className="rounded-xl border border-border bg-card p-4 space-y-3"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <GitBranch className="h-4 w-4 text-primary" />
                                            <span className="font-semibold">{stat.chainName}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            {isOpenLeader && (
                                                <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                                    <CheckCircle2 className="h-3 w-3 mr-1" /> Best Opens
                                                </Badge>
                                            )}
                                            {isClickLeader && (
                                                <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">
                                                    <CheckCircle2 className="h-3 w-3 mr-1" /> Best Clicks
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-5 gap-3">
                                        <div className="text-center">
                                            <p className="text-lg font-bold text-foreground">{stat.enrolled}</p>
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Enrolled</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-lg font-bold text-foreground">{stat.sends}</p>
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Sends</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-lg font-bold text-emerald-400">{stat.opens}</p>
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Opens</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-lg font-bold text-amber-400">{stat.clicks}</p>
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Clicks</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-lg font-bold text-foreground">{stat.completed}</p>
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Completed</p>
                                        </div>
                                    </div>
                                    {/* Rate bars */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-muted-foreground w-16">Open Rate</span>
                                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${stat.openRate}%` }} />
                                            </div>
                                            <span className="text-xs font-medium w-10 text-right">{stat.openRate}%</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-muted-foreground w-16">Click Rate</span>
                                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                                <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${stat.clickRate}%` }} />
                                            </div>
                                            <span className="text-xs font-medium w-10 text-right">{stat.clickRate}%</span>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Enroll Subscribers Panel */}
            {showEnrollPanel && (
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold flex items-center gap-1.5">
                            <Users className="h-4 w-4" /> Enroll Subscribers
                        </h3>
                        <Button variant="ghost" size="sm" onClick={() => setShowEnrollPanel(false)}>Close</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Each subscriber will be assigned to the next chain in the rotation (round-robin).
                    </p>

                    {loadingSubs ? (
                        <div className="flex justify-center py-4">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <>
                            {/* Search & Tag Filters */}
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                    <Input
                                        value={subSearch}
                                        onChange={(e) => setSubSearch(e.target.value)}
                                        placeholder="Search by name or email…"
                                        className="pl-8 h-8 text-sm"
                                    />
                                    {subSearch && (
                                        <button
                                            onClick={() => setSubSearch("")}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>

                                {/* Tag Filter Dropdown */}
                                <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0">
                                            <Tag className="h-3.5 w-3.5" />
                                            {selectedTags.length > 0 ? `${selectedTags.length} tag${selectedTags.length !== 1 ? "s" : ""}` : "Tags"}
                                            <ChevronDown className="h-3 w-3 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-56 p-0" align="end">
                                        <Command>
                                            <CommandInput placeholder="Search tags…" />
                                            <CommandList>
                                                <CommandEmpty>No tags found.</CommandEmpty>
                                                <CommandGroup>
                                                    {availableTags.map((tag) => {
                                                        const isActive = selectedTags.includes(tag)
                                                        return (
                                                            <CommandItem
                                                                key={tag}
                                                                onSelect={() => handleToggleTag(tag)}
                                                                className="flex items-center gap-2 cursor-pointer"
                                                            >
                                                                <div className={`h-3.5 w-3.5 rounded border flex items-center justify-center ${isActive ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                                                                    {isActive && <CheckCircle2 className="h-2.5 w-2.5 text-primary-foreground" />}
                                                                </div>
                                                                <span
                                                                    className="text-xs"
                                                                    style={tagColors[tag] ? { color: tagColors[tag] } : undefined}
                                                                >
                                                                    {tag}
                                                                </span>
                                                            </CommandItem>
                                                        )
                                                    })}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                            </div>

                            {/* Active tag pills */}
                            {selectedTags.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {selectedTags.map(tag => (
                                        <Badge
                                            key={tag}
                                            variant="outline"
                                            className="text-[10px] gap-1 cursor-pointer hover:bg-destructive/10"
                                            style={tagColors[tag] ? { borderColor: tagColors[tag] + "40", color: tagColors[tag] } : undefined}
                                            onClick={() => handleToggleTag(tag)}
                                        >
                                            {tag}
                                            <X className="h-2.5 w-2.5" />
                                        </Badge>
                                    ))}
                                    <button
                                        onClick={() => setSelectedTags([])}
                                        className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        Clear all
                                    </button>
                                </div>
                            )}

                            {/* Subscriber list */}
                            <div className="max-h-72 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                                {filteredSubscribers.length === 0 ? (
                                    <p className="p-4 text-sm text-muted-foreground text-center">No subscribers match your filters</p>
                                ) : filteredSubscribers.map((sub) => {
                                    const isSelected = selectedSubIds.includes(sub.id)
                                    const subTags: string[] = sub.tags || []
                                    return (
                                        <button
                                            key={sub.id}
                                            onClick={() => {
                                                setSelectedSubIds(prev =>
                                                    prev.includes(sub.id) ? prev.filter(x => x !== sub.id) : [...prev, sub.id]
                                                )
                                            }}
                                            className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-muted/30"
                                                }`}
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className={`truncate ${isSelected ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                                                    {sub.first_name ? `${sub.first_name} ${sub.last_name || ""}`.trim() : sub.email}
                                                </span>
                                                {sub.first_name && (
                                                    <span className="text-[10px] text-muted-foreground/60 truncate">{sub.email}</span>
                                                )}
                                                {subTags.slice(0, 3).map((t: string) => (
                                                    <span
                                                        key={t}
                                                        className="text-[9px] px-1.5 py-0 rounded-full border border-border"
                                                        style={tagColors[t] ? { borderColor: tagColors[t] + "40", color: tagColors[t] } : undefined}
                                                    >
                                                        {t}
                                                    </span>
                                                ))}
                                                {subTags.length > 3 && (
                                                    <span className="text-[9px] text-muted-foreground/50">+{subTags.length - 3}</span>
                                                )}
                                            </div>
                                            {isSelected && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                                        </button>
                                    )
                                })}
                            </div>

                            {/* Footer with select all, count, enroll */}
                            <div className="flex items-center justify-between pt-1">
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={handleSelectAllFiltered}
                                        className="text-xs text-primary hover:text-primary/80 transition-colors font-medium"
                                    >
                                        {filteredSubscribers.length > 0 && filteredSubscribers.every(s => selectedSubIds.includes(s.id))
                                            ? "Deselect all filtered"
                                            : `Select all filtered (${filteredSubscribers.length})`
                                        }
                                    </button>
                                    <p className="text-xs text-muted-foreground">
                                        {selectedSubIds.length} selected{filteredSubscribers.length !== testSubscribers.length && ` · Showing ${filteredSubscribers.length} of ${testSubscribers.length}`}
                                    </p>
                                </div>
                                <Button
                                    onClick={handleEnroll}
                                    disabled={enrolling || selectedSubIds.length === 0}
                                    className="gap-2"
                                >
                                    {enrolling ? (
                                        <><Loader2 className="h-4 w-4 animate-spin" /> Enrolling...</>
                                    ) : (
                                        <><UserPlus className="h-4 w-4" /> Enroll {selectedSubIds.length} Subscriber{selectedSubIds.length !== 1 ? "s" : ""}</>
                                    )}
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
