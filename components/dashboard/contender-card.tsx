"use client"

import { Crown, Mail, MousePointer, TrendingUp, Gavel, CheckCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { Round } from "./tournament-dashboard"

interface Contender {
    id: string
    name: string
    subject: string
    openRate: number
    clickRate: number
    isWinner: boolean
}

interface ContenderCardProps {
    contender: Contender
    role: "Champion" | "Challenger"
    isLive: boolean
    roundStatus: Round["status"]
    onSelectWinner: () => void
}

export function ContenderCard({ contender, role, isLive, roundStatus, onSelectWinner }: ContenderCardProps) {
    const isWinner = contender.isWinner
    const isCompleted = roundStatus === "completed" || roundStatus === "completed-manual"
    const isPending = roundStatus === "pending"

    const showOverrideButton = !isPending && (isLive || (isCompleted && !isWinner))
    const showWinnerDeclared = isCompleted && isWinner
    const buttonLabel = isLive ? "Select as Winner" : "Override Winner"

    return (
        <div
            className={cn(
                "relative p-4 rounded-lg border transition-all",
                isWinner ? "border-winner/50 bg-winner/5" : "border-border bg-muted/30",
                isLive && "border-live/30",
            )}
        >
            {isWinner && (
                <div className="absolute -top-2 -right-2">
                    <div className="p-1.5 rounded-full bg-winner text-primary-foreground">
                        <Crown className="h-3.5 w-3.5" />
                    </div>
                </div>
            )}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <div
                        className={cn(
                            "h-10 w-10 rounded-lg flex items-center justify-center font-bold text-sm",
                            role === "Champion" ? "bg-primary/20 text-primary" : "bg-accent/20 text-accent",
                        )}
                    >
                        {contender.id}
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">{role}</p>
                        <p className="font-medium text-foreground">{contender.name}</p>
                    </div>
                </div>
                <div className="flex items-start gap-2 p-2 rounded-md bg-background/50">
                    <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-sm text-foreground leading-tight">"{contender.subject}"</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <TrendingUp className="h-3 w-3" />
                            Open Rate
                        </div>
                        <p
                            className={cn(
                                "text-lg font-semibold",
                                isWinner ? "text-winner" : "text-foreground",
                                isLive && "text-live",
                            )}
                        >
                            {contender.openRate}%{isLive && <span className="text-xs font-normal text-live ml-1">Rising...</span>}
                        </p>
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MousePointer className="h-3 w-3" />
                            Click Rate
                        </div>
                        <p className="text-lg font-semibold text-foreground">{contender.clickRate}%</p>
                    </div>
                </div>

                <div className="pt-3 border-t border-border/50">
                    {showWinnerDeclared ? (
                        <div className="flex items-center justify-center gap-2 py-2 text-winner text-sm font-medium">
                            <CheckCircle className="h-4 w-4" />
                            Winner Declared
                        </div>
                    ) : showOverrideButton ? (
                        <Button
                            variant="ghost"
                            className="w-full border border-dashed border-zinc-700 text-zinc-500 hover:border-yellow-500 hover:text-yellow-400 hover:bg-yellow-500/5"
                            onClick={onSelectWinner}
                        >
                            <Gavel className="h-4 w-4 mr-2" />
                            {buttonLabel}
                        </Button>
                    ) : null}
                </div>
            </div>
        </div>
    )
}
