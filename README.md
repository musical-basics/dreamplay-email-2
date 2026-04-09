# DreamPlay Email Engine (v2)

The Musical Basics email marketing platform. Multi-tenant, multi-workspace email engine built on Next.js 16, Supabase, Resend, and Inngest.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Database | Supabase (Postgres + Storage) |
| Email Delivery | Resend |
| Background Jobs | Inngest |
| AI Copilot | Google Gemini + Anthropic Claude |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Runtime | Node.js (Vercel) |

---

## Workspaces

The app is multi-tenant. Each workspace has its own isolated subscribers, campaigns, and settings:

| Workspace | Slug | Description |
|---|---|---|
| DreamPlay Marketing | `dreamplay_marketing` | Core DreamPlay Pianos campaigns |
| DreamPlay Support | `dreamplay_support` | Customer support follow-ups |
| MusicalBasics | `musicalbasics` | Educational newsletters |
| Crossover | `crossover` | Cross-brand campaigns |

Navigate to `/{workspace}` to enter a workspace dashboard.

---

## Project Structure

```
dreamplay-email-2/
├── app/
│   ├── [workspace]/
│   │   └── (dashboard)/
│   │       ├── campaigns/          # Campaign list + launch
│   │       ├── audience/           # Subscriber management
│   │       ├── analytics/          # Performance reporting
│   │       ├── chains/             # Email sequence builder
│   │       ├── chain/[id]/         # Individual chain editor
│   │       ├── chain-rotations/    # A/B test journeys
│   │       ├── rotations/          # Round-robin campaign splits
│   │       ├── rotation-send/      # Rotation send console
│   │       ├── journeys/           # Journey overview
│   │       ├── automated-emails/   # Automation manager
│   │       ├── migrate/            # Mailchimp importer
│   │       ├── assets/             # Media asset library
│   │       ├── merge-tags/         # Merge tag manager
│   │       ├── tags/               # Tag definitions
│   │       ├── discounts/          # Discount preset manager
│   │       ├── triggers/           # Automation triggers
│   │       ├── logs/               # Event logs
│   │       ├── crm/                # CRM integration
│   │       └── settings/           # Workspace settings
│   ├── actions/                    # Server actions (all DB ops)
│   ├── api/                        # API routes (webhooks, send, track)
│   ├── editor/                     # Email editor (v1)
│   ├── editor-v2/                  # Email editor (v2)
│   └── unsubscribe/                # Public unsubscribe page
├── components/                     # React UI components
│   ├── ui/                         # shadcn/ui primitives
│   ├── editor/                     # Editor-specific components
│   ├── campaign/                   # Campaign launchpad components
│   ├── campaigns/                  # Campaign list/modal components
│   ├── audience/                   # Audience + subscriber components
│   ├── chain/                      # Chain step/launch components
│   ├── chains/                     # Journey tab components
│   ├── rotation/                   # Rotation launch components
│   ├── dashboard/                  # Tournament-style dashboard
│   └── crm/                        # CRM config panel
├── lib/
│   ├── supabase/                   # Supabase client/server/middleware
│   ├── ai/                         # AI email generator (Gemini + Claude)
│   ├── chains/                     # Chain sender logic
│   ├── parsers/                    # Mailchimp HTML parser
│   ├── dnd-blocks/                 # Block compiler/types
│   ├── types.ts                    # Core TypeScript types
│   ├── merge-tags.ts               # Mustache merge tag system
│   ├── render-template.ts          # Email HTML renderer
│   ├── email-preheader.ts          # Preview text injection
│   ├── workspace.ts                # Workspace config
│   └── utils.ts                    # Shared utilities
├── inngest/
│   ├── client.ts                   # Inngest app client
│   └── functions/
│       ├── send-campaign.ts        # Core broadcast function
│       ├── scheduled-send.ts       # Scheduled campaign sends
│       ├── scheduled-rotation-send.ts  # Rotation auto-sends
│       ├── audience-enrichment.ts  # AI subscriber enrichment
│       └── chains/
│           ├── generic.ts          # Generic chain step runner
│           └── behavioral.ts       # Behavioral trigger handler
├── hooks/                          # React hooks
├── middleware.ts                   # Supabase auth session middleware
├── supabase/
│   └── schema.sql                  # Canonical database schema (all tables)
└── public/                         # Static assets
```

