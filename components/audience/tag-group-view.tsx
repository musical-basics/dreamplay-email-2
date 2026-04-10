"use client"

import { useMemo } from "react"
import { Subscriber } from "@/lib/types"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Send, Users, Tag } from "lucide-react"
import { createCampaignForTag } from "@/app/actions/campaigns"
import { DEFAULT_WORKSPACE } from "@/lib/workspace"
import { useRouter, useParams } from "next/navigation"
import { useToast } from "@/hooks/use-toast"

interface TagGroupViewProps {
    subscribers: Subscriber[]
}

const tagColors: Record<string, string> = {
    Admin: "bg-red-500/20 text-red-400 border-red-500/30",
    Piano: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    Student: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Theory: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    VIP: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    Beginner: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    Advanced: "bg-orange-500/20 text-orange-400 border-orange-500/30",
}

export function TagGroupView({ subscribers }: TagGroupViewProps) {
    const router = useRouter()
    const { toast } = useToast()
    const params = useParams<{ workspace: string }>()

    const groupedSubscribers = useMemo(() => {
        const groups: Record<string, Subscriber[]> = {}

        // Initialize with known tags if we want to show empty ones, 
        // but for now let's just show tags that actually have subscribers
        // plus maybe an "Untagged" group if needed? User didn't specify "Untagged".

        subscribers.forEach(sub => {
            if (sub.tags && sub.tags.length > 0) {
                sub.tags.forEach(tag => {
                    if (!groups[tag]) {
                        groups[tag] = []
                    }
                    groups[tag].push(sub)
                })
            }
        })

        return groups
    }, [subscribers])

    const handleSendToTag = async (tagName: string) => {
        try {
            const result = await createCampaignForTag(DEFAULT_WORKSPACE, tagName)

            if (result.error) {
                throw new Error(result.error)
            }

            toast({
                title: "Campaign Draft Created",
                description: `Draft campaign for ${tagName} created. Redirecting...`,
            })

            if (result.data?.id) {
                router.push(`/editor?id=${result.data.id}${params?.workspace ? `&workspace=${params.workspace}` : ""}`)
            }
        } catch (error: any) {
            toast({
                title: "Error creating campaign",
                description: error.message,
                variant: "destructive",
            })
        }
    }

    const tagNames = Object.keys(groupedSubscribers).sort()

    if (tagNames.length === 0) {
        return (
            <div className="text-center py-20 bg-card rounded-lg border border-border border-dashed">
                <Tag className="h-10 w-10 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium text-foreground">No Tags Found</h3>
                <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                    Add tags to your subscribers to see them grouped here.
                </p>
            </div>
        )
    }

    return (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {tagNames.map(tagName => {
                const groupSubs = groupedSubscribers[tagName]
                const count = groupSubs.length
                const previewSubs = groupSubs.slice(0, 5) // First 5

                return (
                    <Card key={tagName} className="bg-card border-border flex flex-col">
                        <CardHeader className="pb-3">
                            <div className="flex justify-between items-start">
                                <CardTitle className="text-lg font-bold flex items-center gap-2">
                                    <Badge
                                        variant="outline"
                                        className={`text-base px-3 py-1 ${tagColors[tagName] || "bg-muted text-muted-foreground"}`}
                                    >
                                        {tagName}
                                    </Badge>
                                </CardTitle>
                                <span className="text-sm font-medium text-muted-foreground bg-muted px-2 py-1 rounded-md flex items-center gap-1">
                                    <Users className="h-3 w-3" />
                                    {count}
                                </span>
                            </div>
                        </CardHeader>
                        <CardContent className="flex-1">
                            <div className="space-y-3">
                                <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">
                                    Includes
                                </p>
                                <div className="space-y-1">
                                    {previewSubs.map(sub => (
                                        <div key={sub.id} className="text-sm text-foreground flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-primary/50" />
                                            <span className="truncate">
                                                {sub.first_name} {sub.last_name || sub.email}
                                            </span>
                                        </div>
                                    ))}
                                    {count > 5 && (
                                        <div className="text-xs text-muted-foreground pl-3.5 italic">
                                            ...and {count - 5} others
                                        </div>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter className="pt-2 border-t border-border/50 mt-auto">
                            <Button
                                className="w-full gap-2 bg-amber-500 text-zinc-900 hover:bg-amber-400"
                                onClick={() => handleSendToTag(tagName)}
                            >
                                <Send className="h-4 w-4" />
                                Send Email to {tagName}
                            </Button>
                        </CardFooter>
                    </Card>
                )
            })}
        </div>
    )
}
