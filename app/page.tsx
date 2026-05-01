import Link from "next/link"
import { Mail, HeadphonesIcon, Music, ArrowRightLeft, Mic } from "lucide-react"

const workspaces = [
    {
        name: "DreamPlay Marketing",
        slug: "dreamplay_marketing",
        description: "Email campaigns, audience management, and analytics for DreamPlay Pianos.",
        icon: Mail,
        color: "from-amber-500/20 to-amber-600/5 border-amber-500/30 hover:border-amber-400/60",
        iconColor: "text-amber-400",
    },
    {
        name: "DreamPlay Support",
        slug: "dreamplay_support",
        description: "Customer support communications and automated follow-ups.",
        icon: HeadphonesIcon,
        color: "from-sky-500/20 to-sky-600/5 border-sky-500/30 hover:border-sky-400/60",
        iconColor: "text-sky-400",
    },
    {
        name: "MusicalBasics",
        slug: "musicalbasics",
        description: "Educational content, student outreach, and community newsletters.",
        icon: Music,
        color: "from-emerald-500/20 to-emerald-600/5 border-emerald-500/30 hover:border-emerald-400/60",
        iconColor: "text-emerald-400",
    },
    {
        name: "Crossover",
        slug: "crossover",
        description: "Cross-brand campaigns targeting overlapping audiences.",
        icon: ArrowRightLeft,
        color: "from-violet-500/20 to-violet-600/5 border-violet-500/30 hover:border-violet-400/60",
        iconColor: "text-violet-400",
    },
    {
        name: "Concert Marketing",
        slug: "concert_marketing",
        description: "Concert announcements, ticket promotions, and event-driven audience campaigns.",
        icon: Mic,
        color: "from-rose-500/20 to-rose-600/5 border-rose-500/30 hover:border-rose-400/60",
        iconColor: "text-rose-400",
    },
]

export default function GatewayPage() {
    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
            <div className="w-full max-w-3xl space-y-10">
                {/* Header */}
                <div className="text-center space-y-3">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-2">
                        <Music className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">
                        MusicalBasics Engine
                    </h1>
                    <p className="text-muted-foreground max-w-md mx-auto">
                        Select a workspace to begin. Each workspace is fully isolated with its own subscribers, campaigns, and settings.
                    </p>
                </div>

                {/* Workspace Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {workspaces.map((ws) => (
                        <Link
                            key={ws.slug}
                            href={`/${ws.slug}`}
                            className={`group relative rounded-xl border bg-gradient-to-br p-6 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${ws.color}`}
                        >
                            <div className="flex items-start gap-4">
                                <div className={`flex h-12 w-12 items-center justify-center rounded-lg bg-background/50 ${ws.iconColor}`}>
                                    <ws.icon className="h-6 w-6" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h2 className="text-lg font-semibold text-foreground group-hover:text-white transition-colors">
                                        {ws.name}
                                    </h2>
                                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                                        {ws.description}
                                    </p>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-muted-foreground/50">
                    v2.0 — Multi-Tenant Workspace Architecture
                </p>
            </div>
        </div>
    )
}
