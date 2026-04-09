import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ContenderCard } from "./contender-card"
import { Lock, Swords } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Round } from "./tournament-dashboard"

interface RoundCardProps {
    round: Round
    onSelectWinner: (roundId: number, winner: "champion" | "challenger") => void
}

export function RoundCard({ round, onSelectWinner }: RoundCardProps) {
    const isPending = round.status === "pending"
    const isLive = round.status === "live"
    const isCompleted = round.status === "completed" || round.status === "completed-manual"
    const isManual = round.status === "completed-manual"

    return (
        <Card
            className={cn(
                "transition-all duration-300",
                isPending && "opacity-60 bg-muted/30",
                isLive && "ring-2 ring-live/50 bg-card",
            )}
        >
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">Round {round.id}</span>
                        {isLive && (
                            <Badge className="bg-live text-live-foreground gap-1.5 text-xs">
                                <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-live" />
                                LIVE
                            </Badge>
                        )}
                        {isCompleted && (
                            <Badge variant="secondary" className="text-xs">
                                {isManual ? "Completed (Manual)" : "Completed"}
                            </Badge>
                        )}
                        {isPending && (
                            <Badge variant="outline" className="text-xs gap-1 text-muted-foreground border-muted-foreground/30">
                                <Lock className="h-3 w-3" />
                                Pending
                            </Badge>
                        )}
                    </div>
                    <span className="text-sm text-muted-foreground">{round.sentDate}</span>
                </div>
            </CardHeader>
            <CardContent>
                {isPending ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                        <Lock className="h-5 w-5 mr-2" />
                        <span>Awaiting results from previous round</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
                        <ContenderCard
                            contender={round.champion}
                            role="Champion"
                            isLive={isLive}
                            roundStatus={round.status}
                            onSelectWinner={() => onSelectWinner(round.id, "champion")}
                        />
                        <div className="flex items-center justify-center">
                            <div className="p-2 rounded-full bg-muted">
                                <Swords className="h-5 w-5 text-muted-foreground" />
                            </div>
                        </div>
                        <ContenderCard
                            contender={round.challenger}
                            role="Challenger"
                            isLive={isLive}
                            roundStatus={round.status}
                            onSelectWinner={() => onSelectWinner(round.id, "challenger")}
                        />
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
