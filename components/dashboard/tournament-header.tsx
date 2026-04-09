import { Badge } from "@/components/ui/badge"
import { Trophy, Users, Target } from "lucide-react"

interface TournamentHeaderProps {
    title: string
    status: string
    listSize: number
    remainingAudience: number
}

export function TournamentHeader({ title, status, listSize, remainingAudience }: TournamentHeaderProps) {
    return (
        <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
            <div className="container mx-auto px-4 py-4 max-w-4xl">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10">
                            <Trophy className="h-6 w-6 text-primary" />
                        </div>
                        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="border-live/50 bg-live/10 text-live">
                            <span className="mr-1.5 h-2 w-2 rounded-full bg-live animate-pulse-live" />
                            Status: {status}
                        </Badge>
                        <Badge variant="secondary" className="gap-1.5">
                            <Users className="h-3 w-3" />
                            List: {listSize.toLocaleString()}
                        </Badge>
                        <Badge variant="secondary" className="gap-1.5">
                            <Target className="h-3 w-3" />
                            Remaining: {remainingAudience.toLocaleString()}
                        </Badge>
                    </div>
                </div>
            </div>
        </header>
    )
}
