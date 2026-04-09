"use client"

import { Code } from "lucide-react"

interface CodePaneProps {
    code: string
    onChange: (code: string) => void
    className?: string
}

export function CodePane({ code, onChange, className }: CodePaneProps) {
    return (
        <div className={`flex flex-col border-r border-border bg-card ${className || "flex-1"}`}>
            <div className="p-4 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Code className="w-4 h-4" />
                    HTML Editor
                </h2>
                <span className="text-xs text-muted-foreground font-mono">index.html</span>
            </div>
            <div className="flex-1 p-0 relative">
                <textarea
                    value={code}
                    onChange={(e) => onChange(e.target.value)}
                    className="absolute inset-0 w-full h-full p-4 bg-[#1e1e1e] text-[#d4d4d4] font-mono text-sm resize-none focus:outline-none leading-relaxed"
                    spellCheck={false}
                    placeholder="Write your HTML here..."
                />
            </div>
        </div>
    )
}
