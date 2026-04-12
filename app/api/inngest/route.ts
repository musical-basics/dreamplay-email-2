import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { apiSend } from "@/inngest/functions/api-send";
import { scheduledCampaignSend } from "@/inngest/functions/scheduled-send";
import { scheduledRotationSend } from "@/inngest/functions/scheduled-rotation-send";
import { genericChainRunner } from "@/inngest/functions/chains/generic";
import { audienceEnrichment } from "@/inngest/functions/audience-enrichment";
import { customizeAbandonment } from "@/inngest/functions/chains/behavioral";

// CRITICAL: This MUST match the maxDuration of send-stream.
// Without this, Vercel kills the Inngest handler (the outer function) in 15-60s,
// severing its HTTP connection to /api/send-stream mid-flight — even though
// send-stream has maxDuration=300 set. The outer caller must also stay alive.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        apiSend,
        scheduledCampaignSend,
        scheduledRotationSend,
        genericChainRunner,
        audienceEnrichment,
        customizeAbandonment,
    ],
});
