# Hermes API — Agent Integration Guide

> **For AI agents (Hermes bots) that need to autonomously manage campaigns, subscribers, and email chains on the DreamPlay Email platform.**

---

## Overview

The Hermes API is a headless M2M (machine-to-machine) gateway that gives external agents full CRUD access to the email platform. All operations run with service-role database privileges (bypasses RLS). Sends are dispatched via Inngest — not HTTP streams — so fire-and-forget is safe.

**Base URL:**
```
https://dreamplay-email-2.vercel.app/api/hermes/{workspace}/{resource}
```

**Workspace values:**

| Slug | Audience |
|---|---|
| `dreamplay_marketing` | DreamPlay main marketing audience |
| `musicalbasics` | Musical Basics audience |
| `dreamplay_support` | DreamPlay support audience |
| `crossover` | Crossover audience |
| `concert_marketing` | Concert Marketing audience |

> ⚠️ **Important:** Use the full slug (e.g. `dreamplay_marketing`, NOT `dreamplay`). Incorrect slugs return a `500` enum mismatch error.

---

## Authentication

All requests require a Bearer token in the `Authorization` header:

```http
Authorization: Bearer <HERMES_API_KEY>
```

The key is stored in the `HERMES_API_KEY` environment variable on the server. Requests without a valid token receive `401 Unauthorized`.

---

## Resources

| Resource | Path prefix | Description |
|---|---|---|
| Campaigns | `/campaigns` | Draft, send, and inspect email campaigns |
| Chains | `/chains` | Drip sequence (email automation) management |
| Subscribers | `/subscribers` | Audience management + tagging |
| Tags | `/tags` | Tag definitions for the workspace |
| Merge Tags | `/merge-tags` | System-wide merge tag registry |
| Triggers | `/triggers` | Tag-based automation triggers |
| Copilot | `/copilot` | LLM-assisted email copy generation |

---

## Campaigns

### `GET /api/hermes/{workspace}/campaigns`

List all campaigns. Supports optional query filters:

| Query param | Values | Description |
|---|---|---|
| `status` | `draft`, `sending`, `completed` | Filter by send status (server-side) |
| `is_template` | `true` | Return master templates only (server-side) |
| `email_type` | `campaign`, `automated`, `chain_step` | Filter by email type (server-side) |
| `parent_template_id` | `<uuid>` | Return all children of a specific master template (server-side) |

**Example — list drafts:**
```http
GET /api/hermes/dreamplay/campaigns?status=draft
Authorization: Bearer <key>
```

---

### `GET /api/hermes/{workspace}/campaigns/{id}`

Fetch a single campaign by ID. Returns full campaign row.

---

### `GET /api/hermes/{workspace}/campaigns/{id}/analytics`

Returns high-level engagement stats for a campaign:

```json
{
  "id": "abc123",
  "name": "Spring Sale",
  "total_recipients": 4200,
  "total_opens": 1890,
  "total_clicks": 340,
  "status": "completed"
}
```

---

### `GET /api/hermes/{workspace}/campaigns/{id}/sent-history`

Returns the full recipient list with subscriber profile details:

```json
[
  {
    "subscriber_id": "uuid",
    "sent_at": "2025-04-01T10:00:00Z",
    "resend_email_id": "resend_...",
    "subscribers": {
      "email": "user@example.com",
      "first_name": "Jane",
      "last_name": "Doe",
      "tags": ["vip", "purchased"]
    }
  }
]
```

---

### `POST /api/hermes/{workspace}/campaigns`

Create a new campaign (starts in `draft` status):

```json
{
  "name": "Spring Promo",
  "subject_line": "🌱 Spring has arrived!",
  "preview_text": "Our biggest sale yet",
  "html_content": "<html>...</html>",
  "email_type": "campaign",
  "audience_tags": ["newsletter"],
  "from_name": "DreamPlay",
  "from_email": "hello@dreamplay.com"
}
```

Returns: `201 Created` with the new campaign row.