---

## Database Schema

The full canonical schema lives in **`supabase/schema.sql`**. Run it in the Supabase SQL editor on a fresh project to initialize all tables, indexes, and RLS policies.

### Tables (in dependency order)

| Table | Purpose |
|---|---|
| `tag_definitions` | Tag metadata (name, color) |
| `subscribers` | Core subscriber records, status, geo data, tags |
| `subscriber_events` | Open/click/bounce/complaint tracking |
| `app_settings` | Per-workspace key-value settings (JSONB) |
| `template_folders` | Folder organization for master templates |
| `rotations` | Round-robin campaign split test config |
| `campaigns` | Email campaigns + master templates |
| `campaign_versions` | HTML snapshot history per campaign |
| `media_assets` | Content-addressable image library |
| `discount_presets` | Shopify discount code configurations |
| `email_chains` | Automated journey/sequence definitions |
| `chain_processes` | Per-subscriber journey state machine |
| `chain_rotations` | A/B testing between full journeys |
| `trigger_logs` | Automation trigger event history |

### Storage Buckets

Create these in the Supabase Dashboard (Storage → New Bucket):

| Bucket | Visibility |
|---|---|
| `email-assets` | Public |
| `sent-emails` | Private |

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (server-side only) |
| `RESEND_API_KEY` | Resend email delivery API key |
| `RESEND_WEBHOOK_SECRET` | Resend webhook signing secret |
| `GEMINI_API_KEY` | Google Gemini API key (AI copilot) |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key (AI copilot) |
| `SHOPIFY_STORE_DOMAIN` | Shopify store domain |
| `SHOPIFY_CLIENT_ID` | Shopify app client ID |
| `SHOPIFY_CLIENT_SECRET` | Shopify app client secret |
| `SHOPIFY_WEBHOOK_SECRET` | Shopify webhook HMAC secret |
| `INNGEST_EVENT_KEY` | Inngest event key (background jobs) |
| `INTERNAL_API_SECRET` | Internal API auth secret |

---

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Set up Supabase

1. Create a new Supabase project
2. Run `supabase/schema.sql` in the SQL editor
3. Create storage buckets: `email-assets` (public) and `sent-emails` (private)
4. Copy the project URL, anon key, and service role key into `.env.local`

### 3. Configure environment

```bash
cp .env.example .env.local
# Fill in all values
```

### 4. Run locally

```bash
pnpm dev
# App runs on http://localhost:3001 (fallback: 4001)
```

### 5. Run Inngest (background jobs)

In a separate terminal:

```bash
npx inngest-cli@latest dev
```

---

## Key Patterns

### Server Actions (all DB ops go through `app/actions/`)

All Supabase database operations use server-side service role key via server actions. Never use the anon key for writes.

```ts
// app/actions/campaigns.ts
"use server"
import { createClient } from "@/lib/supabase/server"
```

### Merge Tags

Campaigns use Mustache-style `{{variable}}` syntax. Variables are resolved at render time from:
- `variable_values` (campaign-level overrides)
- Subscriber fields (first_name, last_name, etc.)
- Smart tags (AI-enriched)

### Workspace Isolation

Every subscriber, campaign, chain, and setting is scoped to a `workspace` column. All queries filter by the workspace slug derived from the URL path `[workspace]`.

---

## Deployment

Deploy on Vercel. Set all environment variables in the Vercel project settings.

The app is configured for:
- `bodySizeLimit: '50mb'` (server actions — for email migration uploads)
- `images.unoptimized: true` (Vercel image optimization disabled)
- TypeScript build errors suppressed (`ignoreBuildErrors: true`)
