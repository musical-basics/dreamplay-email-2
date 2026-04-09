"use client"

import { useState, useCallback, useTransition } from "react"
import { CampaignsTable } from "@/components/campaigns-table"
import { TemplateFolderList } from "@/components/campaigns/template-folder-list"
import { Campaign } from "@/lib/types"
import { getCampaigns } from "@/app/actions/campaigns"
import { DEFAULT_WORKSPACE } from "@/lib/workspace"
import { type TemplateFolder } from "@/app/actions/template-folders"

interface CampaignsTabsProps {
    campaigns: Campaign[]
    totalCompleted: number
    emailType?: string
    folders?: TemplateFolder[]
}

export function CampaignsTabs({ campaigns, totalCompleted, emailType = "campaign", folders = [] }: CampaignsTabsProps) {
    console.log("[CampaignsTabs] totalCompleted:", totalCompleted, "campaigns.length:", campaigns.length)
    const [activeTab, setActiveTab] = useState<"templates" | "drafts" | "scheduled" | "completed">("templates")
    const [completedCampaigns, setCompletedCampaigns] = useState<Campaign[]>(
        () => campaigns.filter(c => ["sent", "completed", "active"].includes(c.status) && !c.is_template)
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
            .slice(0, 25)
    )
    const [completedPage, setCompletedPage] = useState(0)
    const [completedPageSize, setCompletedPageSize] = useState(25)
    const [isPending, startTransition] = useTransition()

    const templates = campaigns.filter(c => c.is_template === true)
    const drafts = campaigns.filter(c => c.status === "draft" && !c.is_template && !c.variable_values?.subscriber_id)
    const scheduled = campaigns.filter(c => c.scheduled_at && c.scheduled_status !== "sent" && c.scheduled_status !== "cancelled")

    const handleCompletedPageChange = useCallback((page: number, pageSize: number) => {
        startTransition(async () => {
            const result = await getCampaigns(DEFAULT_WORKSPACE, emailType, { completedPage: page, completedPageSize: pageSize })
            const newCompleted = result.campaigns
                .filter((c: Campaign) => ["sent", "completed", "active"].includes(c.status) && !c.is_template)
                .sort((a: Campaign, b: Campaign) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                .slice(page * pageSize, (page + 1) * pageSize)
            setCompletedCampaigns(newCompleted)
            setCompletedPage(page)
            setCompletedPageSize(pageSize)
        })
    }, [emailType])

    const tabs = [
        { key: "templates" as const, label: "Master Templates", count: templates.length },
        { key: "drafts" as const, label: "Drafts", count: drafts.length },
        { key: "scheduled" as const, label: "Scheduled", count: scheduled.length },
        { key: "completed" as const, label: "Completed", count: totalCompleted },
    ]

    const tabData = {
        drafts: { title: "Drafts", campaigns: drafts, showAnalytics: false, enableBulkDelete: false, sortBy: "created_at" as const, paginate: false },
        scheduled: { title: "Scheduled Campaigns", campaigns: scheduled, showAnalytics: false, enableBulkDelete: false, sortBy: "created_at" as const, paginate: false },
        completed: { title: "Completed", campaigns: completedCampaigns, showAnalytics: true, enableBulkDelete: true, sortBy: "updated_at" as const, paginate: true },
    }

    return (
        <div className="space-y-4">
            {/* Tab Bar */}
            <div className="flex gap-1 border-b border-border">
                {tabs.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${activeTab === tab.key
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                            }`}
                    >
                        {tab.label}
                        {tab.count > 0 && (
                            <span className="ml-2 text-xs text-muted-foreground">({tab.count})</span>
                        )}
                        {activeTab === tab.key && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D4AF37]" />
                        )}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {activeTab === "templates" ? (
                <TemplateFolderList folders={folders} templates={templates} />
            ) : (
                <CampaignsTable
                    title={tabData[activeTab].title}
                    campaigns={tabData[activeTab].campaigns}
                    loading={activeTab === "completed" && isPending}
                    showAnalytics={tabData[activeTab].showAnalytics}
                    enableBulkDelete={tabData[activeTab].enableBulkDelete}
                    sortBy={tabData[activeTab].sortBy}
                    paginate={tabData[activeTab].paginate}
                    {...(activeTab === "completed" ? {
                        serverPagination: {
                            totalItems: totalCompleted,
                            currentPage: completedPage,
                            pageSize: completedPageSize,
                            onPageChange: handleCompletedPageChange,
                        }
                    } : {})}
                />
            )}
        </div>
    )
}
