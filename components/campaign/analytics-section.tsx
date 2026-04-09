"use client"

import { BarChart3, MousePointerClick, Mail, Eye } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { CampaignStatus } from "@/lib/types"

interface AnalyticsSectionProps {
    status: CampaignStatus
}

const mockStats = {
    sent: 1240,
    delivered: 1218,
    openRate: 42.3,
    clickRate: 12.8,
}

export function AnalyticsSection({ status }: AnalyticsSectionProps) {
    const isActive = status === "completed" || status === "active"

    return (
        <Card className={`border-border bg-card ${!isActive ? "opacity-50" : ""}`}>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium text-foreground">
                    <BarChart3 className="h-5 w-5 text-[#D4AF37]" />
                    Post-Campaign Analytics
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                    {isActive
                        ? "Real-time performance metrics for this campaign."
                        : "Analytics will appear here after the campaign is sent."}
                </CardDescription>
            </CardHeader>

            <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {/* Sent */}
                    <div className="rounded-lg border border-border bg-background p-4">
                        <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Sent</span>
                        </div>
                        <p className="mt-2 text-2xl font-bold text-foreground">
                            {isActive ? mockStats.sent.toLocaleString() : "—"}
                        </p>
                    </div>

                    {/* Delivered */}
                    <div className="rounded-lg border border-border bg-background p-4">
                        <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Delivered</span>
                        </div>
                        <p className="mt-2 text-2xl font-bold text-foreground">
                            {isActive ? mockStats.delivered.toLocaleString() : "—"}
                        </p>
                    </div>

                    {/* Open Rate */}
                    <div className="rounded-lg border border-border bg-background p-4">
                        <div className="flex items-center gap-2">
                            <Eye className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Open Rate</span>
                        </div>
                        <p className="mt-2 text-2xl font-bold text-foreground">{isActive ? `${mockStats.openRate}%` : "—"}</p>
                    </div>

                    {/* Click Rate */}
                    <div className="rounded-lg border border-border bg-background p-4">
                        <div className="flex items-center gap-2">
                            <MousePointerClick className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Click Rate</span>
                        </div>
                        <p className="mt-2 text-2xl font-bold text-foreground">{isActive ? `${mockStats.clickRate}%` : "—"}</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
