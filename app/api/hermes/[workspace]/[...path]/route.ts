/**
 * Hermes API — Headless Agent Gateway
 *
 * Single catch-all route handling all M2M operations for the Hermes external agent.
 * Auth: Bearer token via HERMES_API_KEY env var.
 * DB:   Service-role Supabase client (bypasses RLS — never use anon key here).
 * Sends: Dispatched via Inngest events (never HTTP streams).
 *
 * URL shape: /api/hermes/[workspace]/[...path]
 *   e.g. GET  /api/hermes/dreamplay/campaigns
 *        POST /api/hermes/dreamplay/campaigns/abc123/send
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { inngest } from "@/inngest/client";

// ─── Auth helper ─────────────────────────────────────────────────────────────

function authenticate(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  const expectedKey = process.env.HERMES_API_KEY;
  if (!expectedKey) return false;
  return authHeader === `Bearer ${expectedKey}`;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function notFound(msg = "Not found") {
  return NextResponse.json({ error: msg }, { status: 404 });
}

function badRequest(msg = "Bad request") {
  return NextResponse.json({ error: msg }, { status: 400 });
}

// ─── Route params (Next.js 15+ params is a Promise) ──────────────────────────

type RouteContext = {
  params: Promise<{ workspace: string; path: string[] }>;
};

// ─── Shared admin client factory ──────────────────────────────────────────────

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHUNK 2: CAMPAIGNS
// ─────────────────────────────────────────────────────────────────────────────

async function handleCampaigns(
  request: Request,
  method: string,
  workspace: string,
  path: string[]
): Promise<NextResponse> {
  const supabase = getAdminClient();
  const campaignId = path[1];
  const action = path[2]; // e.g. "send", "analytics"

  // GET /campaigns
  // Supports: ?status=draft|sending|completed
  //           ?is_template=true        → master templates only
  //           ?email_type=campaign|automated|chain_step
  //           ?parent_template_id=<uuid> → all children of a specific template
  if (method === "GET" && !campaignId) {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const isTemplate = url.searchParams.get("is_template");
    const emailType = url.searchParams.get("email_type");
    const parentTemplateId = url.searchParams.get("parent_template_id");
    let query = supabase.from("campaigns").select("*").eq("workspace", workspace);
    if (status) query = query.eq("status", status);
    if (isTemplate !== null) query = query.eq("is_template", isTemplate === "true");
    if (emailType) query = query.eq("email_type", emailType);
    if (parentTemplateId) query = query.eq("parent_template_id", parentTemplateId);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // GET /campaigns/:id/analytics
  if (method === "GET" && campaignId && action === "analytics") {
    const { data, error } = await supabase
      .from("campaigns")
      .select("id, name, total_recipients, total_opens, total_clicks, status")
      .eq("id", campaignId)
      .single();
    if (error) return notFound("Campaign not found");
    return NextResponse.json(data);
  }

  // GET /campaigns/:id/sent-history — full recipient list with subscriber details
  if (method === "GET" && campaignId && action === "sent-history") {
    const { data, error } = await supabase
      .from("sent_history")
      .select("subscriber_id, sent_at, resend_email_id, subscribers(email, first_name, last_name, tags)")
      .eq("campaign_id", campaignId)
      .order("sent_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // GET /campaigns/:id
  if (method === "GET" && campaignId && !action) {
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();
    if (error) return notFound("Campaign not found");
    return NextResponse.json(data);
  }

  // POST /campaigns
  if (method === "POST" && !campaignId) {
    const body = await request.json();
    const { data, error } = await supabase
      .from("campaigns")
      .insert({
        ...body,
        status: "draft",
        email_type: body.email_type || "campaign",
        workspace,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  // PATCH /campaigns/:id
  if (method === "PATCH" && campaignId && !action) {
    const body = await request.json();
    const { data, error } = await supabase
      .from("campaigns")
      .update(body)
      .eq("id", campaignId)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // POST /campaigns/:id/send
  if (method === "POST" && campaignId && action === "send") {
    let body: Record<string, any> = {};
    try {
      body = await request.json();
    } catch {
      // body is optional
    }

    // ─── SAFETY GUARD: Require explicit recipient targeting ───────────────────
    // Without one of these fields, send-campaign.ts would blast ALL active
    // subscribers across the entire database. The Hermes API never allows
    // untargeted sends — this must be set deliberately by the caller.
    const { data: campaignCheck } = await supabase
      .from("campaigns")
      .select("variable_values, name")
      .eq("id", campaignId)
      .single();

    const vv = campaignCheck?.variable_values || {};
    const hasTargeting =
      vv.subscriber_id ||
      (Array.isArray(vv.subscriber_ids) && vv.subscriber_ids.length > 0) ||
      vv.target_tag;

    if (!hasTargeting) {
      return NextResponse.json(
        {
          error: "UNSAFE_SEND_BLOCKED",
          message:
            "Campaign has no recipient targeting configured. Set variable_values.subscriber_ids, " +
            "variable_values.subscriber_id, or variable_values.target_tag before sending. " +
            "Without targeting, this would send to all active subscribers.",
          campaign_name: campaignCheck?.name,
          fix: "PATCH /campaigns/" + campaignId + " with { variable_values: { subscriber_ids: ['<uuid>'] } }",
        },
        { status: 400 }
      );
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (body.scheduledAt) {
      // Scheduled send
      await supabase
        .from("campaigns")
        .update({
          scheduled_at: body.scheduledAt,
          scheduled_status: "pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId);

      await inngest.send({
        name: "campaign.scheduled-send",
        data: { campaignId, scheduledAt: body.scheduledAt },
      });

      return NextResponse.json({ success: true, scheduled: true, scheduledAt: body.scheduledAt });
    } else {
      // Immediate send
      await supabase
        .from("campaigns")
        .update({ status: "sending", updated_at: new Date().toISOString() })
        .eq("id", campaignId);

      await inngest.send({
        name: "campaign.send",
        data: { campaignId },
      });

      return NextResponse.json({ success: true, scheduled: false });
    }
  }

  return notFound("Campaign endpoint not found");
}


// ─────────────────────────────────────────────────────────────────────────────
// CHUNK 3: CHAINS (Drip Sequences)
// ─────────────────────────────────────────────────────────────────────────────

async function handleChains(
  request: Request,
  method: string,
  workspace: string,
  path: string[]
): Promise<NextResponse> {
  const supabase = getAdminClient();
  const chainId = path[1];
  const action = path[2]; // "steps", "activate", "deactivate", "analytics"

  // GET /chains
  if (method === "GET" && !chainId) {
    const { data, error } = await supabase
      .from("email_chains")
      .select("*, chain_steps(*), chain_branches(*)")
      .eq("workspace", workspace);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // GET /chains/:id/analytics
  if (method === "GET" && chainId && action === "analytics") {
    const { data, error } = await supabase
      .from("chain_processes")
      .select("id, status, created_at")
      .eq("chain_id", chainId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const enrolled = data?.length ?? 0;
    const completed = data?.filter((p: any) => p.status === "completed").length ?? 0;
    return NextResponse.json({ chainId, enrolled, completed });
  }

  // GET /chains/:id
  if (method === "GET" && chainId && !action) {
    const { data, error } = await supabase
      .from("email_chains")
      .select("*, chain_steps(*), chain_branches(*)")
      .eq("id", chainId)
      .single();
    if (error) return notFound("Chain not found");
    return NextResponse.json(data);
  }

  // POST /chains — create master chain (+ optional steps bulk insert)
  if (method === "POST" && !chainId) {
    const body = await request.json();
    const { steps: stepsPayload, ...chainFields } = body;

    const { data: chain, error: chainErr } = await supabase
      .from("email_chains")
      .insert({ ...chainFields, workspace })
      .select()
      .single();

    if (chainErr) return NextResponse.json({ error: chainErr.message }, { status: 500 });

    if (stepsPayload && Array.isArray(stepsPayload) && stepsPayload.length > 0) {
      const steps = stepsPayload.map((s: any, i: number) => ({
        chain_id: chain.id,
        position: s.position ?? i,
        label: s.label,
        template_key: s.template_key,
        wait_after: s.wait_after,
      }));
      const { error: stepsErr } = await supabase.from("chain_steps").insert(steps);
      if (stepsErr) {
        return NextResponse.json(
          { chain, warning: "Chain created but steps insert failed: " + stepsErr.message },
          { status: 207 }
        );
      }
    }

    return NextResponse.json(chain, { status: 201 });
  }

  // POST /chains/:id/steps — add a step to an existing chain
  if (method === "POST" && chainId && action === "steps") {
    const body = await request.json();
    const { data, error } = await supabase
      .from("chain_steps")
      .insert({
        chain_id: chainId,
        position: body.position,
        label: body.label,
        template_key: body.template_key,
        wait_after: body.wait_after,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  // POST /chains/:id/activate
  if (method === "POST" && chainId && action === "activate") {
    const { data, error } = await supabase
      .from("email_chains")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", chainId)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // POST /chains/:id/deactivate
  if (method === "POST" && chainId && action === "deactivate") {
    const { data, error } = await supabase
      .from("email_chains")
      .update({ status: "draft", updated_at: new Date().toISOString() })
      .eq("id", chainId)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  return notFound("Chain endpoint not found");
}

// ─────────────────────────────────────────────────────────────────────────────
// CHUNK 4: SUBSCRIBERS & TAGGING (Webhook Proxy)
// ─────────────────────────────────────────────────────────────────────────────

async function handleSubscribers(
  request: Request,
  method: string,
  workspace: string,
  path: string[]
): Promise<NextResponse> {
  const supabase = getAdminClient();
  const subscriberId = path[1];
  const action = path[2]; // "bulk-tag"

  // GET /subscribers
  if (method === "GET" && !subscriberId) {
    const url = new URL(request.url);
    const tag = url.searchParams.get("tag");
    const search = url.searchParams.get("search");
    const status = url.searchParams.get("status");

    let query = supabase.from("subscribers").select("*").eq("workspace", workspace);
    if (tag) query = query.contains("tags", [tag]);
    if (search) query = query.ilike("email", `%${search}%`);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // GET /subscribers/:id/history — sent emails + engagement events
  if (method === "GET" && subscriberId && action === "history") {
    const [sentRes, eventsRes] = await Promise.all([
      supabase
        .from("sent_history")
        .select("campaign_id, sent_at, resend_email_id, campaigns(name, subject_line)")
        .eq("subscriber_id", subscriberId)
        .order("sent_at", { ascending: false }),
      supabase
        .from("subscriber_events")
        .select("event_type, occurred_at, metadata")
        .eq("subscriber_id", subscriberId)
        .order("occurred_at", { ascending: false }),
    ]);
    if (sentRes.error) return NextResponse.json({ error: sentRes.error.message }, { status: 500 });
    return NextResponse.json({
      sent: sentRes.data || [],
      events: eventsRes.data || [],
    });
  }

  // GET /subscribers/:id
  if (method === "GET" && subscriberId && !action) {
    const { data, error } = await supabase
      .from("subscribers")
      .select("*")
      .eq("id", subscriberId)
      .single();
    if (error) return notFound("Subscriber not found");
    return NextResponse.json(data);
  }

  // PATCH /subscribers/:id — update profile fields (never overwrites tags via this endpoint)
  // To modify tags use POST /subscribers or POST /subscribers/bulk-tag instead.
  if (method === "PATCH" && subscriberId && !action) {
    const body = await request.json();
    // Guard: strip tags from patch body so tags are only ever managed via the webhook proxy
    // (ensures tag colors, trigger evaluation, and identity stitching always run)
    const { tags: _stripped, workspace: _ws, ...safeFields } = body;
    const { data, error } = await supabase
      .from("subscribers")
      .update({ ...safeFields, updated_at: new Date().toISOString() })
      .eq("id", subscriberId)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // POST /subscribers — upsert + trigger evaluation via webhook proxy
  if (method === "POST" && !subscriberId) {
    const body = await request.json();
    const { email, first_name, last_name, tags, city, country } = body;

    if (!email) return badRequest("email is required");

    const webhookRes = await fetch(new URL("/api/webhooks/subscribe", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, first_name, last_name, tags, city, country, workspace }),
    });
    const webhookData = await webhookRes.json();
    if (!webhookRes.ok) {
      return NextResponse.json({ error: webhookData.error || "Subscribe failed" }, { status: webhookRes.status });
    }
    return NextResponse.json(webhookData, { status: 201 });
  }

  // POST /subscribers/bulk-tag
  if (method === "POST" && subscriberId === "bulk-tag") {
    const body = await request.json();
    const emails: string[] = body.emails || [];
    const tags: string[] = body.tags || [];

    if (!emails.length) return badRequest("emails array is required");
    if (!tags.length) return badRequest("tags array is required");

    const results: Array<{ email: string; success: boolean; error?: string }> = [];

    for (const email of emails) {
      const webhookRes = await fetch(new URL("/api/webhooks/subscribe", request.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tags, workspace }),
      });
      const webhookData = await webhookRes.json();
      results.push({
        email,
        success: webhookRes.ok,
        ...(webhookRes.ok ? {} : { error: webhookData.error }),
      });
    }

    const succeeded = results.filter((r) => r.success).length;
    return NextResponse.json({ succeeded, total: emails.length, results });
  }

  return notFound("Subscriber endpoint not found");
}

// ─────────────────────────────────────────────────────────────────────────────
// CHUNK 5: SYSTEM METADATA — tags, merge-tags, triggers
// ─────────────────────────────────────────────────────────────────────────────

async function handleTags(
  request: Request,
  method: string,
  workspace: string,
  path: string[]
): Promise<NextResponse> {
  const supabase = getAdminClient();
  const tagId = path[1]; // present for /tags/:tag_id

  if (method === "GET") {
    const { data, error } = await supabase
      .from("tag_definitions")
      .select("*")
      .eq("workspace", workspace);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  if (method === "POST") {
    const body = await request.json();
    const { data, error } = await supabase
      .from("tag_definitions")
      .insert({ ...body, workspace })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  // DELETE /tags/:tag_id
  // Tags are stored as TEXT[] on subscribers.tags (no junction table).
  // We: (1) validate the tag belongs to this workspace, (2) remove the tag
  // name from every subscriber's tags array, (3) delete the tag_definitions row.
  if (method === "DELETE" && tagId) {
    // 1. Validate tag exists and belongs to this workspace
    const { data: tagDef, error: tagErr } = await supabase
      .from("tag_definitions")
      .select("id, name")
      .eq("id", tagId)
      .eq("workspace", workspace)
      .single();

    if (tagErr || !tagDef) return notFound("Tag not found in this workspace");

    // 2. Find every subscriber in this workspace whose tags array contains this tag name
    const { data: affectedSubs, error: subFetchErr } = await supabase
      .from("subscribers")
      .select("id, tags")
      .eq("workspace", workspace)
      .contains("tags", [tagDef.name]);

    if (subFetchErr) {
      return NextResponse.json({ error: subFetchErr.message }, { status: 500 });
    }

    // 3. Remove the tag name from each subscriber's tags array (parallel batch)
    if (affectedSubs && affectedSubs.length > 0) {
      const updates = affectedSubs.map((sub: any) =>
        supabase
          .from("subscribers")
          .update({ tags: (sub.tags || []).filter((t: string) => t !== tagDef.name) })
          .eq("id", sub.id)
      );
      const results = await Promise.all(updates);
      const firstErr = results.find((r) => r.error);
      if (firstErr?.error) {
        return NextResponse.json({ error: firstErr.error.message }, { status: 500 });
      }
    }

    // 4. Delete the tag_definitions row
    const { error: deleteErr } = await supabase
      .from("tag_definitions")
      .delete()
      .eq("id", tagId)
      .eq("workspace", workspace);

    if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      removedFrom: affectedSubs?.length ?? 0,
    });
  }

  return notFound("Tags endpoint not found");
}

async function handleMergeTags(
  request: Request,
  method: string
): Promise<NextResponse> {
  // merge_tags is a global table — no workspace column
  const supabase = getAdminClient();

  if (method === "GET") {
    const { data, error } = await supabase.from("merge_tags").select("*");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  return notFound("Merge-tags endpoint not found");
}

async function handleTriggers(
  request: Request,
  method: string,
  workspace: string
): Promise<NextResponse> {
  const supabase = getAdminClient();

  if (method === "GET") {
    const { data, error } = await supabase
      .from("email_triggers")
      .select("*")
      .eq("workspace", workspace);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  if (method === "POST") {
    const body = await request.json();
    const { data, error } = await supabase
      .from("email_triggers")
      .insert({ ...body, workspace })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  return notFound("Triggers endpoint not found");
}

// ─────────────────────────────────────────────────────────────────────────────
// CHUNK 6: COPILOT PROXY
// ─────────────────────────────────────────────────────────────────────────────

async function handleCopilot(
  request: Request,
  workspace: string
): Promise<NextResponse> {
  let body: Record<string, any> = {};
  try {
    body = await request.json();
  } catch {
    // empty body is OK
  }

  const copilotRes = await fetch(new URL("/api/copilot", request.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: body.messages || [],
      audienceContext: workspace === "musicalbasics" ? "musicalbasics" : "dreamplay",
      model: body.model || "auto",
      currentHtml: body.currentHtml || "",
    }),
  });

  const data = await copilotRes.json();
  if (!copilotRes.ok) {
    return NextResponse.json({ error: data.error || "Copilot request failed" }, { status: copilotRes.status });
  }
  return NextResponse.json(data);
}

// ─────────────────────────────────────────────────────────────────────────────
// CHUNK 1: ROUTE SHELL — Auth, Dispatch
// ─────────────────────────────────────────────────────────────────────────────

async function handleRequest(request: Request, ctx: RouteContext): Promise<NextResponse> {
  // 1. Auth
  if (!authenticate(request)) return unauthorized();

  // 2. Resolve params (Next.js 15 async params)
  const { workspace, path } = await ctx.params;
  const method = request.method.toUpperCase();

  // 3. Route dispatch
  const resource = path[0];

  switch (resource) {
    case "campaigns":
      return handleCampaigns(request, method, workspace, path);

    case "chains":
      return handleChains(request, method, workspace, path);

    case "subscribers":
      return handleSubscribers(request, method, workspace, path);

    case "tags":
      return handleTags(request, method, workspace, path);

    case "merge-tags":
      return handleMergeTags(request, method);

    case "triggers":
      return handleTriggers(request, method, workspace);

    case "copilot":
      if (method !== "POST") return badRequest("Copilot only accepts POST");
      return handleCopilot(request, workspace);

    default:
      return notFound(`Unknown resource: ${resource}`);
  }
}

// ─── Export HTTP methods ──────────────────────────────────────────────────────

export async function GET(request: Request, ctx: RouteContext) {
  return handleRequest(request, ctx);
}

export async function POST(request: Request, ctx: RouteContext) {
  return handleRequest(request, ctx);
}

export async function PATCH(request: Request, ctx: RouteContext) {
  return handleRequest(request, ctx);
}

export async function DELETE(request: Request, ctx: RouteContext) {
  return handleRequest(request, ctx);
}
