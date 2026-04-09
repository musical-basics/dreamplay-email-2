"use client"

import { useEffect, useState } from "react"
import { getVersions } from "@/app/actions/versions"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { History, Clock, RotateCcw } from "lucide-react"
import { formatDistanceToNow } from "date-fns"

interface Version {
    id: string
    created_at: string
    prompt: string
    html_content: string
}

interface HistorySheetProps {
    campaignId: string | null
    onRestore: (html: string) => void
}

export function HistorySheet({ campaignId, onRestore }: HistorySheetProps) {
    const [versions, setVersions] = useState<Version[]>([])
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)

    const loadVersions = async () => {
        if (!campaignId) return
        setLoading(true)
        try {
            const data = await getVersions(campaignId)
            if (data) setVersions(data)
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    // Load when sheet opens
    useEffect(() => {
        if (open) loadVersions()
    }, [open, campaignId])

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon" title="Version History">
                    <History className="w-4 h-4" />
                </Button>
            </SheetTrigger>
            <SheetContent className="w-[400px] gap-4 flex flex-col">
                <SheetHeader>
                    <SheetTitle>Version History</SheetTitle>
                    <SheetDescription>
                        Showing saved points for this campaign.
                    </SheetDescription>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto space-y-4 py-4 pr-2">
                    {loading && <div className="text-center text-sm text-muted-foreground">Loading...</div>}

                    {!loading && versions.length === 0 && (
                        <div className="text-center text-sm text-muted-foreground p-4 border border-dashed rounded-lg">
                            No history found yet.
                        </div>
                    )}

                    {versions.map((v) => (
                        <div key={v.id} className="group flex flex-col gap-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                                </span>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    className="h-6 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => {
                                        onRestore(v.html_content)
                                        setOpen(false)
                                    }}
                                >
                                    <RotateCcw className="w-3 h-3 mr-1" />
                                    Restore
                                </Button>
                            </div>
                            <p className="text-sm line-clamp-2 font-medium">
                                {v.prompt ? `"${v.prompt}"` : "Manual Save"}
                            </p>
                        </div>
                    ))}
                </div>
            </SheetContent>
        </Sheet>
    )
}
