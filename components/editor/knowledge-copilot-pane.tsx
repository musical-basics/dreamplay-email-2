"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Sparkles, Send, X, Paperclip, Loader2, FileText, History, Plus, CheckCircle2, Circle, AlertCircle, ArrowRight, Brain } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface Message {
    role: "user" | "details" | "result" | "pipeline"
    content: string
    imageUrls?: string[]
    pipelineSteps?: PipelineStep[]
}

interface PipelineStep {
    id: string
    label: string
    status: "pending" | "active" | "done" | "error"
    message?: string
}

interface KnowledgeCopilotPaneProps {
    html: string
    onHtmlChange: (html: string, prompt: string) => void
    audienceContext?: "dreamplay" | "musicalbasics" | "both"
    campaignId?: string | null
}

interface ChatSession {
    id: string
    startedAt: string
    messages: Message[]
}

const MAX_SESSIONS = 5
const STORAGE_PREFIX = "knowledge_copilot_sessions_"

// Default pipeline steps shown during Deep Track
const DEFAULT_PIPELINE_STEPS: PipelineStep[] = [
    { id: "triaging", label: "Triage Router", status: "pending" },
    { id: "researching", label: "Researcher (RAG)", status: "pending" },
    { id: "drafting", label: "Drafter (Claude)", status: "pending" },
    { id: "integrating", label: "Integrator", status: "pending" },
    { id: "auditing", label: "Auditor (QA)", status: "pending" },
]

const KNOWLEDGE_API_URL = process.env.NEXT_PUBLIC_KNOWLEDGE_API_URL || "http://localhost:3004"

