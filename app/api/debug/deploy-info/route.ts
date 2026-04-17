import { NextResponse } from "next/server"

/**
 * GET /api/debug/deploy-info
 *
 * Returns the currently-serving Vercel deployment's git SHA, ref, and URL.
 * Use this to verify the production deployment matches the latest commit,
 * and to detect Inngest-app-URL drift:
 *
 *   1. Note the current main-branch HEAD:  git log -1 --pretty=format:%H
 *   2. curl https://email.dreamplaypianos.com/api/debug/deploy-info
 *   3. Compare .sha — if it doesn't match HEAD, Vercel is serving a stale build
 *   4. Compare .sha against Inngest step-output .deploy.sha from a recent run —
 *      if those disagree, Inngest is pointing at an old deployment.
 *
 * See docs/image-optimization-bug-diagnostic.md (2026-04-17 resolution) for
 * the bug class this catches.
 */
export const dynamic = "force-dynamic"

export async function GET() {
    return NextResponse.json({
        sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        shortSha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
        ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
        commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
        deploymentUrl: process.env.VERCEL_URL ?? null,
        environment: process.env.VERCEL_ENV ?? "unknown",
        region: process.env.VERCEL_REGION ?? null,
        nodeEnv: process.env.NODE_ENV ?? null,
        serverTimeUtc: new Date().toISOString(),
    })
}
