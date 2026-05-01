"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { Home, Mail, Users, PenTool, BarChart3, Settings, Music, Layers, ImageIcon, Route, MousePointerSquareDashed, Zap, Brain, Tag, TicketPercent, BotMessageSquare, ArrowDownToLine, ScrollText, RefreshCw, Target, ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"

interface NavGroup {
    label?: string
    items: { name: string; href: string; icon: any }[]
}

const navGroups: NavGroup[] = [
    {
        items: [
            { name: "Campaigns", href: "/", icon: Mail },
            { name: "Automated Emails", href: "/automated-emails", icon: BotMessageSquare },
            { name: "Triggers", href: "/triggers", icon: Zap },
            { name: "Audience", href: "/audience", icon: Users },
            { name: "Sales CRM", href: "/crm", icon: Target },
            { name: "Email Builder", href: "/editor", icon: PenTool },
        ],
    },
    {
        label: "Tools",
        items: [
            { name: "Assets Library", href: "/assets", icon: ImageIcon },
            { name: "Tags", href: "/tags", icon: Tag },
            { name: "Merge Tags", href: "/merge-tags", icon: Layers },
            { name: "Analytics", href: "/analytics", icon: BarChart3 },
            { name: "Journeys", href: "/journeys", icon: Route },
            { name: "Discounts", href: "/discounts", icon: TicketPercent },
            { name: "Rotations", href: "/rotations", icon: RefreshCw },
            { name: "Chain Rotations", href: "/chain-rotations", icon: Route },
            { name: "Logs", href: "/logs", icon: ScrollText },
            { name: "Mailchimp Import", href: "/migrate", icon: ArrowDownToLine },
        ],
    },
    {
        label: "Additional",
        items: [
            { name: "Old Homepage", href: "/old-homepage", icon: Home },
            { name: "Modular Builder", href: "/modular-editor", icon: Layers },
            { name: "Drag & Drop", href: "/dnd-editor", icon: MousePointerSquareDashed },
            { name: "Knowledge Builder", href: "/editor-v2", icon: Brain },
        ],
    },
]

// Map workspace slugs to display names
const WORKSPACE_LABELS: Record<string, string> = {
    dreamplay_marketing: "DreamPlay Marketing",
    dreamplay_support: "DreamPlay Support",
    musicalbasics: "MusicalBasics",
    crossover: "Crossover",
}

const WORKSPACE_COLORS: Record<string, string> = {
    dreamplay_marketing: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    dreamplay_support: "bg-sky-500/20 text-sky-300 border-sky-500/30",
    musicalbasics: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    crossover: "bg-violet-500/20 text-violet-300 border-violet-500/30",
}

export function AppSidebar() {
    const pathname = usePathname()
    const [pendingCount, setPendingCount] = useState(0)

    // Extract workspace from URL: /dreamplay_marketing/audience → "dreamplay_marketing"
    const segments = pathname.split("/").filter(Boolean)
    const workspace = segments[0] || "dreamplay_marketing"
    const workspaceLabel = WORKSPACE_LABELS[workspace] || workspace
    const workspaceColor = WORKSPACE_COLORS[workspace] || "bg-muted text-muted-foreground"

    // The "local" path within the workspace for active-state detection
    const localPath = "/" + segments.slice(1).join("/")

    // Fetch pending AI draft count
    useEffect(() => {
        const supabase = createClient()

        const fetchCount = async () => {
            const { data } = await supabase
                .from("campaigns")
                .select("id", { count: "exact" })
                .eq("status", "draft")
                .not("variable_values->is_jit_draft", "is", null)

            // Filter for is_jit_draft === true client-side
            const jitDrafts = (data || []).filter(
                (c: any) => c.variable_values?.is_jit_draft === true
            )
            setPendingCount(jitDrafts.length)
        }

        fetchCount()
        // Refresh every 60 seconds
        const interval = setInterval(fetchCount, 60000)
        return () => clearInterval(interval)
    }, [])

    return (
        <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-border bg-card">
            <div className="flex h-full flex-col">
                {/* Brand + Workspace Indicator */}
                <div className="border-b border-border px-4 py-3 space-y-2">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                            <Music className="h-5 w-5 text-primary-foreground" />
                        </div>
                        <span className="text-lg font-semibold text-foreground">Engine</span>
                    </div>
                    <div className={cn("flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs font-medium", workspaceColor)}>
                        <span className="truncate">{workspaceLabel}</span>
                        <Link
                            href="/"
                            className="flex items-center gap-1 text-[10px] opacity-70 hover:opacity-100 transition-opacity"
                            title="Switch Workspace"
                        >
                            <ArrowLeft className="h-3 w-3" />
                            Switch
                        </Link>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 overflow-y-auto px-3 py-4">
                    {navGroups.map((group, gi) => (
                        <div key={gi} className={gi > 0 ? "mt-4 pt-4 border-t border-border" : ""}>
                            {group.label && (
                                <p className="px-3 mb-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/60">
                                    {group.label}
                                </p>
                            )}
                            <div className="space-y-1">
                                {group.items.map((item) => {
                                    // Editor links stay outside workspace routing
                                    const isEditorLink = ["/editor", "/modular-editor", "/dnd-editor", "/editor-v2"].includes(item.href)
                                    const fullHref = isEditorLink ? item.href : `/${workspace}${item.href === "/" ? "" : item.href}`
                                    const isActive = isEditorLink
                                        ? pathname === item.href
                                        : localPath === item.href || (item.href === "/" && localPath === "/")
                                    return (
                                        <Link
                                            key={item.name}
                                            href={fullHref}
                                            className={cn(
                                                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                                                isActive
                                                    ? "bg-primary/10 text-primary"
                                                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                            )}
                                        >
                                            <item.icon className="h-5 w-5" />
                                            {item.name}
                                        </Link>
                                    )
                                })}
                            </div>
                        </div>
                    ))}

                    {/* Below separator */}
                    <div className="pt-4 mt-4 border-t border-border space-y-1">
                        <Link
                            href={`/${workspace}/approvals`}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                                localPath === "/approvals"
                                    ? "bg-violet-500/20 text-violet-300"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                        >
                            <Brain className="h-5 w-5" />
                            AI Approvals
                            {pendingCount > 0 && (
                                <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-violet-500 px-1.5 text-[10px] font-bold text-white">
                                    {pendingCount}
                                </span>
                            )}
                        </Link>
                        <Link
                            href={`/${workspace}/settings`}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                                localPath === "/settings"
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                        >
                            <Settings className="h-5 w-5" />
                            Settings
                        </Link>
                    </div>
                </nav>

                {/* Footer */}
                <div className="border-t border-border p-4">
                    <p className="text-xs text-muted-foreground">MusicalBasics Engine v2.0</p>
                </div>
            </div>
        </aside>
    )
}
