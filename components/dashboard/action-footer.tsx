"use client"

import { Button } from "@/components/ui/button"
import { Play, Pause } from "lucide-react"

interface ActionFooterProps {
    onLaunchNextRound?: () => void
}

export function ActionFooter({ onLaunchNextRound }: ActionFooterProps) {
    return (
        <footer className="fixed bottom-0 left-0 right-0 border-t border-border bg-card/95 backdrop-blur-sm">
            <div className="container mx-auto px-4 py-4 max-w-4xl">
                <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
                    <Button variant="destructive" className="gap-2 order-2 sm:order-1">
                        <Pause className="h-4 w-4" />
                        Pause Tournament
                    </Button>
                    <Button
                        className="gap-2 order-1 sm:order-2 bg-primary text-primary-foreground hover:bg-primary/90"
                        onClick={onLaunchNextRound}
                    >
                        <Play className="h-4 w-4" />
                        Launch Next Round
                    </Button>
                </div>
            </div>
        </footer>
    )
}
