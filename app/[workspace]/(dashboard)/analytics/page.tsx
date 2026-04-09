"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
    BarChart3, Loader2, GitBranch, Sparkles, TrendingUp,
    MousePointer2, Eye, UserMinus, UserPlus, ShoppingCart, Package, Music, Piano, ArrowRightLeft,
    AlertTriangle, ShieldAlert
} from "lucide-react"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table"

interface PerformanceRow {
    name: string
    sends: number
    opens: number
    clicks: number
    unsubs: number
    bounces: number
    complaints: number
    t1: number
    t2: number
    t3: number
    open_rate: number
    click_rate: number
    unsub_rate: number
    bounce_rate: number
    complaint_rate: number
    t1_rate: number
    t2_rate: number
    t3_rate: number
}

function MetricCell({ count, rate, highlight }: { count: number; rate: number; highlight?: boolean }) {
    if (count === 0) return <span className="text-muted-foreground/40">—</span>

    return (
        <div className={highlight ? "text-emerald-400" : ""}>
            <span className="font-medium">{count.toLocaleString()}</span>
            <span className="text-muted-foreground text-[11px] ml-1">({rate}%)</span>
        </div>
    )
}

function PerformanceTable({ data, sendsLabel }: { data: PerformanceRow[]; sendsLabel: string }) {
    if (data.length === 0) {
        return (
            <div className="text-center py-16">
                <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                <p className="text-muted-foreground">No data yet. Performance data will appear once emails are sent and tracked.</p>
            </div>
        )
    }

    return (
        <div className="rounded-lg border border-border overflow-hidden">
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent border-border">
                        <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground w-[200px]">Name</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground text-center">{sendsLabel}</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground text-center">
                            <div className="flex items-center justify-center gap-1"><Eye className="h-3.5 w-3.5" /> Opens</div>
                        </TableHead>
                        <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground text-center">
                            <div className="flex items-center justify-center gap-1"><MousePointer2 className="h-3.5 w-3.5" /> Clicks</div>
                        </TableHead>
                        <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground text-center">
                            <div className="flex items-center justify-center gap-1"><UserMinus className="h-3.5 w-3.5" /> Unsubs</div>
                        </TableHead>
                        <TableHead className="text-xs uppercase tracking-wider font-semibold text-red-500/70 text-center">
                            <div className="flex items-center justify-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Bounces</div>
                        </TableHead>
                        <TableHead className="text-xs uppercase tracking-wider font-semibold text-red-500/70 text-center">
                            <div className="flex items-center justify-center gap-1"><ShieldAlert className="h-3.5 w-3.5" /> Spam</div>
                        </TableHead>
                        <TableHead className="text-xs uppercase tracking-wider font-semibold text-emerald-500/70 text-center">
                            <div className="flex items-center justify-center gap-1"><UserPlus className="h-3.5 w-3.5" /> T1: Accounts</div>
                        </TableHead>
                        <TableHead className="text-xs uppercase tracking-wider font-semibold text-emerald-500/70 text-center">
                            <div className="flex items-center justify-center gap-1"><ShoppingCart className="h-3.5 w-3.5" /> T2: Carts</div>
                        </TableHead>
                        <TableHead className="text-xs uppercase tracking-wider font-semibold text-emerald-500/70 text-center">
                            <div className="flex items-center justify-center gap-1"><Package className="h-3.5 w-3.5" /> T3: Orders</div>
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {data.map((row, i) => (
                        <TableRow key={i} className="border-border hover:bg-muted/30">
                            <TableCell className="font-medium text-foreground max-w-[200px] truncate">{row.name}</TableCell>
                            <TableCell className="text-center">
                                <Badge variant="secondary" className="font-mono text-xs">{row.sends.toLocaleString()}</Badge>
                            </TableCell>
                            <TableCell className="text-center"><MetricCell count={row.opens} rate={row.open_rate} /></TableCell>
                            <TableCell className="text-center"><MetricCell count={row.clicks} rate={row.click_rate} /></TableCell>
                            <TableCell className="text-center">
                                <MetricCell count={row.unsubs} rate={row.unsub_rate} />
                            </TableCell>
                            <TableCell className="text-center bg-red-500/[0.03]">
                                <MetricCell count={row.bounces} rate={row.bounce_rate} />
                            </TableCell>
                            <TableCell className="text-center bg-red-500/[0.03]">
                                <MetricCell count={row.complaints} rate={row.complaint_rate} />
                            </TableCell>
                            <TableCell className="text-center bg-emerald-500/[0.03]"><MetricCell count={row.t1} rate={row.t1_rate} highlight /></TableCell>
                            <TableCell className="text-center bg-emerald-500/[0.03]"><MetricCell count={row.t2} rate={row.t2_rate} highlight /></TableCell>
                            <TableCell className="text-center bg-emerald-500/[0.03]"><MetricCell count={row.t3} rate={row.t3_rate} highlight /></TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}

export default function AnalyticsPage() {
    const [templates, setTemplates] = useState<PerformanceRow[]>([])
    const [chains, setChains] = useState<PerformanceRow[]>([])
    const [byAudience, setByAudience] = useState<Record<string, { templates: PerformanceRow[]; chains: PerformanceRow[] }>>({})
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState<"templates" | "chains">("templates")
    const [audienceFilter, setAudienceFilter] = useState<"all" | "dreamplay" | "musicalbasics" | "both">("all")

    useEffect(() => {
        fetch("/api/analytics")
            .then(r => r.json())
            .then(data => {
                setTemplates(data.templates || [])
                setChains(data.chains || [])
                setByAudience(data.byAudience || {})
            })
            .catch(err => console.error("Analytics fetch error:", err))
            .finally(() => setLoading(false))
    }, [])

    // Summary stats
    const totalTemplateSends = templates.reduce((s, t) => s + t.sends, 0)
    const totalChainEnrolled = chains.reduce((s, c) => s + c.sends, 0)
    const totalConversions = [...templates, ...chains].reduce(
        (s, r) => s + r.t1 + r.t2 + r.t3, 0
    )

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <div className="flex items-center gap-3 mb-1">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                        <TrendingUp className="h-5 w-5 text-amber-500" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">Performance Analytics</h1>
                </div>
                <p className="text-muted-foreground">
                    Hard-attribution performance tracking for Master Templates and Automated Chains.
                </p>
            </div>

            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-card border-border">
                    <CardContent className="flex items-center gap-4 p-5">
                        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/10">
                            <Sparkles className="h-5 w-5 text-amber-500" />
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Template Sends</p>
                            <p className="text-2xl font-bold text-foreground">{totalTemplateSends.toLocaleString()}</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-card border-border">
                    <CardContent className="flex items-center gap-4 p-5">
                        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-500/10">
                            <GitBranch className="h-5 w-5 text-blue-500" />
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Chain Enrollments</p>
                            <p className="text-2xl font-bold text-foreground">{totalChainEnrolled.toLocaleString()}</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-card border-border">
                    <CardContent className="flex items-center gap-4 p-5">
                        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/10">
                            <Package className="h-5 w-5 text-emerald-500" />
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Total Conversions</p>
                            <p className="text-2xl font-bold text-foreground">{totalConversions.toLocaleString()}</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Audience Filter */}
            <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium">Audience:</span>
                {(["all", "dreamplay", "musicalbasics", "both"] as const).map(f => {
                    const labels: Record<string, { label: string; icon: React.ReactNode }> = {
                        all: { label: "All", icon: null },
                        dreamplay: { label: "DreamPlay", icon: <Piano className="h-3 w-3" /> },
                        musicalbasics: { label: "MusicalBasics", icon: <Music className="h-3 w-3" /> },
                        both: { label: "Crossover", icon: <ArrowRightLeft className="h-3 w-3" /> },
                    }
                    const { label, icon } = labels[f]
                    return (
                        <button
                            key={f}
                            onClick={() => setAudienceFilter(f)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors flex items-center gap-1.5 ${audienceFilter === f
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-muted/50 text-muted-foreground border-border hover:text-foreground hover:bg-muted"
                                }`}
                        >
                            {icon}
                            {label}
                        </button>
                    )
                })}
            </div>

            {/* Tab Bar */}
            <div className="flex gap-1 border-b border-border">
                <button
                    onClick={() => setActiveTab("templates")}
                    className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${activeTab === "templates" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        Master Templates
                        {templates.length > 0 && (
                            <span className="text-xs text-muted-foreground">({templates.length})</span>
                        )}
                    </div>
                    {activeTab === "templates" && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D4AF37]" />
                    )}
                </button>
                <button
                    onClick={() => setActiveTab("chains")}
                    className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${activeTab === "chains" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <GitBranch className="h-4 w-4" />
                        Automated Chains
                        {chains.length > 0 && (
                            <span className="text-xs text-muted-foreground">({chains.length})</span>
                        )}
                    </div>
                    {activeTab === "chains" && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D4AF37]" />
                    )}
                </button>
            </div>

            {/* Content */}
            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : (
                <>
                    {activeTab === "templates" && (
                        <PerformanceTable
                            data={audienceFilter === "all" ? templates : (byAudience[audienceFilter]?.templates || [])}
                            sendsLabel="Sends"
                        />
                    )}
                    {activeTab === "chains" && (
                        <PerformanceTable data={chains} sendsLabel="Enrolled" />
                    )}
                </>
            )}

            {/* Legend */}
            <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground pt-2">
                <span><UserPlus className="h-3 w-3 inline mr-1 text-emerald-500" />T1 = Account Created</span>
                <span><ShoppingCart className="h-3 w-3 inline mr-1 text-emerald-500" />T2 = Add to Cart</span>
                <span><Package className="h-3 w-3 inline mr-1 text-emerald-500" />T3 = Purchase</span>
                <span><AlertTriangle className="h-3 w-3 inline mr-1 text-red-500" />Bounce = Email undeliverable</span>
                <span><ShieldAlert className="h-3 w-3 inline mr-1 text-red-500" />Spam = Reported as spam</span>
                <span className="text-muted-foreground/50">• Chains use 7-day sliding window attribution</span>
            </div>
        </div>
    )
}
