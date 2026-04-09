"use client"

import { ArrowUp, ArrowDown, Plus, Trash2, Edit2, GripVertical, Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useState } from "react"

export interface Block {
    id: string
    name: string
    content: string
}

interface BlockManagerProps {
    blocks: Block[]
    activeBlockId: string | null
    onSelectBlock: (id: string) => void
    onUpdateBlocks: (blocks: Block[]) => void
    onAddBlock: () => void
}

export function BlockManager({ blocks, activeBlockId, onSelectBlock, onUpdateBlocks, onAddBlock }: BlockManagerProps) {
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editName, setEditName] = useState("")
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

    const moveBlock = (index: number, direction: -1 | 1, e: React.MouseEvent) => {
        e.stopPropagation()
        const newBlocks = [...blocks]
        if (direction === -1 && index > 0) {
            [newBlocks[index], newBlocks[index - 1]] = [newBlocks[index - 1], newBlocks[index]]
        } else if (direction === 1 && index < newBlocks.length - 1) {
            [newBlocks[index], newBlocks[index + 1]] = [newBlocks[index + 1], newBlocks[index]]
        }
        onUpdateBlocks(newBlocks)
    }

    const deleteBlock = (id: string, e: React.MouseEvent) => {
        e.stopPropagation()
        if (confirm("Delete this block?")) {
            const newBlocks = blocks.filter(b => b.id !== id)
            onUpdateBlocks(newBlocks)
            if (activeBlockId === id && newBlocks.length > 0) onSelectBlock(newBlocks[0].id)
        }
    }

    const startRenaming = (block: Block, e: React.MouseEvent) => {
        e.stopPropagation()
        setEditingId(block.id)
        setEditName(block.name)
    }

    const saveName = () => {
        if (editingId) {
            const newBlocks = blocks.map(b => b.id === editingId ? { ...b, name: editName } : b)
            onUpdateBlocks(newBlocks)
            setEditingId(null)
        }
    }

    // --- DnD HANDLERS ---
    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index)
        e.dataTransfer.effectAllowed = "move"
        // Transparent image or simple ref logic could be used here for preview
        // check browser default behavior
    }

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault() // Necessary for onDrop to fire
        e.dataTransfer.dropEffect = "move"
    }

    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault()
        if (draggedIndex === null || draggedIndex === dropIndex) return

        const newBlocks = [...blocks]
        const [movedItem] = newBlocks.splice(draggedIndex, 1)
        newBlocks.splice(dropIndex, 0, movedItem)

        onUpdateBlocks(newBlocks)
        setDraggedIndex(null)
    }

    return (
        <div className="flex flex-col h-full bg-card w-full">
            <div className="p-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-sm">
                    <Layers className="w-4 h-4 text-muted-foreground" />
                    <span>Layout Blocks</span>
                </div>
                <Button size="sm" variant="ghost" onClick={onAddBlock} className="h-8 w-8 p-0">
                    <Plus className="w-4 h-4" />
                </Button>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-2 space-y-1">
                    {blocks.map((block, index) => (
                        <div
                            key={block.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, index)}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDrop={(e) => handleDrop(e, index)}
                            onClick={() => onSelectBlock(block.id)}
                            className={cn(
                                "group flex items-center gap-2 p-2 rounded-md text-sm cursor-pointer border transition-all",
                                activeBlockId === block.id
                                    ? "bg-primary/10 border-primary/50 text-primary font-medium"
                                    : "bg-transparent border-transparent hover:bg-muted text-muted-foreground",
                                draggedIndex === index && "opacity-50 border-dashed border-primary"
                            )}
                        >
                            <GripVertical className="w-4 h-4 opacity-20 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing" />

                            {editingId === block.id ? (
                                <input
                                    className="flex-1 bg-background border rounded px-1 min-w-0"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    onBlur={saveName}
                                    onKeyDown={(e) => e.key === 'Enter' && saveName()}
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                />
                            ) : (
                                <span className="flex-1 truncate select-none">{block.name}</span>
                            )}

                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={(e) => startRenaming(block, e)} className="p-1 hover:text-foreground">
                                    <Edit2 className="w-3 h-3" />
                                </button>
                                <button onClick={(e) => moveBlock(index, -1, e)} className="p-1 hover:text-foreground" disabled={index === 0}>
                                    <ArrowUp className="w-3 h-3" />
                                </button>
                                <button onClick={(e) => moveBlock(index, 1, e)} className="p-1 hover:text-foreground" disabled={index === blocks.length - 1}>
                                    <ArrowDown className="w-3 h-3" />
                                </button>
                                <button onClick={(e) => deleteBlock(block.id, e)} className="p-1 hover:text-red-500">
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </ScrollArea>
        </div>
    )
}