export function KnowledgeCopilotPane({ html, onHtmlChange, audienceContext = "dreamplay", campaignId }: KnowledgeCopilotPaneProps) {
    // ─── Session Persistence ─────────────────────────
    const [currentSessionId, setCurrentSessionId] = useState<string>(() => `ks-${Date.now()}`)
    const [sessions, setSessions] = useState<ChatSession[]>([])
    const [sessionPickerOpen, setSessionPickerOpen] = useState(false)
    const sessionPickerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!campaignId) return
        try {
            const raw = localStorage.getItem(`${STORAGE_PREFIX}${campaignId}`)
            if (raw) {
                const saved: ChatSession[] = JSON.parse(raw)
                setSessions(saved)
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

    const saveCurrentSession = useCallback((msgs: Message[]) => {
        if (!campaignId || msgs.length <= 1) return
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
            allSessions = allSessions.slice(0, MAX_SESSIONS)
            localStorage.setItem(`${STORAGE_PREFIX}${campaignId}`, JSON.stringify(allSessions))
            setSessions(allSessions)
        } catch (e) {
            console.error("Failed to save copilot session:", e)
        }
    }, [campaignId, currentSessionId])

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (sessionPickerRef.current && !sessionPickerRef.current.contains(e.target as Node)) {
                setSessionPickerOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const KNOWLEDGE_SUGGESTIONS = [
        "✍️ Write a welcome email for new beginners",
        "🎵 Create a promo email for the latest sheet music",
        "💡 Suggest 3 engaging subject lines for this draft",
        "📝 Rewrite this copy to be shorter and punchier"
    ]

    const handleNewSession = () => {
        const newId = `ks-${Date.now()}`
        setCurrentSessionId(newId)
        setMessages([{ role: "result", content: "👋 Hi! I'm your Knowledge Copilot. I have access to your brand context, research, and personas.\n\nTell me what you'd like to write or change." }])
        setSessionPickerOpen(false)
    }

    const handleLoadSession = (session: ChatSession) => {
        setCurrentSessionId(session.id)
        setMessages(session.messages)
        setSessionPickerOpen(false)
    }

    const [messages, setMessages] = useState<Message[]>([
        { role: "result", content: "👋 Hi! I'm your Knowledge Copilot. I have access to your brand context, research, and personas.\n\nTell me what you'd like to write or change." },
    ])

    const [input, setInput] = useState("")
    const [isUploading, setIsUploading] = useState(false)
    const [pendingAttachments, setPendingAttachments] = useState<string[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([])
    const scrollRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [messages, isLoading, pipelineSteps])

    useEffect(() => {
        saveCurrentSession(messages)
    }, [messages, saveCurrentSession])

    const uploadFile = async (file: File) => {
        setIsUploading(true)
        try {
            const formData = new FormData()
            formData.append('file', file)
            const response = await fetch('/api/upload', { method: 'POST', body: formData })
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || "Upload failed")
            setPendingAttachments(prev => [...prev, data.url])
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : "Unknown error"
            console.error("Upload failed:", msg)
            setMessages(prev => [...prev, { role: 'result', content: `❌ Failed to upload image: ${file.name} (${msg})` }])
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

    // ─── SSE-based send ──────────────────────────────
    const handleSendMessage = async (textOverride?: string) => {
        const actualInput = textOverride || input;
        if ((!actualInput.trim() && pendingAttachments.length === 0) || isLoading || isUploading) return

        const userMessage = actualInput.trim()
        const attachments = [...pendingAttachments]

        setInput("")
        setPendingAttachments([])

        const newMessage: Message = {
            role: "user",
            content: userMessage,
            imageUrls: attachments
        }

        setMessages(prev => [...prev, newMessage])
        setIsLoading(true)

        // Initialize pipeline steps tracker
        const steps = DEFAULT_PIPELINE_STEPS.map(s => ({ ...s }))
        setPipelineSteps(steps)

        try {
            const response = await fetch(`${KNOWLEDGE_API_URL}/api/copilot`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: userMessage,
                    currentHtml: html,
                    platform: "email",
                }),
            })

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`)
            }

            const reader = response.body?.getReader()
            if (!reader) throw new Error("No response stream")

            const decoder = new TextDecoder()
            let buffer = ""

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split("\n\n")
                buffer = lines.pop() || ""

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue
                    try {
                        const event = JSON.parse(line.slice(6))

                        // Update pipeline steps based on event status
                        setPipelineSteps(prev => {
                            const updated = prev.map(step => ({ ...step }))

                            if (event.status === "triaging" || event.status === "routed") {
                                const triageStep = updated.find(s => s.id === "triaging")
                                if (triageStep) {
                                    triageStep.status = event.status === "routed" ? "done" : "active"
                                    triageStep.message = event.message

                                    // If FAST_TRACK, mark remaining as skipped
                                    if (event.track === "FAST_TRACK") {
                                        updated.forEach(s => {
                                            if (s.id !== "triaging") s.status = "pending"
                                        })
                                    }
                                }
                            }

                            if (event.status === "researching") {
                                const step = updated.find(s => s.id === "researching")
                                if (step) { step.status = "active"; step.message = event.message }
                                const triage = updated.find(s => s.id === "triaging")
                                if (triage) triage.status = "done"
                            }

                            if (event.status === "drafting") {
                                const step = updated.find(s => s.id === "drafting")
                                if (step) { step.status = "active"; step.message = event.message }
                                const prev2 = updated.find(s => s.id === "researching")
                                if (prev2) prev2.status = "done"
                            }

                            if (event.status === "integrating") {
                                const step = updated.find(s => s.id === "integrating")
                                if (step) { step.status = "active"; step.message = event.message }
                                const prev2 = updated.find(s => s.id === "drafting")
                                if (prev2) prev2.status = "done"
                            }

                            if (event.status === "auditing") {
                                const step = updated.find(s => s.id === "auditing")
                                if (step) { step.status = "active"; step.message = event.message }
                                const prev2 = updated.find(s => s.id === "integrating")
                                if (prev2) prev2.status = "done"
                            }

                            if (event.status === "fast_track") {
                                // Fast track: mark all as done instantly
                                updated.forEach(s => s.status = "done")
                            }

                            if (event.status === "complete") {
                                updated.forEach(s => { if (s.status !== "error") s.status = "done" })
                            }

                            if (event.status === "error") {
                                const activeStep = updated.find(s => s.status === "active")
                                if (activeStep) { activeStep.status = "error"; activeStep.message = event.message }
                            }

                            return updated
                        })

                        // Handle final response
                        if (event.status === "complete") {
                            if (event.html) {
                                onHtmlChange(event.html, userMessage)
                            }

                            const resultMessages: Message[] = []

                            // Add pipeline summary as a special message
                            resultMessages.push({
                                role: "pipeline",
                                content: "",
                                pipelineSteps: pipelineSteps.map(s => ({ ...s, status: "done" as const })),
                            })

                            resultMessages.push({
                                role: "result",
                                content: event.message || "Done."
                            })

                            // Add details about the pipeline
                            const details: string[] = []
                            if (event.track) details.push(`Track: ${event.track}`)
                            if (event.persona) details.push(`Persona: ${event.persona}`)
                            if (event.mission) details.push(`Mission: ${event.mission}`)
                            if (event.researchDocs?.length > 0) details.push(`Research: ${event.researchDocs.join(", ")}`)
                            if (event.citedResearchIds?.length > 0) details.push(`Citations: ${event.citedResearchIds.length}`)

                            if (details.length > 0) {
                                resultMessages.push({
                                    role: "details",
                                    content: details.join("  ·  ")
                                })
                            }

                            setMessages(prev => [...prev, ...resultMessages])
                        }

                        if (event.status === "error") {
                            setMessages(prev => [...prev, { role: "result", content: `❌ ${event.message}` }])
                        }

                    } catch {
                        // Skip malformed events
                    }
                }
            }

        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : "Unknown error"
            console.error("Knowledge Copilot Error:", msg)
            setMessages(prev => [...prev, { role: "result", content: `Error: ${msg}` }])
        } finally {
            setIsLoading(false)
            setPipelineSteps([])
        }
    }

    const canSend = !isLoading && (input.trim() || pendingAttachments.length > 0)

    // ─── Pipeline Step Icon ──────────────────────────
    const StepIcon = ({ status }: { status: PipelineStep["status"] }) => {
        switch (status) {
            case "done": return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            case "active": return <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
            case "error": return <AlertCircle className="w-3.5 h-3.5 text-red-500" />
            default: return <Circle className="w-3.5 h-3.5 text-muted-foreground/40" />
        }
    }

    return (
        <div className="flex flex-col h-full border-l border-border bg-card text-card-foreground">
            {/* Header */}
            <div className="h-14 border-b border-border flex items-center px-4 gap-2 justify-between shrink-0 bg-background/50 backdrop-blur">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <h2 className="text-sm font-semibold">Knowledge Copilot</h2>
                    <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/30">V2</Badge>
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
                                        <button onClick={handleNewSession} className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors">
                                            <Plus className="w-3 h-3" /> New
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
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
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

                        {/* Pipeline Summary */}
                        {msg.role === "pipeline" && msg.pipelineSteps && (
                            <div className="bg-muted/50 border border-border rounded-lg p-3 space-y-1.5">
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Pipeline Complete</p>
                                {msg.pipelineSteps.map(step => (
                                    <div key={step.id} className="flex items-center gap-2">
                                        <StepIcon status={step.status} />
                                        <span className="text-xs text-foreground">{step.label}</span>
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
                                        : msg.role === "pipeline"
                                            ? "hidden"
                                            : "p-3 bg-muted text-foreground rounded-bl-sm"
                            )}>
                                {msg.content}
                            </div>
                        )}
                    </div>
                ))}

                {/* Live Pipeline Progress */}
                {isLoading && pipelineSteps.length > 0 && (
                    <div className="mr-auto bg-card border border-border rounded-lg p-3 space-y-1.5 max-w-[85%]">
                        <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Brain className="w-3 h-3" /> Pipeline Running
                        </p>
                        {pipelineSteps.map((step, i) => (
                            <div key={step.id} className={cn("flex items-center gap-2 transition-opacity", step.status === "pending" && "opacity-40")}>
                                <StepIcon status={step.status} />
                                <span className={cn("text-xs", step.status === "active" ? "text-foreground font-medium" : "text-muted-foreground")}>
                                    {step.label}
                                </span>
                                {step.message && step.status === "active" && (
                                    <span className="text-[10px] text-muted-foreground ml-1 truncate max-w-[120px]">— {step.message}</span>
                                )}
                                {i < pipelineSteps.length - 1 && step.status === "done" && (
                                    <ArrowRight className="w-2.5 h-2.5 text-green-500/50 ml-auto" />
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {isLoading && pipelineSteps.length === 0 && (
                    <div className="mr-auto flex items-center gap-2 text-muted-foreground text-sm p-2">
                        <Brain className="w-4 h-4 animate-pulse" />
                        Connecting to Knowledge API...
                    </div>
                )}

                {/* Suggestions for New Sessions */}
                {messages.length === 1 && !isLoading && pipelineSteps.length === 0 && (
                    <div className="mr-auto items-start flex flex-col gap-2 max-w-[90%] pt-2">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider ml-1">Try asking Copilot to:</p>
                        <div className="flex flex-col gap-2 w-full">
                            {KNOWLEDGE_SUGGESTIONS.map((suggestion, i) => (
                                <button
                                    key={i}
                                    onClick={() => handleSendMessage(suggestion.replace(/^[^a-zA-Z]+/, ""))}
                                    className="text-left text-sm bg-muted/50 hover:bg-amber-500/10 border border-border hover:border-amber-500/30 rounded-xl px-4 py-2.5 transition-colors text-foreground/80 hover:text-amber-500"
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
                {/* Pending Uploads */}
                {(pendingAttachments.length > 0 || isUploading) && (
                    <div className="flex gap-2 overflow-x-auto pb-3">
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

                <div className="space-y-2">
                    <input
                        type="file"
                        multiple
                        accept="image/*,.pdf,application/pdf"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                    />

                    <Input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault()
                                handleSendMessage()
                            }
                        }}
                        onPaste={handlePaste}
                        placeholder="Tell the Knowledge Copilot what to generate..."
                        className="w-full min-h-[40px]"
                        disabled={isLoading}
                        autoFocus
                    />

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
                        </div>

                        <Button
                            size="icon"
                            onClick={() => handleSendMessage()}
                            disabled={!canSend}
                            className={cn("bg-amber-600 hover:bg-amber-500 text-white h-8 w-8", isLoading && "opacity-50")}
                            title="Send to Knowledge Pipeline"
                        >
                            <Send className="w-3.5 h-3.5" />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
