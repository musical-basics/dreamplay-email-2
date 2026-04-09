import { CampaignsTabs } from "@/components/campaigns/campaigns-tabs"
import { CreateCampaignDialog } from "@/components/campaigns/create-campaign-dialog"
import { getCampaigns } from "@/app/actions/campaigns"
import { getTemplateFolders } from "@/app/actions/template-folders"

export const dynamic = "force-dynamic"

export default async function CampaignsPage({ params }: { params: Promise<{ workspace: string }> }) {
    const { workspace } = await params
    const [{ campaigns, totalCompleted }, folders] = await Promise.all([
        getCampaigns(workspace, "campaign"),
        getTemplateFolders(),
    ])

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Campaigns</h1>
                    <p className="text-muted-foreground mt-1">
                        Manage your email campaigns and newsletters.
                    </p>
                </div>
                <CreateCampaignDialog />
            </div>

            <CampaignsTabs campaigns={campaigns} totalCompleted={totalCompleted} emailType="campaign" folders={folders} />
        </div>
    )
}
