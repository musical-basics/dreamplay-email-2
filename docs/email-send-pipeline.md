# Email Send Pipeline Architecture

> Last updated: April 2026

## Overview

All email sending flows through a single canonical engine: **`/api/send-stream`**.
Every other endpoint is either a thin coordinator (routing, scheduling) or a
dedicated utility (test/preview sends).

---

## Route Responsibilities

| Route | Purpose | Response |
|---|---|---|
| **`/api/send-stream`** | Canonical send engine + schedule coordinator | Streaming NDJSON (broadcast) or JSON (schedule/cancel) |
| **`/api/send-rotation`** | Rotation round-robin assignment only — delegates sends to `send-stream` | JSON |
| **`/api/test-send`** | Preview sends to a specific address with simulated subscriber data | JSON |

### `/api/send-stream` — The Single Source of Truth

Handles three `type` values:

| `type` | What it does |
|---|---|
| *(omitted / broadcast)* | Full streaming broadcast: image proxy → video overlay → CSS inline → merge tags → tracking → Resend → history |
| `"schedule"` | Saves `scheduled_at` to campaign + fires Inngest `campaign.scheduled-send` event |
| `"cancel_schedule"` | Clears `scheduled_at`, sets `scheduled_status: "cancelled"` |

**Features applied on every broadcast send:**
1. `proxyEmailImages` — snapshots external images → permanent Supabase CDN URLs
2. `addPlayButtonsToVideoThumbnails` — overlays play buttons on video-linked thumbnails
3. `inlineStyles` — inlines CSS class styles (Gmail strips `<style>` blocks)
4. `applyAllMergeTags` — subscriber fields, global links, dynamic variables
5. Click tracking (redirect or inline `sid/cid` params)
6. Open tracking (1×1 invisible pixel)
7. Resend delivery (custom `List-Unsubscribe` headers)
8. `sent_history` insert + campaign `status: "completed"` update

---

## Full Call Graph

```
┌─────────────────────────────────────────────────────────────┐
│                    UI / Callers                             │
│                                                             │
│  campaign-launch-checks.tsx                                 │
│    ├── "Send Campaign" button ──────────────────────────┐   │
│    ├── "Schedule" button ───────────────────────────────┤   │
│    └── "Cancel Schedule" button ───────────────────────┐│   │
│  audience/page.tsx                                     ││   │
│    └── "Cancel Schedule" (subscriber row) ─────────────┘│   │
│                                                          │   │
│  rotation-launch.tsx                                     │   │
│    └── "Send All" button ──────── /api/send-rotation ───┤   │
│                                                          │   │
│  Inngest: scheduled-send.ts ───────────────────────────┐│   │
│  Inngest: scheduled-rotation-send.ts ──────────────────┤│   │
│    └── fires /api/send-rotation ───────────────────────┘│   │
│                                                          ▼   │
└──────────────────────────────────────────────────────────────┘
                         /api/send-stream
                  ┌──────────────────────────┐
                  │  type: schedule          │
                  │  type: cancel_schedule   │
                  │  type: broadcast         │──► Resend
                  │    proxyEmailImages      │──► sent_history
                  │    videoOverlay          │──► campaign status
                  │    inlineStyles          │
                  │    mergeTags             │
                  │    clickTracking         │
                  │    openTracking          │
                  └──────────────────────────┘
                              ▲
            ┌─────────────────┴─────────────────┐
            │                                   │
     /api/send-rotation                lib/chains/sender.ts
     (round-robin assign,              (creates named child
      creates child campaigns,          campaign, then calls
      calls send-stream per batch)      send-stream per subscriber)
                                               ▲
                                               │
                                  Inngest chain runners:
                                  - generic.ts  (sequential steps)
                                  - behavioral.ts (HITL AI draft)
```

---

## What `/api/test-send` Does Differently

Test sends are **intentionally different** from production sends:

| Behavior | Production (`/api/send-stream`) | Test (`/api/test-send`) |
|---|---|---|
| Recipient | Real active subscribers | Single override email |
| Image proxy | ✅ (snapshots externals) | ❌ (shows original URLs) |
| Video overlay | ✅ | ✅ (matches real experience) |
| CSS inlining | ✅ | ✅ |
| Merge tags | ✅ (real subscriber data) | ✅ (simulated: first active subscriber or locked subscriber) |
| Click tracking | ✅ | ❌ |
| Open pixel | ✅ | ❌ |
| `sent_history` | ✅ | ❌ |
| Campaign status update | ✅ → `"completed"` | ❌ |
| Subject prefix | None | `[TEST]` prepended |
| Unsubscribe link | Real unsubscribe URL | `href="#"` placeholder |

---

## Chain / Journey Sends

Chains (`inngest/functions/chains/generic.ts`, `behavioral.ts`) call
`lib/chains/sender.ts → sendChainEmail()`, which is a thin wrapper that:

1. Fetches the template campaign
2. Creates a **named child campaign**: `"Email Name — Chain: Chain Name (John)"`
3. Calls `/api/send-stream` with `overrideSubscriberIds: [subscriberId]`

Because the child campaign has `is_template: false`, `send-stream` sends
directly to it without creating another child. All image proxying, video
overlays, and tracking happen in `send-stream` as usual.

---

## Adding New Send Features

**Always add to `/api/send-stream`** — it propagates automatically to:
- ✅ Manual campaign broadcasts
- ✅ Scheduled campaigns (via Inngest)
- ✅ Rotation sends (via `/api/send-rotation`)
- ✅ Scheduled rotations (via Inngest → `send-rotation`)
- ✅ Chain/journey step emails (via `lib/chains/sender.ts`)

Only add to `/api/test-send` if the feature meaningfully helps **preview
fidelity** (e.g., video overlay was added because it visually changes the email).
