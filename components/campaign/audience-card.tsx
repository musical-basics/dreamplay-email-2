"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Users, User, Pencil, Loader2, Check, Tag } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Campaign, Subscriber } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"

export interface Audience {
    total_subscribers: number
    active_subscribers: number
}

interface AudienceCardProps {
    audience: Audience
    campaign?: Campaign
    targetSubscriber?: Subscriber | null
}

interface BulkSubscriberInfo {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
}

export function AudienceCard({ audience, campaign, targetSubscriber }: AudienceCardProps) {
    const lockedSubscriberId = campaign?.variable_values?.subscriber_id
    const lockedSubscriberIds: string[] | undefined = campaign?.variable_values?.subscriber_ids
    const targetTag = campaign?.variable_values?.target_tag
    const { toast } = useToast()
    const router = useRouter()

    const [editing, setEditing] = useState(false)
    const [saving, setSaving] = useState(false)
    const [firstName, setFirstName] = useState(targetSubscriber?.first_name || "")
    const [lastName, setLastName] = useState(targetSubscriber?.last_name || "")
    const [email, setEmail] = useState(targetSubscriber?.email || "")

    // Bulk send: fetch subscriber details
    const [bulkSubscribers, setBulkSubscribers] = useState<BulkSubscriberInfo[]>([])
    const [loadingBulk, setLoadingBulk] = useState(false)

    useEffect(() => {
        if (lockedSubscriberIds && lockedSubscriberIds.length > 0) {
            setLoadingBulk(true)
            const supabase = createClient()
            supabase
                .from("subscribers")
                .select("id, email, first_name, last_name")
                .in("id", lockedSubscriberIds)
                .then(({ data }) => {
                    setBulkSubscribers(data || [])
                    setLoadingBulk(false)
                })
        }
    }, [lockedSubscriberIds?.length])

    const handleSave = async () => {
        if (!lockedSubscriberId) return
        setSaving(true)

        try {
            const res = await fetch("/api/update-subscriber", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    subscriberId: lockedSubscriberId,
                    campaignId: campaign?.id,
                    firstName,
                    lastName,
                    email,
                }),
            })
            const result = await res.json()

            if (result.error) {
                toast({ title: "Error updating subscriber", description: result.error, variant: "destructive" })
            } else if (result.switched) {
                const sub = result.subscriber
                setFirstName(sub.first_name || "")
                setLastName(sub.last_name || "")
                setEmail(sub.email || "")
                toast({
                    title: "Switched to existing subscriber",
                    description: `Matched ${sub.first_name || ""} ${sub.last_name || ""} (${sub.email}). Campaign target updated.`,
                })
                setEditing(false)
                router.refresh()
            } else {
                toast({ title: "Subscriber updated", description: "Destination info saved." })
                setEditing(false)
                router.refresh()
            }
        } catch (err) {
            toast({ title: "Error", description: "Failed to update subscriber.", variant: "destructive" })
        }
        setSaving(false)
    }

    const getInitials = (first: string | null, last: string | null) => {
        return `${(first || "").charAt(0)}${(last || "").charAt(0)}`.toUpperCase() || "?"
    }

    return (
        <Card className="border-border bg-card">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium text-foreground">
                    <Users className="h-5 w-5 text-[#D4AF37]" />
                    Target Audience
                </CardTitle>
            </CardHeader>
            <CardContent>
                {lockedSubscriberId ? (
                    <div className="flex items-start gap-4 bg-blue-500/10 p-4 rounded-lg border border-blue-500/20">
                        <User className="h-8 w-8 text-blue-400 mt-1 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="font-bold text-lg text-blue-400">1 Subscriber</p>
                            {editing ? (
                                <div className="mt-2 space-y-2">
                                    <input
                                        type="text"
                                        value={firstName}
                                        onChange={(e) => setFirstName(e.target.value)}
                                        placeholder="First name"
                                        className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-primary"
                                    />
                                    <input
                                        type="text"
                                        value={lastName}
                                        onChange={(e) => setLastName(e.target.value)}
                                        placeholder="Last name"
                                        className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-primary"
                                    />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="Email"
                                        className="w-full bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                                    />
                                    <div className="flex gap-2 pt-1">
                                        <button
                                            onClick={handleSave}
                                            disabled={saving}
                                            className="px-3 py-1 bg-blue-500 text-white text-xs font-medium rounded hover:bg-blue-600 transition-colors flex items-center gap-1.5"
                                        >
                                            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                            {saving ? "Saving..." : "Save"}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setEditing(false)
                                                setFirstName(targetSubscriber?.first_name || "")
                                                setLastName(targetSubscriber?.last_name || "")
                                                setEmail(targetSubscriber?.email || "")
                                            }}
                                            className="px-3 py-1 bg-muted text-muted-foreground text-xs font-medium rounded hover:bg-muted/80 transition-colors"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div
                                    className="mt-1 group cursor-pointer"
                                    onClick={() => setEditing(true)}
                                >
                                    <div className="flex items-center gap-1.5">
                                        <p className="text-sm font-medium text-blue-300">{firstName} {lastName}</p>
                                        <Pencil className="w-3 h-3 text-blue-400/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                    <p className="text-sm text-blue-300/80">{email}</p>
                                </div>
                            )}
                        </div>
                    </div>
                ) : targetTag ? (
                    <div className="flex items-start gap-4 bg-amber-500/10 p-4 rounded-lg border border-amber-500/20">
                        <Tag className="h-8 w-8 text-amber-400 mt-1 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="font-bold text-lg text-amber-400">Targeting Tag</p>
                            <p className="mt-1 text-sm text-amber-300">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/20 border border-amber-500/30 rounded-full text-xs font-semibold text-amber-300">
                                    <Tag className="h-3 w-3" />
                                    {targetTag}
                                </span>
                            </p>
                            <p className="mt-2 text-xs text-amber-300/60">Only subscribers with this tag will receive this campaign.</p>
                        </div>
                    </div>
                ) : lockedSubscriberIds && lockedSubscriberIds.length > 0 ? (
                    <div className="bg-purple-500/10 p-4 rounded-lg border border-purple-500/20">
                        <div className="flex items-center gap-3 mb-3">
                            <Users className="h-6 w-6 text-purple-400 flex-shrink-0" />
                            <p className="font-bold text-lg text-purple-400">{lockedSubscriberIds.length} Selected Subscriber{lockedSubscriberIds.length !== 1 ? 's' : ''}</p>
                        </div>
                        {loadingBulk ? (
                            <div className="flex justify-center py-3">
                                <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
                            </div>
                        ) : (
                            <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
                                {bulkSubscribers.map(sub => (
                                    <div key={sub.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-md bg-purple-500/5">
                                        <Avatar className="h-6 w-6 text-[10px]">
                                            <AvatarFallback className="bg-purple-500/20 text-purple-300 text-[10px]">
                                                {getInitials(sub.first_name, sub.last_name)}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm text-purple-200 truncate">
                                                {sub.first_name || sub.last_name
                                                    ? `${sub.first_name || ''} ${sub.last_name || ''}`.trim()
                                                    : sub.email}
                                            </p>
                                            {(sub.first_name || sub.last_name) && (
                                                <p className="text-[11px] text-purple-300/60 truncate">{sub.email}</p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <p className="mt-2 text-xs text-purple-300/60">Only these subscribers will receive this campaign.</p>
                    </div>
                ) : (campaign?.is_template || campaign?.status === "draft") ? (
                    <div className="flex items-start gap-4 bg-muted/30 p-4 rounded-lg border border-border">
                        <Users className="h-8 w-8 text-muted-foreground mt-1 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="font-bold text-lg text-muted-foreground">0 Recipients</p>
                            <p className="mt-2 text-sm text-muted-foreground">
                                {campaign?.is_template
                                    ? <>This is a master template. To send, select subscribers from the{" "}<a href="/audience" className="text-[#D4AF37] hover:underline">Audience page</a>{" "}and use &quot;Send Existing Campaign.&quot;</>
                                    : <>This is a draft. To send, select subscribers from the{" "}<a href="/audience" className="text-[#D4AF37] hover:underline">Audience page</a>{" "}and use &quot;Send Existing Campaign.&quot;</>
                                }
                            </p>
                        </div>
                    </div>
                ) : ((campaign?.status as any) === "completed" || (campaign?.status as any) === "sent") ? (
                    <div className="flex items-start gap-4 bg-emerald-500/10 p-4 rounded-lg border border-emerald-500/20">
                        <Users className="h-8 w-8 text-emerald-400 mt-1 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="font-bold text-lg text-emerald-400">
                                {(campaign?.total_recipients ?? 0).toLocaleString()} Recipient{(campaign?.total_recipients ?? 0) !== 1 ? 's' : ''}
                            </p>
                            <p className="mt-2 text-sm text-emerald-300/60">This campaign has already been sent.</p>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-bold tracking-tight text-foreground">
                                {audience.active_subscribers.toLocaleString()}
                            </span>
                            <span className="text-muted-foreground">Active Subscribers</span>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">All subscribers will receive this campaign when launched.</p>
                    </>
                )}
            </CardContent>
        </Card>
    )
}
