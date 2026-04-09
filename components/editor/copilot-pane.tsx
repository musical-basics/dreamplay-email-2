"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Sparkles, Send, X, Zap, Brain, Bot, Paperclip, Loader2, FileText, History, Plus, LayoutTemplate, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"


interface Message {
    role: "user" | "details" | "result"
    content: string
    // We now store URLs instead of base64 to save memory
    imageUrls?: string[]
}

interface CopilotPaneProps {
    html: string
    onHtmlChange: (html: string, prompt: string) => void
    audienceContext?: "dreamplay" | "musicalbasics" | "both"
    aiDossier?: string
    campaignId?: string | null
}

interface ChatSession {
    id: string
    startedAt: string
    messages: Message[]
}

const MAX_SESSIONS = 5
const STORAGE_PREFIX = "copilot_sessions_"

import { getAnthropicModels } from "@/app/actions/ai-models"
import { getTemplateList, getCampaignHtml } from "@/app/actions/campaigns"
import { DEFAULT_WORKSPACE } from "@/lib/workspace"
import { renderTemplate } from "@/lib/render-template"

type ComputeTier = "low" | "medium" | "high"

export function CopilotPane({ html, onHtmlChange, audienceContext = "dreamplay", aiDossier = "", campaignId }: CopilotPaneProps) {
    // ─── Model override (header dropdown) ───
    const [overrideModel, setOverrideModel] = useState<string | null>(null)
    const [availableModels, setAvailableModels] = useState<string[]>([])

    // ─── Tier models from localStorage ───
    const [modelLow, setModelLow] = useState("claude-haiku-4-5-20251001")
    const [modelMedium, setModelMedium] = useState("claude-sonnet-4-6")
    const [modelHigh, setModelHigh] = useState("claude-opus-4-6")
    const [autoRouting, setAutoRouting] = useState(false)

    useEffect(() => {
        getAnthropicModels().then(models => {
            if (models.length > 0) {
                setAvailableModels(models)
            }
        })

        // Load tier settings
        const low = localStorage.getItem("mb_model_low")
        const med = localStorage.getItem("mb_model_medium")
        const high = localStorage.getItem("mb_model_high")
        const auto = localStorage.getItem("mb_auto_routing")
        if (low) setModelLow(low)
        if (med) setModelMedium(med)
        if (high) setModelHigh(high)
        if (auto === "true") setAutoRouting(true)
    }, [])

    const getModelForTier = (tier: ComputeTier): string => {
        if (overrideModel) return overrideModel
        switch (tier) {
            case "low": return modelLow
            case "medium": return modelMedium
            case "high": return modelHigh
        }
    }

    // ─── Session Persistence ─────────────────────────
    const [currentSessionId, setCurrentSessionId] = useState<string>(() => `s-${Date.now()}`)
    const [sessions, setSessions] = useState<ChatSession[]>([])
    const [sessionPickerOpen, setSessionPickerOpen] = useState(false)
    const sessionPickerRef = useRef<HTMLDivElement>(null)

    // Load sessions from localStorage on mount / campaignId change
    useEffect(() => {
        if (!campaignId) return
        try {
            const raw = localStorage.getItem(`${STORAGE_PREFIX}${campaignId}`)
            if (raw) {
                const saved: ChatSession[] = JSON.parse(raw)
                setSessions(saved)
                // Load the most recent session
                if (saved.length > 0) {
                    const latest = saved[0]
                    setCurrentSessionId(latest.id)
                    setMessages(latest.messages)
                }
            }
        } catch (e) {
            console.error("Failed to load copilot sessions:", e)
        }
    }, [campaignId])

    // Save current session to localStorage
    const saveCurrentSession = useCallback((msgs: Message[]) => {
        if (!campaignId || msgs.length <= 1) return // Don't save empty/default sessions
        try {
            const raw = localStorage.getItem(`${STORAGE_PREFIX}${campaignId}`)
            let allSessions: ChatSession[] = raw ? JSON.parse(raw) : []

            const existingIdx = allSessions.findIndex(s => s.id === currentSessionId)
            const session: ChatSession = {
                id: currentSessionId,
                startedAt: existingIdx >= 0 ? allSessions[existingIdx].startedAt : new Date().toISOString(),
                messages: msgs,
            }

            if (existingIdx >= 0) {
                allSessions[existingIdx] = session
            } else {
                allSessions.unshift(session)
            }

            // Cap at MAX_SESSIONS
            allSessions = allSessions.slice(0, MAX_SESSIONS)
            localStorage.setItem(`${STORAGE_PREFIX}${campaignId}`, JSON.stringify(allSessions))
            setSessions(allSessions)
        } catch (e) {
            console.error("Failed to save copilot session:", e)
        }
    }, [campaignId, currentSessionId])

    // Close session picker on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (sessionPickerRef.current && !sessionPickerRef.current.contains(e.target as Node)) {
                setSessionPickerOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const SUGGESTIONS = [
        "✨ Design a Black Friday promo email",
        "🎨 Update the layout to look more modern",
        "📝 Rewrite the copy to create more urgency",
        "📱 Make sure the design is mobile-friendly"
    ]

    const handleNewSession = () => {
        const newId = `s-${Date.now()}`
        setCurrentSessionId(newId)
        setMessages([{ role: "result", content: "👋 Hi! I'm your AI design assistant. I can help you build or edit this email. What would you like to do?" }])
        setSessionPickerOpen(false)
    }

    const handleLoadSession = (session: ChatSession) => {
        setCurrentSessionId(session.id)
        setMessages(session.messages)
        setSessionPickerOpen(false)
    }

    const [messages, setMessages] = useState<Message[]>([
        { role: "result", content: "👋 Hi! I'm your AI design assistant. I can help you build or edit this email. What would you like to do?" },
    ])

    const [input, setInput] = useState("")
    const [isUploading, setIsUploading] = useState(false)
    const [pendingAttachments, setPendingAttachments] = useState<string[]>([]) // URLs
    const [isLoading, setIsLoading] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // ─── Reference Template ──────────────────────────
    const [isRefPickerOpen, setIsRefPickerOpen] = useState(false)
    const [refTemplates, setRefTemplates] = useState<{ id: string; name: string; created_at: string }[]>([])
    const [loadingTemplates, setLoadingTemplates] = useState(false)
    const [capturingRef, setCapturingRef] = useState(false)
    const [referenceCSS, setReferenceCSS] = useState<string | null>(null)
    const [refTemplateName, setRefTemplateName] = useState<string | null>(null)
    const [referenceMode, setReferenceMode] = useState<"style" | "adjust">("style")
    const refIframeRef = useRef<HTMLIFrameElement>(null)

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [messages, isLoading, pendingAttachments])

    // Auto-save session when messages change
    useEffect(() => {
        saveCurrentSession(messages)
    }, [messages, saveCurrentSession])

    const uploadFile = async (file: File) => {
        setIsUploading(true)
        try {
            // 2. Use Server-Side Upload (Bypasses RLS)
            const formData = new FormData()
            formData.append('file', file)

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || "Upload failed")
            }

            setPendingAttachments(prev => [...prev, data.url])
        } catch (error: any) {
            console.error("Upload failed:", error)
            setMessages(prev => [...prev, { role: 'result', content: `❌ Failed to upload image: ${file.name} (${error.message})` }])
        } finally {
            setIsUploading(false)
        }
    }

    const handlePaste = (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf("image") !== -1) {
                e.preventDefault()
                const file = items[i].getAsFile()
                if (file) uploadFile(file)
            }
        }
    }

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            Array.from(e.target.files).forEach(file => uploadFile(file))
        }
    }

    // ─── Reference Template Handlers ─────────────────
    const handleOpenRefPicker = async (mode: "style" | "adjust" = "style") => {
        setReferenceMode(mode)
        setIsRefPickerOpen(true)
        setLoadingTemplates(true)
        try {
            const templates = await getTemplateList(DEFAULT_WORKSPACE)
            setRefTemplates(templates)
        } catch (e) {
            console.error("Failed to load templates", e)
        } finally {
            setLoadingTemplates(false)
        }
    }

    const handleSelectRefTemplate = async (template: { id: string; name: string }) => {
        setIsRefPickerOpen(false)
        setCapturingRef(true)
        setRefTemplateName(template.name)

        try {
            // 1. Fetch HTML
            const campaignData = await getCampaignHtml(template.id)
            if (!campaignData?.html_content) {
                throw new Error("No HTML content found")
            }

            // Render template variables for accurate preview
            const renderedHtml = renderTemplate(campaignData.html_content, campaignData.variable_values || {})

            // 2. Extract <style> block
            const styleMatch = renderedHtml.match(/<style[^>]*>[\s\S]*?<\/style>/gi)
            const extractedCSS = styleMatch ? styleMatch.join("\n") : ""
            setReferenceCSS(extractedCSS || null)

            // 3. Render in hidden iframe and capture screenshot
            const iframe = refIframeRef.current
            if (iframe) {
                const doc = iframe.contentDocument
                if (doc) {
                    doc.open()
                    doc.write(renderedHtml)
                    doc.close()

                    // Wait for images to load
                    await new Promise(resolve => setTimeout(resolve, 1500))

                    // Capture with html2canvas
                    const html2canvas = (await import("html2canvas")).default
                    const canvas = await html2canvas(doc.body, {
                        width: 600,
                        backgroundColor: "#ffffff",
                        useCORS: true,
                        logging: false,
                    })

                    // Convert to blob and upload
                    const blob = await new Promise<Blob>((resolve) =>
                        canvas.toBlob((b) => resolve(b!), "image/png", 0.9)
                    )

                    const formData = new FormData()
                    formData.append("file", blob, `ref-${template.id}.png`)
                    const uploadRes = await fetch("/api/upload", { method: "POST", body: formData })
                    const uploadData = await uploadRes.json()

                    if (uploadRes.ok && uploadData.url) {
                        setPendingAttachments(prev => [...prev, uploadData.url])
                    }
                }
            }
        } catch (e: any) {
            console.error("Failed to capture reference template:", e)
            setRefTemplateName(null)
            setReferenceCSS(null)
        } finally {
            setCapturingRef(false)
        }
    }

    const clearReference = () => {
        setReferenceCSS(null)
        setRefTemplateName(null)
    }

    const handleSendMessage = async (tier?: ComputeTier | string, textOverride?: string) => {
        const actualInput = textOverride || input;
        if ((!actualInput.trim() && pendingAttachments.length === 0) || isLoading || isUploading) return

        const userMessage = actualInput.trim()
        const attachments = [...pendingAttachments]

        // Prepend reference CSS context if present
        let fullMessage = userMessage
        if (referenceCSS) {
            if (referenceMode === "style") {
                fullMessage = `[STYLE REFERENCE ATTACHED — CONTENT PRESERVATION MODE]
The CSS below and any attached screenshot are ONLY for visual/styling reference.

### STRICT RULES FOR THIS REQUEST:
1. **DO NOT** rewrite, rephrase, summarize, or change ANY text content. Every word, sentence, and paragraph from the CURRENT HTML must appear EXACTLY as-is in your output.
2. **DO NOT** change, remove, or regenerate ANY image src attributes. Keep every img src URL identical to the original.
3. **DO NOT** change ANY link href attributes unless specifically requested.
4. **ONLY** apply visual/structural changes: layout (table structure), colors, fonts, font sizes, spacing/padding, backgrounds, border styles, and button styling.
5. If the reference uses sections the original doesn't have, DO NOT invent new content — skip those sections or leave them empty.

### Reference CSS (apply this styling to the existing content):
${referenceCSS}

### User's instruction:
${userMessage}`
            } else {
                fullMessage = `[STYLE REFERENCE ATTACHED — ADJUST MODE]
The CSS below and any attached screenshot are for visual/styling reference. In this mode you may also ADJUST the content based on the user's instructions.

### RULES FOR THIS REQUEST:
1. Use the reference template's visual style: layout, colors, fonts, spacing, backgrounds, button styling.
2. Keep the CURRENT HTML's existing image src URLs wherever possible — do not invent new image paths.
3. You MAY rewrite, add, remove, or rephrase text content as the user's instruction requires.
4. You MAY add new sections or remove sections if the user's instruction calls for it.
5. Preserve the overall structure and branding of the reference style while adapting the content.

### Reference CSS (apply this styling):
${referenceCSS}

### User's instruction:
${userMessage}`
            }
            setReferenceCSS(null)
            setRefTemplateName(null)
            setReferenceMode("style")
        }

        // Determine which model to use
        let model: string
        if (autoRouting && !tier) {
            // Auto mode: send "auto" + tier model info so API can pick
            model = "auto"
        } else {
            model = getModelForTier((tier as ComputeTier) || "medium")
        }

        // Clear input immediately
        setInput("")
        setPendingAttachments([])

        // 1. Add to UI state (show clean message, not the CSS-prepended one)
        const newMessage: Message = {
            role: "user",
            content: userMessage,
            imageUrls: attachments
        }

        // Build the API message with full CSS context
        const apiMessage: Message = {
            role: "user",
            content: fullMessage,
            imageUrls: attachments
        }

        // Append to local history (UI-clean version)
        const newHistory = [...messages, newMessage]
        // Build API history (last message has CSS context)
        const apiHistory = [...messages, apiMessage]
        setMessages(newHistory)
        setIsLoading(true)

        try {
            // 2. Send to API (Now lightweight because we only send URLs!)
            const response = await fetch("/api/copilot", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    currentHtml: html,
                    messages: apiHistory,
                    model,
                    audienceContext,
                    aiDossier,
                    // Pass tier model preferences for auto-routing
                    modelLow,
                    modelMedium,
                }),
            })

            const data = await response.json()

            if (!response.ok) throw new Error(data.error || "Failed to generate code")

            if (data.updatedHtml) {
                onHtmlChange(data.updatedHtml, userMessage)
            }

            const resultMessages: Message[] = [
                { role: "result", content: data.explanation || "Done." }
            ];

            // Add cost/model details as a second bubble
            if (data.meta) {
                const m = data.meta;
                const costStr = m.cost < 0.01 ? `$${(m.cost * 100).toFixed(2)}¢` : `$${m.cost.toFixed(4)}`;
                resultMessages.push({
                    role: "details",
                    content: `${m.model}  ·  ${m.inputTokens.toLocaleString()} in / ${m.outputTokens.toLocaleString()} out  ·  ${costStr}`
                });
            }

            setMessages(prev => [...prev, ...resultMessages])

        } catch (error: any) {
            console.error("Copilot Error:", error)
            setMessages(prev => [
                ...prev,
                { role: "result", content: `Error: ${error.message}` }
            ])
        } finally {
            setIsLoading(false)
        }
    }

    const canSend = !isLoading && (input.trim() || pendingAttachments.length > 0)

    return (
        <div className="flex flex-col h-full border-l border-border bg-card text-card-foreground">
            {/* Hidden iframe for screenshot capture */}
            <iframe
                ref={refIframeRef}
                style={{ position: "absolute", left: "-9999px", top: "-9999px", width: "600px", height: "2000px", border: "none" }}
            />
            {/* Header */}
            <div className="h-14 border-b border-border flex items-center px-4 gap-2 justify-between shrink-0 bg-background/50 backdrop-blur">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <h2 className="text-sm font-semibold">Copilot Vision</h2>
                    {/* Session Picker */}
                    {campaignId && (
                        <div className="relative" ref={sessionPickerRef}>
                            <button
                                onClick={() => setSessionPickerOpen(!sessionPickerOpen)}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                title="Chat Sessions"
                            >
                                <History className="w-3 h-3" />
                                {sessions.length > 0 && <span>{sessions.length}</span>}
                            </button>
                            {sessionPickerOpen && (
                                <div className="absolute top-full left-0 mt-1 w-56 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                                    <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                                        <p className="text-[10px] font-semibold text-muted-foreground uppercase">Chat Sessions</p>
                                        <button
                                            onClick={handleNewSession}
                                            className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
                                        >
                                            <Plus className="w-3 h-3" />
                                            New
                                        </button>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto">
                                        {sessions.map((session) => (
                                            <button
                                                key={session.id}
                                                onClick={() => handleLoadSession(session)}
                                                className={cn(
                                                    "w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0",
                                                    session.id === currentSessionId && "bg-primary/5 border-l-2 border-l-primary"
                                                )}
                                            >
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] text-muted-foreground">
                                                        {new Date(session.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                                                        {new Date(session.startedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                                    </span>
                                                    <span className="text-xs text-foreground truncate">
                                                        {session.messages.filter(m => m.role === "user").slice(-1)[0]?.content?.slice(0, 40) || "Empty session"}
                                                        {(session.messages.filter(m => m.role === "user").slice(-1)[0]?.content?.length || 0) > 40 ? "…" : ""}
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground">
                                                        {session.messages.filter(m => m.role === "user").length} messages
                                                    </span>
                                                </div>
                                            </button>
                                        ))}
                                        {sessions.length === 0 && (
                                            <p className="text-xs text-muted-foreground text-center py-4">No saved sessions</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <Select
                    value={overrideModel || "tier-default"}
                    onValueChange={(val) => setOverrideModel(val === "tier-default" ? null : val)}
                >
                    <SelectTrigger className="w-[180px] h-8 text-xs bg-muted/50 border-transparent hover:border-border">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="tier-default">🎛️ Use Tier Buttons</SelectItem>

                        {/* Dynamic Anthropic Models */}
                        {availableModels.map(model => (
                            <SelectItem key={model} value={model}>{model}</SelectItem>
                        ))}

                        {/* Fallback hardcoded if fetch failed */}
                        {availableModels.length === 0 && (
                            <SelectItem value="claude-3-5-sonnet-20240620">Claude 3.5 Sonnet (Legacy)</SelectItem>
                        )}

                        <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6" ref={scrollRef}>
                {messages.map((msg, index) => (
                    <div key={index} className={cn("flex flex-col gap-2 max-w-[90%]", msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start")}>
                        {/* Render Images */}
                        {msg.imageUrls && msg.imageUrls.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-1 justify-end">
                                {msg.imageUrls.map((url, i) => (
                                    <div key={i} className="relative group overflow-hidden rounded-lg border border-border">
                                        <img src={url} alt="attachment" className="h-24 w-auto object-cover" />
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Render Text */}
                        {msg.content && (
                            <div className={cn(
                                "rounded-2xl text-sm whitespace-pre-wrap leading-relaxed",
                                msg.role === "user"
                                    ? "p-3 bg-primary text-primary-foreground rounded-br-sm"
                                    : msg.role === "details"
                                        ? "px-3 py-1.5 text-[11px] font-mono text-muted-foreground bg-transparent"
                                        : "p-3 bg-muted text-foreground rounded-bl-sm"
                            )}>
                                {msg.content}
                            </div>
                        )}
                    </div>
                ))}
                {isLoading && (
                    <div className="mr-auto flex items-center gap-2 text-muted-foreground text-sm p-2">
                        <Brain className="w-4 h-4 animate-pulse" />
                        Thinking...
                    </div>
                )}

                {/* Suggestions for New Sessions */}
                {messages.length === 1 && !isLoading && (
                    <div className="mr-auto items-start flex flex-col gap-2 max-w-[90%] pt-2">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider ml-1">Try asking Copilot to:</p>
                        <div className="flex flex-col gap-2 w-full">
                            {SUGGESTIONS.map((suggestion, i) => (
                                <button
                                    key={i}
                                    onClick={() => handleSendMessage(autoRouting && !overrideModel ? undefined : "low", suggestion.replace(/^[^a-zA-Z]+/, ""))}
                                    className="text-left text-sm bg-muted/50 hover:bg-primary/10 border border-border hover:border-primary/30 rounded-xl px-4 py-2.5 transition-colors text-foreground/80 hover:text-primary"
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-border mt-auto shrink-0 bg-background/50 backdrop-blur">
                {/* Pending Uploads + Reference Badge */}
                {(pendingAttachments.length > 0 || isUploading || refTemplateName || capturingRef) && (
                    <div className="space-y-2 pb-3">
                        {/* Reference Badge */}
                        {(refTemplateName || capturingRef) && (
                            <div className="flex items-center gap-2">
                                {capturingRef ? (
                                    <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/30 gap-1">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Capturing reference...
                                    </Badge>
                                ) : refTemplateName && (
                                    <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/30 gap-1 pr-1">
                                        <LayoutTemplate className="w-3 h-3" />
                                        Ref: {refTemplateName}
                                        <button onClick={clearReference} className="ml-1 rounded-full p-0.5 hover:bg-purple-500/20">
                                            <X className="w-3 h-3" />
                                        </button>
                                    </Badge>
                                )}
                            </div>
                        )}
                        {/* Attachment previews */}
                        {(pendingAttachments.length > 0 || isUploading) && (
                            <div className="flex gap-2 overflow-x-auto">
                                {pendingAttachments.map((url, i) => (
                                    <div key={i} className="relative group shrink-0">
                                        {url.toLowerCase().endsWith('.pdf') ? (
                                            <div className="h-14 w-14 rounded-md border border-border bg-muted flex items-center justify-center">
                                                <FileText className="w-6 h-6 text-muted-foreground" />
                                            </div>
                                        ) : (
                                            <img src={url} className="h-14 w-14 rounded-md object-cover border border-border" />
                                        )}
                                        <button
                                            onClick={() => setPendingAttachments(prev => prev.filter((_, idx) => idx !== i))}
                                            className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                                {isUploading && (
                                    <div className="h-14 w-14 rounded-md border border-dashed border-muted-foreground/50 flex items-center justify-center bg-muted/20">
                                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div className="space-y-2">
                    <input
                        type="file"
                        multiple
                        accept="image/*,.pdf,application/pdf"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                    />

                    {/* Input row */}
                    <Input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault()
                                if (autoRouting && !overrideModel) {
                                    handleSendMessage()
                                } else {
                                    handleSendMessage("low")
                                }
                            }
                        }}
                        onPaste={handlePaste}
                        placeholder="Type a message..."
                        className="w-full min-h-[40px]"
                        disabled={isLoading}
                        autoFocus
                    />

                    {/* Actions row */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="shrink-0 text-muted-foreground hover:text-foreground h-8 w-8"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploading || isLoading}
                                title="Attach image"
                            >
                                <Paperclip className="w-4 h-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                    "shrink-0 hover:text-foreground h-8 w-8",
                                    refTemplateName ? "text-purple-400" : "text-muted-foreground"
                                )}
                                onClick={() => handleOpenRefPicker("style")}
                                disabled={isUploading || isLoading || capturingRef}
                                title="Reference a template style"
                            >
                                <LayoutTemplate className="w-4 h-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                    "shrink-0 hover:text-foreground h-8 w-8",
                                    refTemplateName && referenceMode === "adjust" ? "text-amber-400" : "text-muted-foreground"
                                )}
                                onClick={() => handleOpenRefPicker("adjust")}
                                disabled={isUploading || isLoading || capturingRef}
                                title="Reference a template & adjust content"
                            >
                                <Wand2 className="w-4 h-4" />
                            </Button>
                        </div>

                        {/* Send buttons: 3 tiers or 1 auto */}
                        {autoRouting && !overrideModel ? (
                            <Button
                                size="icon"
                                onClick={() => handleSendMessage()}
                                disabled={!canSend}
                                className={cn("bg-amber-600 hover:bg-amber-500 text-white h-8 w-8", isLoading && "opacity-50")}
                                title="Auto-routed send"
                            >
                                <Send className="w-3.5 h-3.5" />
                            </Button>
                        ) : (
                            <div className="flex gap-1">
                                <Button
                                    size="icon"
                                    onClick={() => handleSendMessage("low")}
                                    disabled={!canSend}
                                    className="bg-green-600 hover:bg-green-500 text-white h-8 w-8"
                                    title={`Low: ${overrideModel || modelLow} (Enter)`}
                                >
                                    <Send className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                    size="icon"
                                    onClick={() => handleSendMessage("medium")}
                                    disabled={!canSend}
                                    className="bg-amber-600 hover:bg-amber-500 text-white h-8 w-8"
                                    title={`Medium: ${overrideModel || modelMedium}`}
                                >
                                    <Send className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                    size="icon"
                                    onClick={() => handleSendMessage("high")}
                                    disabled={!canSend}
                                    className="bg-red-600 hover:bg-red-500 text-white h-8 w-8"
                                    title={`High: ${overrideModel || modelHigh}`}
                                >
                                    <Send className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Reference Template Picker Dialog */}
            <Dialog open={isRefPickerOpen} onOpenChange={setIsRefPickerOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{referenceMode === "style" ? "Reference Template Style" : "Reference Template & Adjust"}</DialogTitle>
                        <DialogDescription>
                            {referenceMode === "style"
                                ? "Select a template to use as a STYLE reference. Your current text and images will be preserved exactly."
                                : "Select a template to use as a style reference. You can then adjust content (add sections, rewrite copy, etc.) via your prompt."
                            }
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-2">
                        {loadingTemplates ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : refTemplates.length === 0 ? (
                            <p className="text-center text-muted-foreground py-8">No master templates found.</p>
                        ) : (
                            <ScrollArea className="h-[300px] pr-4">
                                <div className="space-y-2">
                                    {refTemplates.map(t => (
                                        <button
                                            key={t.id}
                                            onClick={() => handleSelectRefTemplate(t)}
                                            className="w-full text-left p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                                        >
                                            <h4 className="font-medium text-sm text-foreground">{t.name}</h4>
                                            <p className="text-[10px] text-muted-foreground mt-1">
                                                Created: {new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            </ScrollArea>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
