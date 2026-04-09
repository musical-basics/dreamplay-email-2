"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { AssetLoader } from "./asset-loader"
import { HistorySheet } from "./history-sheet"
import { CampaignPicker } from "./campaign-picker"
import { CodePane } from "./code-pane"
import { PreviewPane } from "./preview-pane"
import { CopilotPane } from "./copilot-pane"
import { BlockManager, Block } from "./block-manager"
import { DiscountManagerModal } from "./discount-manager-modal"
import { renderTemplate } from "@/lib/render-template"
import { Monitor, Smartphone, Loader2, Check, ArrowLeft, Undo, Redo, History, Code } from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import { saveVersion } from "@/app/actions/versions"
import { getCampaignBackups } from "@/app/actions/campaigns"
import { useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { formatDistanceToNow } from "date-fns"

interface ModularEmailEditorProps {
    html: string
    assets: Record<string, string>
    subjectLine: string
    fromName: string
    fromEmail: string
    audienceContext: "dreamplay" | "musicalbasics" | "both"
    aiDossier?: string
    onHtmlChange: (html: string) => void
    onAssetsChange: (assets: Record<string, string>) => void
    onSubjectChange: (value: string) => void
    onSenderChange: (field: "name" | "email", value: string) => void
    onAudienceChange: (value: "dreamplay" | "musicalbasics" | "both") => void
    campaignName: string
    onNameChange: (name: string) => void
    onSave?: () => void
    campaignId?: string | null
    onRestore?: (backup: { html_content: string; variable_values: Record<string, any>; subject_line: string }) => void
}

// --- HELPER: SMART SPLITTER ---
// This function tears apart a monolithic HTML file into logical blocks
const parseMonolithToBlocks = (fullHtml: string): Block[] => {
    const blocks: Block[] = []

    // 1. Extract HEAD (Global Styles)
    const headMatch = fullHtml.match(/(^[\s\S]*?<body[^>]*>)/i)
    const headContent = headMatch ? headMatch[1] : ""
    blocks.push({ id: "head", name: "Global Styles & Head", content: headContent })

    // 2. Extract FOOTER (Closing tags)
    const closeMatch = fullHtml.match(/(<\/body>[\s\S]*$)/i)
    const closeContent = closeMatch ? closeMatch[1] : ""

    // 3. Extract BODY CONTENT
    let bodyContent = fullHtml
    if (headContent) bodyContent = bodyContent.replace(headContent, "")
    if (closeContent) bodyContent = bodyContent.replace(closeContent, "")
    bodyContent = bodyContent.trim()

    // 4. MAGIC: Split Body into Logical Sections
    // We look for top-level HTML tags that look like containers.
    // Regex explanation: Find a tag that starts with <div, <table, <section and capture everything until it closes.
    // Note: Regex parsing HTML is fragile, but sufficient for top-level block splitting in emails.

    // Strategy: We split by "<!-- BLOCK: Name -->" comments if they exist.
    // If NOT, we try to split by standard container tags.

    const commentSplit = bodyContent.split(/<!-- BLOCK: (.*?) -->/i)

    if (commentSplit.length > 1) {
        // Option A: The user already has "BLOCK:" comments. Use them!
        // The split array looks like: [pre-text, "Block Name 1", "Content 1", "Block Name 2", "Content 2"...]
        for (let i = 1; i < commentSplit.length; i += 2) {
            const name = commentSplit[i].trim()
            const content = commentSplit[i + 1]?.trim() || ""
            blocks.push({ id: `block-${i}`, name: name, content: content })
        }
    } else {
        // Option B: The "Wild West". We assume every top-level <table> or <div> is a block.
        // We wrap them in comments so they persist next time.

        // This regex looks for high-level containers
        const tagRegex = /(<(table|div|section)[^>]*>[\s\S]*?<\/\2>)/gi
        let match
        let lastIndex = 0
        let count = 1

        while ((match = tagRegex.exec(bodyContent)) !== null) {
            // content BEFORE the tag (usually whitespace or stray text)
            const gap = bodyContent.slice(lastIndex, match.index).trim()
            if (gap) {
                blocks.push({ id: `gap-${count}`, name: `Text Section ${count}`, content: gap })
            }

            // The TAG itself
            const tagContent = match[0]
            // Try to guess a name based on content
            let name = `Section ${count}`
            if (tagContent.includes("img")) name = `Image Block ${count}`
            if (tagContent.includes("<h")) name = `Text/Header Block ${count}`
            if (tagContent.includes("button") || tagContent.includes("<a ")) name = `CTA Block ${count}`
            if (tagContent.includes("social")) name = "Social Links"

            blocks.push({ id: `auto-${count}`, name: name, content: tagContent })

            lastIndex = tagRegex.lastIndex
            count++
        }

        // Catch any trailing content
        const tail = bodyContent.slice(lastIndex).trim()
        if (tail) blocks.push({ id: "tail", name: "Footer Content", content: tail })
    }

    // 5. Add Footer
    blocks.push({ id: "footer", name: "Closing Tags", content: closeContent })

    return blocks
}


export function ModularEmailEditor({
    html: initialHtml,
    assets,
    subjectLine,
    fromName,
    fromEmail,
    audienceContext,
    aiDossier,
    onHtmlChange,
    onAssetsChange,
    onSubjectChange,
    onSenderChange,
    onAudienceChange,
    campaignName,
    onNameChange,
    onSave,
    campaignId: campaignIdProp,
    onRestore
}: ModularEmailEditorProps) {
    const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop')
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle')
    const [isCodeOpen, setIsCodeOpen] = useState(false)
    const { toast } = useToast()


    // INITIALIZE BLOCKS using the new Smart Parser
    const [blocks, setBlocks] = useState<Block[]>(() => parseMonolithToBlocks(initialHtml))

    const [activeBlockId, setActiveBlockId] = useState<string>(blocks[1]?.id || blocks[0].id)

    // HISTORY & VERSIONING
    const searchParams = useSearchParams()
    const campaignId = campaignIdProp || searchParams.get("id")
    const [history, setHistory] = useState<string[]>([])
    const [historyIndex, setHistoryIndex] = useState(-1)

    // Init history with initial state
    useEffect(() => {
        if (history.length === 0 && initialHtml) {
            setHistory([initialHtml])
            setHistoryIndex(0)
        }
    }, [])

    // Reconstruct full HTML from blocks + Enforce Block Comments
    const fullHtml = useMemo(() => {
        return blocks.map(b => {
            // Don't wrap head/footer in comments to keep file clean
            if (b.id === 'head' || b.id === 'footer') return b.content

            // Wrap others in "Markers" so the parser finds them next time
            return `<!-- BLOCK: ${b.name} -->\n${b.content}`
        }).join('\n\n')
    }, [blocks])

    // Sync to parent
    useEffect(() => {
        onHtmlChange(fullHtml)
    }, [fullHtml, onHtmlChange])

    const activeBlock = useMemo(() => blocks.find(b => b.id === activeBlockId) || blocks[0], [blocks, activeBlockId])

    const handleBlockContentChange = (newContent: string) => {
        setBlocks(prev => prev.map(b => b.id === activeBlockId ? { ...b, content: newContent } : b))
    }

    const addNewBlock = () => {
        const newBlock: Block = {
            id: `block-${Date.now()}`,
            name: "New Section",
            content: "<div style='padding: 20px;'>New Content</div>"
        }
        const index = blocks.findIndex(b => b.id === activeBlockId)
        const newBlocks = [...blocks]
        newBlocks.splice(index + 1, 0, newBlock)
        setBlocks(newBlocks)
        setActiveBlockId(newBlock.id)
    }

    // --- STANDARD UTILS ---
    const extractedVariables = useMemo(() => {
        const regex = /\{\{(\w+)\}\}/g
        const matches: string[] = []
        let match
        while ((match = regex.exec(fullHtml)) !== null) {
            if (!matches.includes(match[1])) matches.push(match[1])
        }
        return matches
    }, [fullHtml])

    const updateAsset = useCallback((key: string, value: string) => {
        onAssetsChange({ ...assets, [key]: value })
    }, [assets, onAssetsChange])

    const previewHtml = useMemo(() => renderTemplate(fullHtml, assets), [fullHtml, assets])

    // Campaign backup version history
    const [backups, setBackups] = useState<{ id: string; saved_at: string; subject_line: string }[]>([])
    const [historyDropdownOpen, setHistoryDropdownOpen] = useState(false)
    const [restoringId, setRestoringId] = useState<string | null>(null)
    const historyDropdownRef = useRef<HTMLDivElement>(null)

    const fetchBackups = useCallback(async () => {
        if (!campaignId) return
        const data = await getCampaignBackups(campaignId)
        setBackups(data)
    }, [campaignId])

    useEffect(() => {
        fetchBackups()
    }, [fetchBackups])

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (historyDropdownRef.current && !historyDropdownRef.current.contains(e.target as Node)) {
                setHistoryDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const handleSaveClick = async () => {
        if (!onSave) return
        setSaveStatus('saving')
        await Promise.resolve(onSave())
        await fetchBackups()
        setSaveStatus('success')
        setTimeout(() => setSaveStatus('idle'), 2000)
    }

    const handleCopilotUpdate = async (newHtml: string, prompt: string) => {
        // A. Save Version (Fire & Forget)
        if (campaignId) {
            saveVersion(campaignId, newHtml, prompt).catch(console.error)
        }

        // B. Update History
        const newHistory = history.slice(0, historyIndex + 1)
        newHistory.push(newHtml)
        setHistory(newHistory)
        setHistoryIndex(newHistory.length - 1)

        // C. Apply Logic
        if (newHtml.includes("<body") || newHtml.includes("<!DOCTYPE") || newHtml.includes("Global Styles")) {
            const newBlocks = parseMonolithToBlocks(newHtml)
            setBlocks(newBlocks)
            // Try to keep the active block if it still exists, otherwise default
            if (!newBlocks.some(b => b.id === activeBlockId)) {
                setActiveBlockId(newBlocks[1]?.id || newBlocks[0].id)
            }
        } else {
            handleBlockContentChange(newHtml)
        }
    }

    const handleUndo = () => {
        if (historyIndex > 0) {
            const prevHtml = history[historyIndex - 1]
            setHistoryIndex(historyIndex - 1)
            setBlocks(parseMonolithToBlocks(prevHtml))
        }
    }

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            const nextHtml = history[historyIndex + 1]
            setHistoryIndex(historyIndex + 1)
            setBlocks(parseMonolithToBlocks(nextHtml))
        }
    }

    return (
        <div className="flex h-screen bg-background text-foreground overflow-hidden">
            {/* 1. UNIFIED SIDEBAR (Assets + Blocks) */}
            <div className="flex-shrink-0 w-[300px] border-r border-border h-full flex flex-col bg-card">
                {/* Header Link */}
                <div className="p-3 border-b border-border">
                    <Link href="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <ArrowLeft className="w-3 h-3" />
                        Back to Dashboard
                    </Link>
                </div>

                <div className="p-4 border-b border-border bg-muted/20 space-y-4">
                    {/* Campaign Settings */}
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Subject Line</label>
                            <input
                                type="text"
                                value={subjectLine}
                                onChange={(e) => onSubjectChange(e.target.value)}
                                className="w-full bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-primary"
                                placeholder="Enter subject line..."
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-semibold text-muted-foreground">From Name</label>
                                <input
                                    type="text"
                                    value={fromName}
                                    onChange={(e) => onSenderChange("name", e.target.value)}
                                    className="w-full bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-primary"
                                    placeholder="Lionel Yu"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-semibold text-muted-foreground">From Email</label>
                                <input
                                    type="text"
                                    value={fromEmail}
                                    onChange={(e) => onSenderChange("email", e.target.value)}
                                    className="w-full bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-primary"
                                    placeholder="lionel@..."
                                />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Target Audience</label>
                            <select
                                value={audienceContext}
                                onChange={(e) => onAudienceChange(e.target.value as any)}
                                className="w-full bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-primary cursor-pointer"
                            >
                                <option value="dreamplay">DreamPlay</option>
                                <option value="musicalbasics">MusicalBasics</option>
                                <option value="both">Both (Crossover)</option>
                            </select>
                        </div>
                        <div className="pt-3 border-t border-border mt-3">
                            <DiscountManagerModal assets={assets} onAssetsChange={onAssetsChange} />
                        </div>
                    </div>
                </div>
                {/* Top Half: Blocks */}
                <div className="flex-1 overflow-hidden border-b border-border">
                    <BlockManager
                        blocks={blocks}
                        activeBlockId={activeBlockId}
                        onSelectBlock={setActiveBlockId}
                        onUpdateBlocks={setBlocks}
                        onAddBlock={addNewBlock}
                    />
                </div>

                {/* Bottom Half: Assets */}
                <div className="h-[50%] overflow-hidden">
                    <AssetLoader variables={extractedVariables} assets={assets} onUpdateAsset={updateAsset} showBackButton={false} />
                </div>
            </div>

            {/* 2. CODE PANE (Edits Active Block Only) */}
            {isCodeOpen && (
                <div className="flex-[3] min-w-[350px] border-r border-border h-full flex flex-col transition-all duration-300 ease-in-out">
                    <div className="h-10 border-b border-border bg-muted/30 px-4 flex items-center justify-between text-xs flex-shrink-0">
                        <span className="text-muted-foreground">Editing: <span className="font-bold text-foreground">{activeBlock.name}</span></span>
                    </div>
                    <CodePane code={activeBlock.content} onChange={handleBlockContentChange} className="flex-1" />
                </div>
            )}

            {/* 3. PREVIEW PANE */}
            <div className="flex-[4] flex flex-col min-w-[500px] h-full overflow-hidden">
                <div className="h-14 border-b border-border flex items-center justify-between px-4 bg-card flex-shrink-0">
                    <h2 className="text-sm font-semibold">Preview</h2>

                    <div className="flex items-center gap-2">
                        {/* History */}
                        <HistorySheet
                            campaignId={campaignId}
                            onRestore={(html) => handleCopilotUpdate(html, "Restored from History")}
                        />

                        {/* Campaign Name Editing */}
                        <div className="flex items-center gap-2 border-l border-border pl-2 mr-2">
                            <input
                                type="text"
                                value={campaignName}
                                onChange={(e) => onNameChange(e.target.value)}
                                className="bg-transparent border-none text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary/30 rounded px-2 w-[180px] text-foreground placeholder:text-muted-foreground"
                                placeholder="Campaign Name"
                            />
                        </div>

                        {/* Open Campaign */}
                        <CampaignPicker currentId={campaignId} editorType="modular" />

                        {/* Undo/Redo */}
                        <div className="flex bg-muted p-1 rounded-lg">
                            <button
                                onClick={handleUndo}
                                disabled={historyIndex <= 0}
                                className="p-1.5 rounded-md hover:bg-background disabled:opacity-30 transition-colors"
                                title="Undo"
                            >
                                <Undo className="w-4 h-4" />
                            </button>
                            <button
                                onClick={handleRedo}
                                disabled={historyIndex >= history.length - 1}
                                className="p-1.5 rounded-md hover:bg-background disabled:opacity-30 transition-colors"
                                title="Redo"
                            >
                                <Redo className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="flex bg-muted p-1 rounded-lg">
                            <button onClick={() => setViewMode('desktop')} className={cn("p-1.5 rounded-md", viewMode === 'desktop' && "bg-background shadow-sm")}><Monitor className="w-4 h-4" /></button>
                            <button onClick={() => setViewMode('mobile')} className={cn("p-1.5 rounded-md", viewMode === 'mobile' && "bg-background shadow-sm")}><Smartphone className="w-4 h-4" /></button>
                        </div>

                        {/* Code Toggle */}
                        <div className="flex items-center gap-1 ml-2">
                            <button
                                onClick={() => setIsCodeOpen(!isCodeOpen)}
                                className={cn(
                                    "p-2 rounded-md transition-all text-sm font-medium border",
                                    isCodeOpen
                                        ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                                        : "bg-muted text-muted-foreground hover:text-foreground border-transparent"
                                )}
                                title={isCodeOpen ? "Hide Code" : "Show Code"}
                            >
                                <Code className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {onSave && (
                        <button type="button" onClick={handleSaveClick} disabled={saveStatus === 'saving'} className={cn("px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2", saveStatus === 'success' ? "bg-green-600 text-white" : "bg-primary text-primary-foreground")}>
                            {saveStatus === 'saving' && <Loader2 className="w-4 h-4 animate-spin" />}
                            {saveStatus === 'success' && <Check className="w-4 h-4" />}
                            {saveStatus === 'idle' && "Save"}
                        </button>
                    )}

                    {/* Version History Dropdown */}
                    {campaignId && backups.length > 0 && (
                        <div className="relative" ref={historyDropdownRef}>
                            <button
                                type="button"
                                onClick={() => setHistoryDropdownOpen(!historyDropdownOpen)}
                                className="p-2 rounded-md text-sm font-medium border border-border bg-background hover:bg-muted transition-all flex items-center gap-1.5"
                                title="Version History"
                            >
                                <History className="w-4 h-4" />
                                <span className="text-xs text-muted-foreground">{backups.length}</span>
                            </button>
                            {historyDropdownOpen && (
                                <div className="absolute top-full right-0 mt-1 w-64 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                                    <div className="px-3 py-2 border-b border-border">
                                        <p className="text-xs font-semibold text-muted-foreground uppercase">
                                            Saved Versions
                                        </p>
                                    </div>
                                    <div className="max-h-60 overflow-y-auto">
                                        {backups.map((backup) => (
                                            <button
                                                key={backup.id}
                                                onClick={async () => {
                                                    if (!onRestore || !campaignId) return
                                                    setRestoringId(backup.id)
                                                    const { restoreCampaignBackup } = await import("@/app/actions/campaigns")
                                                    const result = await restoreCampaignBackup(campaignId, backup.id)
                                                    if (result.success && result.data) {
                                                        onRestore(result.data)
                                                    }
                                                    setRestoringId(null)
                                                    setHistoryDropdownOpen(false)
                                                }}
                                                disabled={restoringId === backup.id}
                                                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors flex items-center justify-between gap-2 border-b border-border/50 last:border-0"
                                            >
                                                <div className="flex flex-col min-w-0">
                                                    <span className="text-xs font-medium text-foreground truncate">
                                                        {backup.subject_line || "No subject"}
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground">
                                                        {formatDistanceToNow(new Date(backup.saved_at), { addSuffix: true })}
                                                    </span>
                                                </div>
                                                {restoringId === backup.id && (
                                                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground flex-shrink-0" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <div className="flex-1 overflow-y-auto bg-[#0f0f10] p-8">
                    <div className="h-fit min-h-[500px] mx-auto transition-all duration-300 bg-white shadow-lg my-8" style={{ maxWidth: viewMode === 'mobile' ? '375px' : '600px' }}>
                        <PreviewPane html={previewHtml} viewMode={viewMode} />
                    </div>
                </div>
            </div>

            {/* 5. COPILOT (Context Aware) */}
            <div className="w-[350px] flex-shrink-0 border-l border-border bg-card h-full overflow-hidden">
                <CopilotPane
                    html={fullHtml}
                    onHtmlChange={handleCopilotUpdate}
                    audienceContext={audienceContext}
                    aiDossier={aiDossier}
                    campaignId={campaignId}
                />
            </div>
        </div >
    )
}
