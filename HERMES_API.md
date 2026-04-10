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
| `status` | `draft`, `sending`, `completed` | Filter by send status |
| `is_template` | `true` | Return master templates only |
| `email_type` | `campaign`, `automated`, `chain_step` | Filter by email type |

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

Ask the LLM copilot to generate or edit email HTML.

```json
{
  "messages": [
    { "role": "user", "content": "Write a promotional email for our spring sale" }
  ],
  "currentHtml": "<html>...</html>",
  "model": "auto"
}
```

Returns the copilot's response (same shape as `/api/copilot`).

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

1. **Research audience** — `GET /subscribers?tag=newsletter` to see who's subscribed
2. **Read templates** — `GET /campaigns?is_template=true` to find reusable HTML
3. **Draft a campaign** — `POST /campaigns` with subject + HTML content
4. **Preview analytics** — `GET /campaigns/{id}/analytics` for any past campaign context
5. **Send it** — `POST /campaigns/{id}/send` (or with `scheduledAt` for scheduled delivery)
6. **Tag responders** — `POST /subscribers/bulk-tag` based on engagement