---

### `PATCH /api/hermes/{workspace}/campaigns/{id}`

Update any fields on an existing campaign (e.g. subject, HTML, tags):

```json
{
  "subject_line": "Updated subject",
  "html_content": "<html>new content</html>"
}
```

---

### `POST /api/hermes/{workspace}/campaigns/{id}/send`

Trigger an immediate or scheduled send.

**Immediate send** (no body required):
```http
POST /api/hermes/dreamplay/campaigns/abc123/send
```

**Scheduled send:**
```json
{
  "scheduledAt": "2025-04-15T14:00:00Z"
}
```

Returns:
```json
{ "success": true, "scheduled": false }
// or
{ "success": true, "scheduled": true, "scheduledAt": "2025-04-15T14:00:00Z" }
```

> ⚠️ Sends are dispatched via Inngest. The campaign status is set to `sending` immediately, but delivery happens asynchronously.

---

## Chains (Drip Sequences)

### `GET /api/hermes/{workspace}/chains`

List all chains with their steps and branches.

---

### `GET /api/hermes/{workspace}/chains/{id}`

Fetch a single chain with steps and branches.

---

### `GET /api/hermes/{workspace}/chains/{id}/analytics`

Returns enrollment stats:

```json
{
  "chainId": "uuid",
  "enrolled": 1200,
  "completed": 850
}
```

---

### `POST /api/hermes/{workspace}/chains`

Create a chain, optionally with steps in one request:

```json
{
  "name": "Welcome Series",
  "status": "draft",
  "steps": [
    {
      "position": 0,
      "label": "Welcome Email",
      "template_key": "welcome_v1",
      "wait_after": "P0D"
    },
    {
      "position": 1,
      "label": "Follow-up",
      "template_key": "followup_v1",
      "wait_after": "P3D"
    }
  ]
}
```

Returns: `201 Created`. If steps fail, returns `207 Multi-Status` with `chain` + `warning`.

---

### `POST /api/hermes/{workspace}/chains/{id}/steps`

Add a step to an existing chain:

```json
{
  "position": 2,
  "label": "Upsell",
  "template_key": "upsell_v1",
  "wait_after": "P7D"
}
```

---

### `POST /api/hermes/{workspace}/chains/{id}/activate`

Set chain status to `active` (starts processing enrollments).

### `POST /api/hermes/{workspace}/chains/{id}/deactivate`

Set chain status back to `draft` (pauses processing).

---

## Subscribers

### `GET /api/hermes/{workspace}/subscribers`

List subscribers with optional filters:

| Query param | Description |
|---|---|
| `tag` | Filter by a single tag name |
| `search` | Email partial match (ilike) |
| `status` | `active`, `unsubscribed`, etc. |

---

### `GET /api/hermes/{workspace}/subscribers/{id}`

Fetch a single subscriber profile.

---

### `GET /api/hermes/{workspace}/subscribers/{id}/history`

Returns the subscriber's full send history + engagement events:

```json
{
  "sent": [
    {
      "campaign_id": "uuid",
      "sent_at": "2025-03-01T09:00:00Z",
      "campaigns": { "name": "March Newsletter", "subject_line": "..." }
    }
  ],
  "events": [
    { "event_type": "open", "occurred_at": "2025-03-01T09:15:00Z", "metadata": {} },
    { "event_type": "click", "occurred_at": "2025-03-01T09:16:00Z", "metadata": {} }
  ]
}
```

---

### `POST /api/hermes/{workspace}/subscribers`

Upsert a subscriber and evaluate tag triggers. Routes through the webhook proxy to ensure trigger logic, tag colors, and identity stitching run correctly.

```json
{
  "email": "jane@example.com",
  "first_name": "Jane",
  "last_name": "Doe",
  "tags": ["newsletter", "vip"],
  "city": "New York",
  "country": "US"
}
```

---

### `POST /api/hermes/{workspace}/subscribers/bulk-tag`

