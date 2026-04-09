"use client"

import { useEffect, useState } from "react"
import { Loader2, Save, Copy, Check, Users, Link2, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { getMergeTags, updateMergeTagDefault, type MergeTagRow } from "@/app/actions/merge-tags"

const categoryConfig = {
    subscriber: { icon: Users, label: "Subscriber Fields", color: "text-blue-400", description: "Pulled from the subscriber's profile. Falls back to the default value if the field is empty." },
    global: { icon: Link2, label: "Global Links", color: "text-emerald-400", description: "Shared across all emails. These values are always used as-is." },
    dynamic: { icon: Zap, label: "Dynamic Variables", color: "text-amber-400", description: "Auto-generated at send time. You cannot edit these values — they are injected by the system." },
}

const categoryOrder: ("subscriber" | "global" | "dynamic")[] = ["subscriber", "global", "dynamic"]

export default function MergeTagsPage() {
    const [tags, setTags] = useState<MergeTagRow[]>([])
    const [loading, setLoading] = useState(true)
    const [editedDefaults, setEditedDefaults] = useState<Record<string, string>>({})
    const [saving, setSaving] = useState<string | null>(null)
    const [copied, setCopied] = useState<string | null>(null)
    const { toast } = useToast()

    useEffect(() => { loadTags() }, [])

    const loadTags = async () => {
        setLoading(true)
        const data = await getMergeTags()
        setTags(data)
        const defaults: Record<string, string> = {}
        data.forEach(t => { defaults[t.id] = t.default_value })
        setEditedDefaults(defaults)
        setLoading(false)
    }

    const handleSave = async (tag: MergeTagRow) => {
        const newDefault = editedDefaults[tag.id]
        if (newDefault === tag.default_value) return
        setSaving(tag.id)
        try {
            await updateMergeTagDefault(tag.id, newDefault ?? "")
            toast({ title: "Saved", description: `Default for {{${tag.tag}}} updated.` })
            await loadTags()
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        }
        setSaving(null)
    }

    const copyTag = (tag: string) => {
        navigator.clipboard.writeText(`{{${tag}}}`)
        setCopied(tag)
        setTimeout(() => setCopied(null), 2000)
    }

    if (loading) {
        return (
            <div className="p-6 flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading merge tags...
            </div>
        )
    }

    const grouped = categoryOrder.map(cat => ({
        category: cat,
        items: tags.filter(t => t.category === cat),
    })).filter(g => g.items.length > 0)

    return (
        <div className="p-6 space-y-6 max-w-4xl">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Merge Tags</h1>
                <p className="text-muted-foreground mt-1">
                    All <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{"{{variables}}"}</code> available in email templates. One place for subscriber fields, global links, and dynamic values.
                </p>
            </div>

            {grouped.length === 0 ? (
                <div className="border border-dashed border-border rounded-lg p-12 text-center">
                    <p className="text-muted-foreground">No merge tags configured. Run the SQL migration to seed defaults.</p>
                </div>
            ) : (
                <div className="space-y-8">
                    {grouped.map(({ category, items }) => {
                        const config = categoryConfig[category]
                        const Icon = config.icon
                        const isReadOnly = category === "dynamic"

                        return (
                            <div key={category}>
                                <div className="flex items-center gap-2 mb-1">
                                    <Icon className={`w-4 h-4 ${config.color}`} />
                                    <h2 className="text-sm font-semibold text-foreground">{config.label}</h2>
                                </div>
                                <p className="text-xs text-muted-foreground mb-3">{config.description}</p>

                                <div className="border border-border rounded-lg overflow-hidden">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-border bg-muted/30">
                                                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Field</th>
                                                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Merge Tag</th>
                                                {category === "subscriber" && (
                                                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Column</th>
                                                )}
                                                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                                                    {isReadOnly ? "Source" : "Default Value"}
                                                </th>
                                                {!isReadOnly && <th className="w-16 px-4 py-2.5"></th>}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {items.map(tag => {
                                                const hasChanged = (editedDefaults[tag.id] ?? "") !== tag.default_value
                                                return (
                                                    <tr key={tag.id} className="hover:bg-muted/20 transition-colors">
                                                        <td className="px-4 py-2.5 text-sm font-medium text-foreground">{tag.field_label}</td>
                                                        <td className="px-4 py-2.5">
                                                            <button
                                                                onClick={() => copyTag(tag.tag)}
                                                                className="inline-flex items-center gap-1.5 bg-primary/10 text-primary px-2 py-0.5 rounded font-mono text-xs hover:bg-primary/20 transition-colors cursor-pointer"
                                                                title="Click to copy"
                                                            >
                                                                {`{{${tag.tag}}}`}
                                                                {copied === tag.tag ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3 opacity-50" />}
                                                            </button>
                                                        </td>
                                                        {category === "subscriber" && (
                                                            <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{tag.subscriber_field}</td>
                                                        )}
                                                        <td className="px-4 py-2.5">
                                                            {isReadOnly ? (
                                                                <span className="text-xs text-muted-foreground/60 italic">Auto-generated at send time</span>
                                                            ) : (
                                                                <Input
                                                                    value={editedDefaults[tag.id] ?? ""}
                                                                    onChange={e => setEditedDefaults(prev => ({ ...prev, [tag.id]: e.target.value }))}
                                                                    placeholder="(empty)"
                                                                    className="h-7 text-xs max-w-[300px]"
                                                                />
                                                            )}
                                                        </td>
                                                        {!isReadOnly && (
                                                            <td className="px-4 py-2.5">
                                                                {hasChanged && (
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        onClick={() => handleSave(tag)}
                                                                        disabled={saving === tag.id}
                                                                        className="h-6 px-2 text-[10px]"
                                                                    >
                                                                        {saving === tag.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                                                    </Button>
                                                                )}
                                                            </td>
                                                        )}
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            <div className="bg-muted/30 border border-border rounded-lg p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">How it works</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• <strong>Subscriber fields</strong> pull from the subscriber&apos;s profile. If empty, the default value is used.</li>
                    <li>• <strong>Global links</strong> are replaced in every email with the configured URL.</li>
                    <li>• <strong>Dynamic variables</strong> are injected at send time (e.g. unique discount codes, unsubscribe links).</li>
                    <li>• Click any merge tag to copy it to your clipboard.</li>
                    <li>• These work in both <strong>Campaigns</strong> and <strong>Automated Emails</strong>.</li>
                </ul>
            </div>
        </div>
    )
}
