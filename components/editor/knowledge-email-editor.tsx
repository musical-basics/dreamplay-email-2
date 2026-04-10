"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { AssetLoader } from "./asset-loader"
import { CodePane } from "./code-pane"
import { PreviewPane } from "./preview-pane"
import { KnowledgeCopilotPane } from "./knowledge-copilot-pane"
import { CampaignPicker } from "./campaign-picker"
import { DiscountManagerModal } from "./discount-manager-modal"
import { renderTemplate } from "@/lib/render-template"
import { Monitor, Smartphone, Loader2, Check, PanelRightClose, PanelRightOpen, ArrowLeft, Rocket, History, Code } from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { useSearchParams, useParams } from "next/navigation"
import { Panel, PanelGroup, PanelResizeHandle, ImperativePanelHandle } from "react-resizable-panels"
import { getCampaignBackups } from "@/app/actions/campaigns"
import { formatDistanceToNow } from "date-fns"

interface KnowledgeEmailEditorProps {
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
    emailType: "campaign" | "automated"
    onEmailTypeChange: (value: "campaign" | "automated") => void
    campaignName: string
    onNameChange: (name: string) => void
    onSave?: () => void
    campaignId?: string | null
    onRestore?: (backup: { html_content: string; variable_values: Record<string, any>; subject_line: string }) => void
}