Add tags to multiple subscribers at once. Runs through the webhook proxy for each one.

```json
{
  "emails": ["a@example.com", "b@example.com"],
  "tags": ["purchased", "vip"]
}
```

Returns:
```json
{
  "succeeded": 2,
  "total": 2,
  "results": [
    { "email": "a@example.com", "success": true },
    { "email": "b@example.com", "success": true }
  ]
}
```

---

### `PATCH /api/hermes/{workspace}/subscribers/{id}`

Update profile fields (name, city, country, etc.). **Tags cannot be set via PATCH** — always use `POST /subscribers` or `bulk-tag` for tag mutations, so trigger evaluation runs.

```json
{
  "first_name": "Janet",
  "city": "Los Angeles"
}
```

---

## Tags

### `GET /api/hermes/{workspace}/tags`

List all tag definitions for the workspace.

### `POST /api/hermes/{workspace}/tags`

Create a new tag definition:

```json
{
  "name": "vip",
  "color": "#FFD700",
  "description": "High-value customers"
}
```

### `DELETE /api/hermes/{workspace}/tags/{tag_id}`

Delete a tag definition **and** remove it from every subscriber's `tags` array in this workspace.

Returns:
```json
{ "success": true, "removedFrom": 42 }
```

---

## Merge Tags

### `GET /api/hermes/{workspace}/merge-tags`

Returns all global merge tag definitions (e.g. `{{first_name}}`, `{{unsubscribe_url}}`). These are system-wide — no workspace filter.

---

## Triggers

### `GET /api/hermes/{workspace}/triggers`

List all automation triggers for the workspace.

### `POST /api/hermes/{workspace}/triggers`

Create a new trigger:

```json
{
  "tag_name": "purchased",
  "chain_id": "uuid-of-chain",
  "active": true
}
```

---

## Copilot (AI Email Generation)

### `POST /api/hermes/{workspace}/copilot`

Ask the LLM copilot to generate or edit email HTML. The copilot **automatically loads this workspace's brand context and default links** from the Settings page and injects them into its system prompt — so it knows who the audience is, what tone to use, and what URLs to use for CTAs.

```json
{
  "messages": [
    { "role": "user", "content": "Write a concert announcement email for our spring piano recital" }
  ],
  "currentHtml": "<html>...</html>",
  "model": "auto"
}
```

Returns: `{ "content": "<html>...</html>", "usage": { ... } }`

### Workspace → Copilot context mapping

The workspace in the URL determines which context is loaded:

| Workspace slug | Copilot context loaded |
|---|---|
| `dreamplay_marketing` | DreamPlay brand context + DreamPlay links |
| `dreamplay_support` | DreamPlay brand context + DreamPlay links |
| `musicalbasics` | MusicalBasics brand context + MusicalBasics links |
| `crossover` | Both MusicalBasics AND DreamPlay contexts combined |
| `concert_marketing` | Concert Marketing context + Concert Marketing links |

### Configuring context for a workspace

Context is set by a human in the Settings page at `/{workspace}/settings`. It's stored in the `app_settings` table under the key `context_{workspace}`. Default links are stored under `links_{workspace}`.

If no context has been saved for a workspace yet, the copilot will generate emails without any brand-specific guidance — so **always set the context before running your first campaign in a new workspace.**

### Copilot model tiers

Pass `"model": "auto"` to let the system use the configured default. You can also pass a specific model ID:

```json
{ "model": "claude-opus-4-6" }        // High compute
{ "model": "claude-sonnet-4-6" }      // Medium compute  
{ "model": "claude-haiku-4-5-20251001" } // Low compute / fast drafts
```

---

## Error Responses

| Status | Meaning |
|---|---|
| `400` | Bad request — missing required field |
| `401` | Unauthorized — bad or missing API key |
| `404` | Resource not found |
| `207` | Multi-status — partial success (chain + steps creation) |
| `500` | Internal server error — check error message |

All errors return: `{ "error": "description" }`

