"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import { Plus, Pencil, Trash2, Loader2, Tag, Users, X, Check, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { getTags, createTag, updateTag, deleteTag, toggleTagStar, TagDefinition } from "@/app/actions/tags"

export default function TagsPage() {
    const { workspace } = useParams<{ workspace: string }>()
    const [tags, setTags] = useState<TagDefinition[]>([])
    const [loading, setLoading] = useState(true)
    const [creating, setCreating] = useState(false)
    const [newTagName, setNewTagName] = useState("")
    const [newTagColor, setNewTagColor] = useState("#3b82f6")
    const [savingNew, setSavingNew] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editName, setEditName] = useState("")
    const [editColor, setEditColor] = useState("")
    const [saving, setSaving] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [colorPickingId, setColorPickingId] = useState<string | null>(null)
    const [pendingColor, setPendingColor] = useState<string>("")

    const fetchTags = useCallback(async () => {
        setLoading(true)
        const { tags: data } = await getTags(workspace)
        setTags(data)
        setLoading(false)
    }, [])

    useEffect(() => {
        fetchTags()
    }, [fetchTags])

    const handleCreate = async () => {
        const name = newTagName.trim()
        if (!name) return

        setSavingNew(true)
        const { tag, error } = await createTag(workspace, name, newTagColor)
        if (error) {
            console.error("Error creating tag:", error)
        } else {
            setNewTagName("")
            setNewTagColor("#3b82f6")
            setCreating(false)
            await fetchTags()
        }
        setSavingNew(false)
    }

    const startEdit = (tag: TagDefinition) => {
        setEditingId(tag.id)
        setEditName(tag.name)
        setEditColor(tag.color)
    }

    const cancelEdit = () => {
        setEditingId(null)
        setEditName("")
        setEditColor("")
    }

    const handleSaveEdit = async () => {
        if (!editingId || !editName.trim()) return

        setSaving(true)
        const updates: { name?: string; color?: string } = {}
        const currentTag = tags.find(t => t.id === editingId)

        if (currentTag && editName.trim() !== currentTag.name) {
            updates.name = editName.trim()
        }
        if (currentTag && editColor !== currentTag.color) {
            updates.color = editColor
        }

        if (Object.keys(updates).length > 0) {
            const { error } = await updateTag(workspace, editingId, updates)
            if (error) {
                console.error("Error updating tag:", error)
            } else {
                await fetchTags()
            }
        }

        cancelEdit()
        setSaving(false)
    }

    const handleDelete = async (tag: TagDefinition) => {
        const msg = tag.subscriber_count
            ? `Delete "${tag.name}"? This will remove it from ${tag.subscriber_count} subscriber${tag.subscriber_count !== 1 ? "s" : ""}.`
            : `Delete "${tag.name}"?`
        if (!confirm(msg)) return

        setDeletingId(tag.id)
        const { error } = await deleteTag(workspace, tag.id)
        if (error) {
            console.error("Error deleting tag:", error)
        } else {
            await fetchTags()
        }
        setDeletingId(null)
    }

    const startColorPick = (tag: TagDefinition) => {
        setColorPickingId(tag.id)
        setPendingColor(tag.color)
    }

    const cancelColorPick = () => {
        setColorPickingId(null)
        setPendingColor("")
    }

    const saveColor = async () => {
        if (!colorPickingId) return
        setSaving(true)
        const { error } = await updateTag(workspace, colorPickingId, { color: pendingColor })
        if (error) {
            console.error("Error updating color:", error)
        } else {
            await fetchTags()
        }
        setColorPickingId(null)
        setPendingColor("")
        setSaving(false)
    }

    return (
        <div className="p-6 max-w-3xl mx-auto">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Tags Manager</h1>
                    <p className="text-muted-foreground">Create, edit, and organize subscriber tags</p>
                </div>
                {!creating && (
                    <button
                        onClick={() => setCreating(true)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        New Tag
                    </button>
                )}
            </div>

            {/* Create New Tag */}
            {creating && (
                <div className="mb-6 rounded-lg border border-border bg-card p-5">
                    <h3 className="text-sm font-medium text-foreground mb-4">Create New Tag</h3>
                    <div className="flex items-end gap-3">
                        <div className="flex-1">
                            <label className="text-xs text-muted-foreground block mb-1.5">Name</label>
                            <input
                                autoFocus
                                value={newTagName}
                                onChange={(e) => setNewTagName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleCreate()
                                    if (e.key === "Escape") {
                                        setCreating(false)
                                        setNewTagName("")
                                    }
                                }}
                                placeholder="e.g. VIP Account"
                                className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground block mb-1.5">Color</label>
                            <input
                                type="color"
                                value={newTagColor}
                                onChange={(e) => setNewTagColor(e.target.value)}
                                className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
                            />
                        </div>
                    </div>
                    {/* Preview */}
                    <div className="mt-4 flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">Preview:</span>
                        <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white"
                            style={{ backgroundColor: newTagColor }}
                        >
                            {newTagName || "Tag Name"}
                        </span>
                    </div>
                    <div className="mt-4 flex items-center gap-2 justify-end">
                        <button
                            onClick={() => { setCreating(false); setNewTagName("") }}
                            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleCreate}
                            disabled={!newTagName.trim() || savingNew}
                            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                            {savingNew ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                            Create Tag
                        </button>
                    </div>
                </div>
            )}

            {/* Tags List */}
            <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="border-b border-border px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Tag className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">
                            {tags.length} tag{tags.length !== 1 ? "s" : ""}
                        </span>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-16">
                        <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
                    </div>
                ) : tags.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Tag className="w-10 h-10 text-muted-foreground/40 mb-3" />
                        <p className="text-muted-foreground">No tags yet. Create one to start organizing subscribers.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {tags.map(tag => (
                            <div
                                key={tag.id}
                                className={cn(
                                    "group flex items-center gap-4 px-5 py-3.5 transition-colors",
                                    editingId === tag.id ? "bg-muted/30" : "hover:bg-muted/20",
                                )}
                            >
                                {editingId === tag.id ? (
                                    /* ─── Edit Mode ─── */
                                    <>
                                        <input
                                            type="color"
                                            value={editColor}
                                            onChange={(e) => setEditColor(e.target.value)}
                                            className="w-8 h-8 rounded-full border border-border cursor-pointer bg-transparent p-0"
                                        />
                                        <input
                                            autoFocus
                                            value={editName}
                                            onChange={(e) => setEditName(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") handleSaveEdit()
                                                if (e.key === "Escape") cancelEdit()
                                            }}
                                            className="flex-1 px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                                        />
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={handleSaveEdit}
                                                disabled={saving || !editName.trim()}
                                                className="p-1.5 rounded-md text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
                                                title="Save"
                                            >
                                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                            </button>
                                            <button
                                                onClick={cancelEdit}
                                                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                                title="Cancel"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    /* ─── Display Mode ─── */
                                    <>
                                        {/* Color swatch — click to open picker, or show picker inline */}
                                        {colorPickingId === tag.id ? (
                                            <div className="flex items-center gap-1.5">
                                                <input
                                                    type="color"
                                                    value={pendingColor}
                                                    onChange={(e) => setPendingColor(e.target.value)}
                                                    className="w-8 h-8 rounded-full border border-border cursor-pointer bg-transparent p-0"
                                                    autoFocus
                                                />
                                                <button
                                                    onClick={saveColor}
                                                    disabled={saving}
                                                    className="p-1 rounded-md text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
                                                    title="Save color"
                                                >
                                                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                                </button>
                                                <button
                                                    onClick={cancelColorPick}
                                                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                                    title="Cancel"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => startColorPick(tag)}
                                                className="w-8 h-8 rounded-full border-2 border-transparent hover:border-border hover:scale-110 transition-all cursor-pointer"
                                                style={{ backgroundColor: tag.color }}
                                                title="Change color"
                                            />
                                        )}

                                        {/* Tag badge */}
                                        <div className="flex-1 min-w-0">
                                            <span
                                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium text-white"
                                                style={{ backgroundColor: tag.color }}
                                            >
                                                {tag.name}
                                            </span>
                                        </div>

                                        {/* Subscriber count */}
                                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                            <Users className="w-3.5 h-3.5" />
                                            <span>{tag.subscriber_count || 0}</span>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={async () => {
                                                    const { error } = await toggleTagStar(workspace, tag.id, !tag.is_starred)
                                                    if (!error) await fetchTags()
                                                }}
                                                className={cn(
                                                    "p-1.5 rounded-md transition-colors",
                                                    tag.is_starred
                                                        ? "text-amber-400 hover:bg-amber-500/10"
                                                        : "text-muted-foreground/40 hover:text-amber-400 hover:bg-amber-500/10 opacity-0 group-hover:opacity-100"
                                                )}
                                                title={tag.is_starred ? "Unstar tag" : "Star tag (shows as quick-add in subscriber editor)"}
                                            >
                                                <Star className={cn("w-3.5 h-3.5", tag.is_starred && "fill-current")} />
                                            </button>
                                            <button
                                                onClick={() => startEdit(tag)}
                                                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                                title="Edit tag"
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(tag)}
                                                disabled={deletingId === tag.id}
                                                className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                                title="Delete tag"
                                            >
                                                {deletingId === tag.id ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : (
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                )}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
