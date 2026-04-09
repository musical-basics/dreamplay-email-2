"use client"

import { Monitor, Smartphone, Mail } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Campaign } from "@/lib/types"
import { renderTemplate } from "@/lib/render-template"

interface EmailPreviewCardProps {
    campaign: Campaign
    previewMode: "desktop" | "mobile"
    onPreviewModeChange: (mode: "desktop" | "mobile") => void
}

export function EmailPreviewCard({ campaign, previewMode, onPreviewModeChange }: EmailPreviewCardProps) {
    // Replace Mustache variables with actual values for preview
    const baseRendered = renderTemplate(campaign.html_content || "", campaign.variable_values || {})

    // Append unsubscribe footer (matches what recipients actually receive)
    const unsubscribeFooter = `
<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280; font-family: sans-serif;">
  <p style="margin: 0;">
    No longer want to receive these emails? 
    <a href="#" style="color: #6b7280; text-decoration: underline;">Unsubscribe here</a>.
  </p>
</div>
`;
    const renderedHtml = baseRendered.includes("</body>")
        ? baseRendered.replace("</body>", `${unsubscribeFooter}</body>`)
        : baseRendered + unsubscribeFooter

    return (
        <Card className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium text-foreground">
                    <Mail className="h-5 w-5 text-[#D4AF37]" />
                    Email Preview
                </CardTitle>

                {/* Desktop/Mobile Toggle */}
                <div className="flex gap-1 rounded-lg border border-border bg-background p-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onPreviewModeChange("desktop")}
                        className={`gap-2 ${previewMode === "desktop"
                            ? "bg-[#D4AF37] text-[#050505] hover:bg-[#D4AF37]"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                            }`}
                    >
                        <Monitor className="h-4 w-4" />
                        <span className="hidden sm:inline">Desktop</span>
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onPreviewModeChange("mobile")}
                        className={`gap-2 ${previewMode === "mobile"
                            ? "bg-[#D4AF37] text-[#050505] hover:bg-[#D4AF37]"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                            }`}
                    >
                        <Smartphone className="h-4 w-4" />
                        <span className="hidden sm:inline">Mobile</span>
                    </Button>
                </div>
            </CardHeader>

            <CardContent>
                {/* Preview Viewport Container */}
                <div className="flex justify-center rounded-lg border border-border bg-zinc-950 p-4">
                    {/* Device Frame */}
                    <div
                        className={`relative overflow-hidden rounded-lg border-2 border-zinc-700 bg-white shadow-2xl transition-all duration-300 ${previewMode === "mobile" ? "w-[375px]" : "w-full max-w-[600px]"
                            }`}
                    >
                        {/* Browser Chrome */}
                        <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-100 px-4 py-2">
                            <div className="flex gap-1.5">
                                <div className="h-3 w-3 rounded-full bg-red-400" />
                                <div className="h-3 w-3 rounded-full bg-yellow-400" />
                                <div className="h-3 w-3 rounded-full bg-green-400" />
                            </div>
                            <div className="flex-1 rounded-md bg-white px-3 py-1 text-xs text-zinc-400">mail.example.com</div>
                        </div>

                        {/* Email Content */}
                        <div
                            className="h-[500px] overflow-y-auto"
                            style={{ minHeight: "500px" }}
                        >
                            <iframe
                                srcDoc={renderedHtml}
                                title="Email Preview"
                                className="h-full w-full border-0"
                                sandbox="allow-same-origin"
                            />
                        </div>
                    </div>
                </div>

                <p className="mt-4 text-center text-xs text-muted-foreground">
                    Preview shows how the email will appear in recipient inboxes
                </p>
            </CardContent>
        </Card>
    )
}
