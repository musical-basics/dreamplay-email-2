"use client"

import { useState } from "react"
import { TournamentHeader } from "./tournament-header"
import { RoundCard } from "./round-card"
import { ActionFooter } from "./action-footer"

export interface Contender {
    id: string
    name: string
    subject: string
    openRate: number
    clickRate: number
    isWinner: boolean
}

export interface Round {
    id: number
    status: "completed" | "completed-manual" | "live" | "pending"
    sentDate: string
    champion: Contender
    challenger: Contender
}

const initialRounds: Round[] = [
    {
        id: 1,
        status: "completed",
        sentDate: "Nov 20, 2024",
        champion: {
            id: "A",
            name: "Version A",
            subject: "Big Sale Now",
            openRate: 24,
            clickRate: 4.2,
            isWinner: true,
        },
        challenger: {
            id: "B",
            name: "Version B",
            subject: "Hello Friend",
            openRate: 12,
            clickRate: 1.1,
            isWinner: false,
        },
    },
    {
        id: 2,
        status: "completed",
        sentDate: "Nov 22, 2024",
        champion: {
            id: "A",
            name: "Version A",
            subject: "Big Sale Now",
            openRate: 23,
            clickRate: 3.9,
            isWinner: true,
        },
        challenger: {
            id: "C",
            name: "Version C",
            subject: "50% Off Today",
            openRate: 21,
            clickRate: 5.5,
            isWinner: false,
        },
    },
    {
        id: 3,
        status: "live",
        sentDate: "Nov 24, 2024",
        champion: {
            id: "A",
            name: "Version A",
            subject: "Big Sale Now",
            openRate: 15,
            clickRate: 2.1,
            isWinner: false,
        },
        challenger: {
            id: "D",
            name: "Version D",
            subject: "The Final Countdown",
            openRate: 19,
            clickRate: 3.2,
            isWinner: false,
        },
    },
    {
        id: 4,
        status: "pending",
        sentDate: "Scheduled: Nov 26, 2024",
        champion: {
            id: "?",
            name: "Winner of Round 3",
            subject: "TBD",
            openRate: 0,
            clickRate: 0,
            isWinner: false,
        },
        challenger: {
            id: "E",
            name: "Version E",
            subject: "Last Chance",
            openRate: 0,
            clickRate: 0,
            isWinner: false,
        },
    },
]

interface TournamentDashboardProps {
    onLaunchNextRound?: () => void
}

export function TournamentDashboard({ onLaunchNextRound }: TournamentDashboardProps) {
    const [rounds, setRounds] = useState<Round[]>(initialRounds)

    const handleSelectWinner = (roundId: number, winner: "champion" | "challenger") => {
        setRounds((prevRounds) =>
            prevRounds.map((round) => {
                if (round.id !== roundId) return round

                const isLive = round.status === "live"
                return {
                    ...round,
                    status: isLive ? "completed-manual" : round.status,
                    champion: {
                        ...round.champion,
                        isWinner: winner === "champion",
                    },
                    challenger: {
                        ...round.challenger,
                        isWinner: winner === "challenger",
                    },
                }
            }),
        )
    }

    return (
        <div className="min-h-screen bg-background pb-24">
            <TournamentHeader title="Black Friday Promo" status="Active" listSize={10000} remainingAudience={4500} />
            <main className="container mx-auto px-4 py-6 max-w-4xl">
                <div className="space-y-4">
                    {rounds.map((round) => (
                        <RoundCard key={round.id} round={round} onSelectWinner={handleSelectWinner} />
                    ))}
                </div>
            </main>
            <ActionFooter onLaunchNextRound={onLaunchNextRound} />
        </div>
    )
}
