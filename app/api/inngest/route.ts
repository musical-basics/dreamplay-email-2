import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { sendCampaign } from "@/inngest/functions/send-campaign";
import { scheduledCampaignSend } from "@/inngest/functions/scheduled-send";
import { scheduledRotationSend } from "@/inngest/functions/scheduled-rotation-send";
import { genericChainRunner } from "@/inngest/functions/chains/generic";
import { audienceEnrichment } from "@/inngest/functions/audience-enrichment";
import { customizeAbandonment } from "@/inngest/functions/chains/behavioral";

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        sendCampaign,
        scheduledCampaignSend,
        scheduledRotationSend,
        genericChainRunner,
        audienceEnrichment,
        customizeAbandonment,
    ],
});