export function KnowledgeEmailEditor({
    html,
    assets,
    subjectLine,
    fromName,
    fromEmail,
    audienceContext,
    emailType,
    aiDossier,
    onHtmlChange,
    onAssetsChange,
    onSubjectChange,
    onSenderChange,
    onAudienceChange,
    onEmailTypeChange,
    campaignName,
    onNameChange,
    onSave,
    campaignId,
    onRestore
}: KnowledgeEmailEditorProps) {
    const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop')
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle')

    // Hide code pane by default for a friendlier view
    const [isCodeOpen, setIsCodeOpen] = useState(false)
    const codeRef = useRef<ImperativePanelHandle>(null)

    const [isCopilotOpen, setIsCopilotOpen] = useState(true)
    const copilotRef = useRef<ImperativePanelHandle>(null)
    const searchParams = useSearchParams()
    const currentId = searchParams.get("id")
    const { workspace } = useParams<{ workspace: string }>()
    const workspaceFromQuery = searchParams.get("workspace")
    const backWorkspace = workspace || workspaceFromQuery || ""
    const { toast } = useToast()



    // Version history
    const [backups, setBackups] = useState<{ id: string; saved_at: string; subject_line: string }[]>([])
    const [historyOpen, setHistoryOpen] = useState(false)
    const [restoringId, setRestoringId] = useState<string | null>(null)
    const historyRef = useRef<HTMLDivElement>(null)

    const fetchBackups = useCallback(async () => {
        if (!campaignId) return
        const data = await getCampaignBackups(campaignId)
        setBackups(data)
    }, [campaignId])

    useEffect(() => { fetchBackups() }, [fetchBackups])

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
                setHistoryOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const extractedVariables = useMemo(() => {
        const regex = /\{\{(\w+)\}\}/g
        const matches: string[] = []
        let match
        while ((match = regex.exec(html)) !== null) {
            if (!matches.includes(match[1])) matches.push(match[1])
        }
        return matches
    }, [html])

    const updateAsset = useCallback((key: string, value: string) => {
        onAssetsChange({ ...assets, [key]: value })
    }, [assets, onAssetsChange])

    const previewHtml = useMemo(() => {
        return renderTemplate(html, assets)
    }, [html, assets])

    const handleSaveClick = async () => {
        if (!onSave) return
        setSaveStatus('saving')
        await Promise.resolve(onSave())
        await fetchBackups()
        setSaveStatus('success')
        setTimeout(() => setSaveStatus('idle'), 2000)
    }

    const toggleCode = () => {
        const panel = codeRef.current
        if (panel) {
            if (isCodeOpen) panel.collapse()
            else panel.expand()
        }
    }

    const toggleCopilot = () => {
        const panel = copilotRef.current
        if (panel) {
            if (isCopilotOpen) panel.collapse()
            else panel.expand()
        }
    }

    return (
        <div className="h-screen bg-background text-foreground overflow-hidden">
            <PanelGroup direction="horizontal">
                {/* Left Sidebar - Asset Loader */}
                <Panel defaultSize={15} minSize={12} maxSize={25} className="bg-background border-r border-border">
                    <div className="h-full flex flex-col">
                        <div className="p-3 border-b border-border">
                            <Link href={backWorkspace ? `/${backWorkspace}` : "/"} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                <ArrowLeft className="w-3 h-3" />
                                Back to Dashboard
                            </Link>
                        </div>

                        {/* Campaign Settings */}
                        <div className="p-4 border-b border-border bg-muted/20 space-y-3">
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
                            <div className="grid grid-cols-1 gap-2">
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
                            <div className="space-y-1">
                                <label className="text-[10px] uppercase font-semibold text-muted-foreground">Email Type</label>
                                <select
                                    value={emailType}
                                    onChange={(e) => onEmailTypeChange(e.target.value as any)}
                                    className="w-full bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-primary cursor-pointer"
                                >
                                    <option value="campaign">Campaign</option>
                                    <option value="automated">Automated Email</option>
                                </select>
                            </div>
                            <div className="pt-3 border-t border-border mt-3">
                                <DiscountManagerModal assets={assets} onAssetsChange={onAssetsChange} templateVariables={extractedVariables} />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            <AssetLoader variables={extractedVariables} assets={assets} onUpdateAsset={updateAsset} showBackButton={false} />
                        </div>
                    </div>
                </Panel>

                <PanelResizeHandle className="w-1 bg-border hover:bg-primary/20 transition-colors" />

                {/* Center Left - Code Pane */}
                <Panel
                    ref={codeRef}
                    defaultSize={0}
                    minSize={20}
                    maxSize={50}
                    collapsible={true}
                    collapsedSize={0}
                    onCollapse={() => setIsCodeOpen(false)}
                    onExpand={() => setIsCodeOpen(true)}
                    className={cn(
                        "bg-background transition-all duration-300 ease-in-out",
                        isCodeOpen ? "border-r border-border" : "border-none"
                    )}
                >
                    <div className="h-full overflow-hidden min-w-[250px]">
                        <CodePane code={html} onChange={onHtmlChange} className="h-full" />
                    </div>
                </Panel>

                <PanelResizeHandle className={cn("w-1 bg-border hover:bg-primary/20 transition-colors", !isCodeOpen && "hidden")} />

                {/* Center Right - Preview Pane */}
                <Panel defaultSize={65} minSize={25} className="bg-background flex flex-col">
                    <div className="h-full flex flex-col overflow-hidden">
                        <div className="h-14 border-b border-border flex items-center justify-between px-4 bg-card flex-shrink-0">
                            <h2 className="text-sm font-semibold">Preview</h2>

                            <div className="flex items-center gap-2">
                                {/* View Toggle */}
                                <div className="flex bg-muted p-1 rounded-lg">
                                    <button
                                        onClick={() => setViewMode('desktop')}
                                        className={cn("p-1.5 rounded-md transition-all", viewMode === 'desktop' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                                        title="Desktop View"
                                    >
                                        <Monitor className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => setViewMode('mobile')}
                                        className={cn("p-1.5 rounded-md transition-all", viewMode === 'mobile' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                                        title="Mobile View"
                                    >
                                        <Smartphone className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* Campaign Name */}
                                <div className="flex items-center gap-2 border-l border-border pl-2 mr-2">
                                    <input
                                        type="text"
                                        value={campaignName}
                                        onChange={(e) => onNameChange(e.target.value)}
                                        className="bg-transparent border-none text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary/30 rounded px-2 w-[180px] text-foreground placeholder:text-muted-foreground"
                                        placeholder="Campaign Name"
                                    />
                                </div>

                                <CampaignPicker currentId={currentId} editorType="knowledge" />

                                {/* Save */}
                                {onSave && (
                                    <button
                                        type="button"
                                        onClick={handleSaveClick}
                                        disabled={saveStatus === 'saving'}
                                        className={cn(
                                            "px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                                            saveStatus === 'success'
                                                ? "bg-green-600 text-white hover:bg-green-700"
                                                : "bg-primary text-primary-foreground hover:bg-primary/90"
                                        )}
                                    >
                                        {saveStatus === 'saving' && <Loader2 className="w-4 h-4 animate-spin" />}
                                        {saveStatus === 'success' && <Check className="w-4 h-4" />}
                                        {saveStatus === 'idle' && "Save Campaign"}
                                        {saveStatus === 'saving' && "Saving..."}
                                        {saveStatus === 'success' && "Saved!"}
                                    </button>
                                )}

                                {/* Version History */}
                                {campaignId && backups.length > 0 && (
                                    <div className="relative" ref={historyRef}>
                                        <button
                                            type="button"
                                            onClick={() => setHistoryOpen(!historyOpen)}
                                            className="p-2 rounded-md text-sm font-medium border border-border bg-background hover:bg-muted transition-all flex items-center gap-1.5"
                                            title="Version History"
                                        >
                                            <History className="w-4 h-4" />
                                            <span className="text-xs text-muted-foreground">{backups.length}</span>
                                        </button>
                                        {historyOpen && (
                                            <div className="absolute top-full right-0 mt-1 w-64 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                                                <div className="px-3 py-2 border-b border-border">
                                                    <p className="text-xs font-semibold text-muted-foreground uppercase">Saved Versions</p>
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
                                                                setHistoryOpen(false)
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

                                {/* Manage Campaign */}
                                {currentId && (
                                    <Link
                                        href={`/${workspace}/dashboard/${currentId}`}
                                        className="px-4 py-2 rounded-md text-sm font-medium border border-border bg-background hover:bg-muted transition-all flex items-center gap-2"
                                    >
                                        <Rocket className="w-4 h-4" />
                                        Manage
                                    </Link>
                                )}

                                {/* Copilot & Code Toggles */}
                                <div className="flex items-center gap-1 ml-2">
                                    <button
                                        onClick={toggleCode}
                                        className={cn(
                                            "p-2 rounded-md transition-all text-sm font-medium border",
                                            isCodeOpen
                                                ? "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20"
                                                : "bg-muted text-muted-foreground hover:text-foreground border-transparent"
                                        )}
                                        title={isCodeOpen ? "Hide Code" : "Show Code"}
                                    >
                                        <Code className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={toggleCopilot}
                                        className={cn(
                                            "p-2 rounded-md transition-all text-sm font-medium border",
                                            isCopilotOpen
                                                ? "bg-muted text-muted-foreground hover:text-foreground border-transparent"
                                                : "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20"
                                        )}
                                        title={isCopilotOpen ? "Hide Copilot" : "Show Copilot"}
                                    >
                                        {isCopilotOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto bg-[#0f0f10] p-8">
                            <div className="h-fit min-h-[500px] mx-auto transition-all duration-300 bg-white shadow-lg my-8" style={{ maxWidth: viewMode === 'mobile' ? '375px' : '600px' }}>
                                <PreviewPane html={previewHtml} viewMode={viewMode} />
                            </div>
                        </div>
                    </div>
                </Panel>

                <PanelResizeHandle className={cn("w-1 bg-border hover:bg-primary/20 transition-colors", !isCopilotOpen && "hidden")} />

                {/* Right Sidebar - Knowledge Copilot */}
                <Panel
                    ref={copilotRef}
                    defaultSize={20}
                    minSize={15}
                    maxSize={30}
                    collapsible={true}
                    collapsedSize={0}
                    onCollapse={() => setIsCopilotOpen(false)}
                    onExpand={() => setIsCopilotOpen(true)}
                    className={cn(
                        "bg-card border-l border-border transition-all duration-300 ease-in-out",
                        !isCopilotOpen && "border-none"
                    )}
                >
                    <div className="h-full overflow-hidden">
                        <KnowledgeCopilotPane html={html} onHtmlChange={onHtmlChange} audienceContext={audienceContext} campaignId={campaignId} />
                    </div>
                </Panel>
            </PanelGroup>
        </div>
    )
}