---

## Typical Agent Workflow

### Standard send workflow

1. **Research audience** — `GET /subscribers?tag=newsletter` to see who's subscribed
2. **Read templates** — `GET /campaigns?is_template=true` to find reusable HTML
3. **Draft a campaign** — `POST /campaigns` with subject + HTML content
4. **Preview analytics** — `GET /campaigns/{id}/analytics` for any past campaign context
5. **Send it** — `POST /campaigns/{id}/send` (or with `scheduledAt` for scheduled delivery)
6. **Tag responders** — `POST /subscribers/bulk-tag` based on engagement

### New workspace / first-time workflow

> Use this when working in a workspace that has no prior campaigns (e.g. `concert_marketing` on first use).

1. **Verify context is set** — check `/{workspace}/settings` in the UI. If blank, the AI will draft without brand guidance. Set it before proceeding.
2. **Generate HTML via copilot** — `POST /copilot` with a clear brief including event name, date, venue, ticket link, and tone.
3. **Create a master template** — `POST /campaigns` with `is_template: true`. This is the reusable design.
4. **Create a child send** — `POST /campaigns` with `parent_template_id` pointing to the template, then target your audience via `variable_values.subscriber_ids`.
5. **Send** — `POST /campaigns/{child_id}/send`.

---

## Campaign Classification: Master Templates vs Child Campaigns

> This is the most important concept for any agent that reads or creates campaigns.

All campaigns live in a **single `campaigns` table**. Their role is determined by two fields:

### Field reference

| Field | Master Template | Child Campaign |
|---|---|---|
| `is_template` | `true` | `false` |
| `is_ready` | `true` (when ready to use) | not meaningful |
| `parent_template_id` | `null` | UUID pointing to the master template |
| `status` | always `draft` (never sent) | `draft` → `completed` after send |
| `variable_values.subscriber_id` | not set | locked to a specific subscriber (1:1 sends) |
| `variable_values.subscriber_ids` | not set | array of subscriber UUIDs (bulk sends) |
| `total_opens`, `total_clicks` | always 0 | real analytics, populated after send |

### Mental model

```
Master Template (is_template=true, status=draft, parent_template_id=null)
    │
    ├── Child Campaign #1 (is_template=false, status=completed, parent_template_id=<template_id>)
    │       → sent to john@example.com on 2026-03-01
    │
    ├── Child Campaign #2 (is_template=false, status=completed, parent_template_id=<template_id>)
    │       → sent to jane@example.com on 2026-03-15
    │
    └── Child Campaign #3 (is_template=false, status=draft, parent_template_id=<template_id>)
            → drafted but not yet sent
```

**The master template is never sent directly and is never marked `completed`.** Only children get sent and accumulate analytics.

### How children are created

| Trigger | Creates | Name format |
|---|---|---|
| Send to one subscriber | 1 child, `subscriber_id` locked | `"Template Name (for email@example.com)"` |
| Bulk send to multiple | 1 child, `subscriber_ids` array | `"Template Name — Bulk Send Apr 10, 2026 (47 recipients)"` |
| Duplicate button | 1 draft child, no subscriber lock | `"Copy of Template Name"` |

### Recommended queries for agents

```http
# Get all master templates (the reusable designs)
GET /api/hermes/{workspace}/campaigns?is_template=true

# Get all completed (sent) campaigns with analytics
GET /api/hermes/{workspace}/campaigns?status=completed

# Get all draft campaigns (not yet sent)
GET /api/hermes/{workspace}/campaigns?status=draft

# Get all children of a specific master template (direct server-side filter)
GET /api/hermes/{workspace}/campaigns?parent_template_id=<template_uuid>
```

### Key rules for agents when drafting new campaigns

1. **Always start from a master template** — fetch `GET /campaigns?is_template=true`, pick the right template, copy its `html_content` and `variable_values` (minus `subscriber_id`), and `POST /campaigns` as a new draft. Set `parent_template_id` to the template's ID in your POST body.

