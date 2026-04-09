"use client"

import { useState } from "react"
import { renderTemplate } from "@/lib/render-template"
import { Card, CardContent } from "@/components/ui/card"
import { Monitor, Smartphone, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ChainStepPreviewProps {
    htmlContent: string | null
    variableValues: Record<string, any> | null
}

export function ChainStepPreview({ htmlContent, variableValues }: ChainStepPreviewProps) {
    const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop")

    if (!htmlContent) {
        return (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                <Mail className="h-5 w-5 mr-2 opacity-50" />
                No email content found for this campaign.
            </div>
        )
    }

    // Render the template with variable values
    const baseRendered = renderTemplate(htmlContent, variableValues || {})

    // Append unsubscribe footer (matches live sends)
    const unsubscribeFooter = `
<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; font-family: sans-serif;">
  <p style="margin: 0;">
    No longer want to receive these emails? 
    <a href="#" style="color: #6b7280; text-decoration: underline;">Unsubscribe here</a>.
  </p>
</div>
`
    const renderedHtml = baseRendered.includes("</body>")
        ? baseRendered.replace("</body>", `${unsubscribeFooter}</body>`)
        : baseRendered + unsubscribeFooter

    return (
        <div className="space-y-3">
            {/* Desktop/Mobile Toggle */}
            <div className="flex justify-end">
                <div className="flex gap-1 rounded-lg border border-border bg-background p-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPreviewMode("desktop")}
                        className={`gap-1.5 h-7 px-2.5 ${previewMode === "desktop"
                            ? "bg-[#D4AF37] text-[#050505] hover:bg-[#D4AF37]"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                            }`}
                    >
                        <Monitor className="h-3.5 w-3.5" />
                        <span className="text-xs">Desktop</span>
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPreviewMode("mobile")}
                        className={`gap-1.5 h-7 px-2.5 ${previewMode === "mobile"
                            ? "bg-[#D4AF37] text-[#050505] hover:bg-[#D4AF37]"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                            }`}
                    >
                        <Smartphone className="h-3.5 w-3.5" />
                        <span className="text-xs">Mobile</span>
                    </Button>
                </div>
            </div>

            {/* Preview */}
            <div className="flex justify-center rounded-lg border border-border bg-zinc-950 p-4">
                <div
                    className={`relative overflow-hidden rounded-lg border-2 border-zinc-700 bg-white shadow-2xl transition-all duration-300 ${previewMode === "mobile" ? "w-[375px]" : "w-full max-w-[600px]"
                        }`}
                >
                    {/* Browser Chrome */}
                    <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-100 px-4 py-2">
                        <div className="flex gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
                            <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
                            <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
                        </div>
                        <div className="flex-1 rounded-md bg-white px-3 py-0.5 text-[10px] text-zinc-400">mail.example.com</div>
                    </div>

                    {/* Email Content */}
                    <div className="h-[600px] overflow-y-auto">
                        <iframe
                            srcDoc={renderedHtml}
                            title="Email Preview"
                            className="h-full w-full border-0"
                            sandbox="allow-same-origin"
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}
