"use client"

import { useState } from "react"
import { X, Crown, Swords, ChevronDown, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

interface NewRoundModalProps {
    isOpen: boolean
    onClose: () => void
    onLaunch: (batchSize: number, champion: string, challenger: string) => void
    roundNumber?: number
    totalList?: number
    alreadyEmailed?: number
    defaultChampion?: { name: string; subject: string }
    versions?: { name: string; subject: string }[]
}

export function NewRoundModal({
    isOpen,
    onClose,
    onLaunch,
    roundNumber = 3,
    totalList = 10000,
    alreadyEmailed = 5500,
    defaultChampion = { name: "Version A", subject: "Big Sale" },
    versions = [
        { name: "Version A", subject: "Big Sale" },
        { name: "Version B", subject: "Flash Deals Today" },
        { name: "Version C", subject: "Your Exclusive Offer" },
        { name: "Version D", subject: "Limited Time Offer" },
        { name: "Version E", subject: "Exclusive Deal" },
    ],
}: NewRoundModalProps) {
    const availableNow = totalList - alreadyEmailed
    const [batchSize, setBatchSize] = useState(1000)
    const [selectedChampion, setSelectedChampion] = useState<string>(defaultChampion.name)
    const [selectedChallenger, setSelectedChallenger] = useState<string | null>(null)

    const splitSize = Math.floor(batchSize / 2)
    const remainingAfterRound = availableNow - batchSize

    const isSameVersion = selectedChallenger !== null && selectedChampion === selectedChallenger

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/20">
                            <Swords className="h-5 w-5 text-amber-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-foreground">Configure Round {roundNumber}</h2>
                            <p className="text-sm text-muted-foreground">Set up your next battle</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Audience Stats */}
                <div className="border-b border-border px-6 py-4">
                    <div className="mb-3 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Audience Progress</span>
                        <span className="font-medium text-foreground">
                            {((alreadyEmailed / totalList) * 100).toFixed(0)}% contacted
                        </span>
                    </div>

                    <div className="mb-4 h-3 overflow-hidden rounded-full bg-muted">
                        <div
                            className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all"
                            style={{ width: `${(alreadyEmailed / totalList) * 100}%` }}
                        />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div className="rounded-lg bg-muted/50 p-3 text-center">
                            <p className="text-xs text-muted-foreground">Total List</p>
                            <p className="text-lg font-semibold text-foreground">{totalList.toLocaleString()}</p>
                        </div>
                        <div className="rounded-lg bg-muted/50 p-3 text-center">
                            <p className="text-xs text-muted-foreground">Already Emailed</p>
                            <p className="text-lg font-semibold text-foreground">{alreadyEmailed.toLocaleString()}</p>
                        </div>
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
                            <p className="text-xs text-emerald-400">Available Now</p>
                            <p className="text-lg font-semibold text-emerald-400">{availableNow.toLocaleString()}</p>
                        </div>
                    </div>
                </div>

                {/* Section A: Audience Slider */}
                <div className="border-b border-border px-6 py-5">
                    <h3 className="mb-4 text-sm font-medium text-foreground">Batch Size for This Round</h3>

                    <Slider
                        value={[batchSize]}
                        onValueChange={([value]) => setBatchSize(value)}
                        max={availableNow}
                        min={100}
                        step={100}
                        className="mb-4"
                    />

                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                                <p className="text-xs text-amber-400/80">Sending to</p>
                                <p className="text-xl font-bold text-amber-400">{batchSize.toLocaleString()}</p>
                                <p className="text-xs text-amber-400/80">subscribers</p>
                            </div>
                            <div>
                                <p className="text-xs text-amber-400/80">Split</p>
                                <p className="text-xl font-bold text-amber-400">{splitSize.toLocaleString()}</p>
                                <p className="text-xs text-amber-400/80">per version</p>
                            </div>
                            <div>
                                <p className="text-xs text-amber-400/80">Remaining</p>
                                <p className="text-xl font-bold text-amber-400">{remainingAfterRound.toLocaleString()}</p>
                                <p className="text-xs text-amber-400/80">after round</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Section B: The Matchup */}
                <div className="px-6 py-5">
                    <h3 className="mb-4 text-sm font-medium text-foreground">The Matchup</h3>

                    <div className="grid grid-cols-2 gap-4">
                        <Card className="relative overflow-hidden border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-transparent p-4">
                            <div className="mb-3 flex items-center gap-2">
                                <Crown className="h-5 w-5 text-amber-400" />
                                <span className="text-xs font-medium uppercase tracking-wider text-amber-400">Champion (Default)</span>
                            </div>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button className="flex w-full items-center justify-between rounded-lg border border-amber-500/30 bg-background px-4 py-3 text-left transition-colors hover:border-amber-500/50 hover:bg-muted">
                                        <span className="font-medium text-foreground">{selectedChampion}</span>
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-56">
                                    {versions.map((version) => (
                                        <DropdownMenuItem
                                            key={version.name}
                                            onClick={() => setSelectedChampion(version.name)}
                                            className="flex flex-col items-start gap-1"
                                        >
                                            <span className="font-medium">
                                                {version.name}
                                                {version.name === defaultChampion.name && (
                                                    <span className="ml-2 text-xs text-amber-400">(Previous Winner)</span>
                                                )}
                                            </span>
                                            <span className="text-xs text-muted-foreground">Subject: "{version.subject}"</span>
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>

                            <p className="mt-3 text-sm text-muted-foreground">
                                Subject: "{versions.find((v) => v.name === selectedChampion)?.subject}"
                            </p>
                        </Card>

                        {/* Challenger Card (Selectable) */}
                        <Card className="border-border bg-muted/30 p-4">
                            <div className="mb-3 flex items-center gap-2">
                                <Swords className="h-5 w-5 text-muted-foreground" />
                                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Challenger</span>
                            </div>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:border-amber-500/50 hover:bg-muted">
                                        {selectedChallenger ? (
                                            <span className="font-medium text-foreground">{selectedChallenger}</span>
                                        ) : (
                                            <span className="text-muted-foreground">Select Version...</span>
                                        )}
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-56">
                                    {versions.map((version) => (
                                        <DropdownMenuItem
                                            key={version.name}
                                            onClick={() => setSelectedChallenger(version.name)}
                                            className="flex flex-col items-start gap-1"
                                        >
                                            <span className="font-medium">{version.name}</span>
                                            <span className="text-xs text-muted-foreground">Subject: "{version.subject}"</span>
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>

                            {selectedChallenger && (
                                <p className="mt-3 text-sm text-muted-foreground">
                                    Subject: "{versions.find((v) => v.name === selectedChallenger)?.subject}"
                                </p>
                            )}
                        </Card>
                    </div>

                    {/* VS Badge */}
                    <div className="relative -my-2 flex justify-center">
                        <div className="absolute top-1/2 -translate-y-1/2 rounded-full border border-border bg-card px-3 py-1 text-xs font-bold text-muted-foreground">
                            VS
                        </div>
                    </div>

                    {isSameVersion && (
                        <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
                            <AlertCircle className="h-4 w-4 text-red-400" />
                            <span className="text-sm text-red-400">Cannot test a version against itself.</span>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() =>
                            selectedChallenger && !isSameVersion && onLaunch(batchSize, selectedChampion, selectedChallenger)
                        }
                        disabled={!selectedChallenger || isSameVersion}
                        className="bg-gradient-to-r from-amber-500 to-amber-400 font-semibold text-black hover:from-amber-400 hover:to-amber-300 disabled:opacity-50"
                    >
                        <Swords className="mr-2 h-4 w-4" />
                        Fight!
                    </Button>
                </div>
            </div>
        </div>
    )
}