2. **Do not edit a master template's `html_content`** via PATCH unless you intend to update the design for all future sends. Edit child campaigns instead.

3. **Read analytics only from children** — a template's `total_opens` / `total_clicks` will always be 0. To understand campaign performance, query completed child campaigns (those with `status=completed` and the relevant `parent_template_id`).

4. **To understand what was sent to a subscriber** — call `GET /subscribers/{id}/history` which returns all their sent history entries linked to campaign names and subject lines.

---

## Multi-Workspace Audience Model

> As of 2026-04-10, the platform supports the same email address in multiple workspaces as independent subscriber rows.

### Key facts for agents

- **Campaigns are always workspace-scoped.** A campaign in `musicalbasics` only sends to subscribers in `musicalbasics`.
- **A person can exist in multiple workspaces.** The same `email` can have a row in `musicalbasics` AND `dreamplay_marketing` — these are completely independent records with separate status, tags, and send history.
- **Unsubscribes are workspace-scoped.** If `jane@example.com` unsubscribes from a Musical Basics email, her `musicalbasics` row is marked `unsubscribed`. Her `dreamplay_marketing` row is unaffected.
- **When querying subscribers**, always use the correct workspace slug in the URL — the API automatically scopes to that workspace only.

### Workspace slugs

| Slug | Audience |
|---|---|
| `dreamplay_marketing` | DreamPlay promotional / announcement audience |
| `dreamplay_support` | DreamPlay purchasers / customer support audience |
| `musicalbasics` | Musical Basics general educational audience |
| `crossover` | Intentionally overlapping cross-brand segments |
| `concert_marketing` | Concert announcements, ticket promotions, event-driven campaigns |

### Practical implication

If you want to email the same person about both Musical Basics content AND DreamPlay products, they need a subscriber row in each relevant workspace. To check which workspaces a person is in, search their email across multiple workspace endpoints:

```http
GET /api/hermes/musicalbasics/subscribers?search=jane@example.com
GET /api/hermes/dreamplay_marketing/subscribers?search=jane@example.com
GET /api/hermes/concert_marketing/subscribers?search=jane@example.com
```

---

## Concert Marketing: Quick-Start Reference

> Use this section when your agent is creating its first Concert Marketing email.

### Pre-flight checklist

- [ ] **Context set** — go to `/concert_marketing/settings` and fill in the Concert Marketing Context textarea with brand voice, event type, and audience description
- [ ] **Links configured** — set at least `homepage_url` and `main_cta_url` (ticket purchase page) under Concert Marketing Links in Settings
- [ ] **Subscribers imported** — use `/concert_marketing/audience` → Import CSV to add your concert audience

### Recommended copilot brief structure

When asking the copilot to write a concert email, give it:

```
Event name: [Name of concert/recital]
Date & time: [e.g. Saturday, May 10 at 7:00 PM]
Venue: [Name and city]
Ticket link: [URL]
Artist/performer: [Name(s)]
Tone: [e.g. exciting and warm / elegant and formal]
Audience: [e.g. past students and their families]
Key message: [e.g. limited seats available, early bird pricing ends Friday]
```

### Typical concert campaign API call sequence

```http
# 1. Generate HTML
POST /api/hermes/concert_marketing/copilot
{ "messages": [{ "role": "user", "content": "Write a concert announcement for..." }], "model": "auto" }

# 2. Save as master template
POST /api/hermes/concert_marketing/campaigns
{ "name": "Spring Recital 2026 — Template", "subject_line": "...", "html_content": "...", "is_template": true }

# 3. Create a child campaign for the actual send
POST /api/hermes/concert_marketing/campaigns
{ "name": "Spring Recital 2026 — Send", "subject_line": "...", "html_content": "...", "parent_template_id": "<template_id>", "variable_values": { "subscriber_ids": ["..."] } }

# 4. Send it
POST /api/hermes/concert_marketing/campaigns/{child_id}/send
```
