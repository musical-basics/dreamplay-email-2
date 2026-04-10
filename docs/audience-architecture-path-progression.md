# Audience Architecture: Migration Path Progression

## Context

The email platform uses a workspace model where campaigns, settings, and analytics
are workspace-scoped. The original assumption was that subscribers also belong to
exactly one workspace. This turned out to be incorrect for the business — a person
can be a Musical Basics subscriber AND a DreamPlay Marketing prospect AND a DreamPlay
Support customer simultaneously.

This document records the two-phase migration plan agreed on 2026-04-10.

---

## Path 1 — Composite Unique Key (Current Implementation)

**Status: In progress**

### What it is
Keep the existing `subscribers` table structure but allow the same email to exist
in multiple workspaces by changing the unique constraint from `UNIQUE(email)` to
`UNIQUE(email, workspace)`.

### Schema change
```sql
-- Drop old single-column unique constraint
ALTER TABLE subscribers DROP CONSTRAINT IF EXISTS subscribers_email_key;

-- Add composite unique constraint
ALTER TABLE subscribers ADD CONSTRAINT subscribers_email_workspace_unique
  UNIQUE (email, workspace);
```

### What this enables
- The same person (`john@example.com`) can have a row in `musicalbasics` AND
  `dreamplay_marketing` AND `dreamplay_support`
- Each row has its own `status` (active / unsubscribed / etc.)
- Unsubscribing from a Musical Basics email only marks the `musicalbasics` row
  as unsubscribed — the person still receives DreamPlay emails
- Campaigns remain workspace-scoped — a DreamPlay campaign only targets
  DreamPlay rows
- The Audience Manager page per workspace shows only that workspace's rows

### Code changes required (alongside schema)
These files do lookups by `email` alone and need a `workspace` filter added:

| File | Change needed |
|---|---|
| `app/api/webhooks/subscribe/route.ts` | Upsert/lookup must include workspace |
| `app/api/webhooks/shopify-order/route.ts` | Lookup must include workspace |
| `app/api/webhooks/resend/route.ts` | Bounce/unsubscribe must scope to workspace |
| `app/api/update-subscriber/route.ts` | Update must scope to workspace |
| `lib/merge-tags.ts` | Subscriber lookup by email must scope to workspace |

### Trade-offs accepted
- ✅ Person appears in multiple workspaces independently
- ✅ Workspace-scoped unsubscribes
- ✅ Works with existing Audience page, filtering, and analytics
- ✅ Low risk — minimal code surface area
- ⚠️ Profile changes (name, phone, address) are per-row — not automatically
  synced across workspaces. In practice this is a minor issue since most profile
  data comes from signup forms that are workspace-specific anyway.
- ⚠️ Global suppression (e.g., legal "never contact again") must be applied
  manually across all workspace rows for that email.

---

## Path 2 — Global Identity + Workspace Memberships (Future)

**Status: Planned, not started**

### What it is
A full schema migration to a proper two-table identity model:

```
contacts table           workspace_memberships table
─────────────────        ────────────────────────────────────────
id (UUID, PK)   ←───┐   id (UUID, PK)
email (UNIQUE)      │   contact_id (FK → contacts.id)
first_name          │   workspace (TEXT)
last_name           │   status (active / unsubscribed / bounced)
phone               │   tags (TEXT[])
shipping_*          │   created_at
created_at          └── updated_at
```

### What this enables (beyond Path 1)
- True global identity — editing a person's name updates it everywhere
- Workspace membership is explicit and queryable (e.g., "show me all people
  who are active in MusicalBasics but inactive in DreamPlay Marketing")
- Global suppression list manageable in one place
- Cleaner analytics across workspaces for the same person

### Why we're not doing this yet
- Requires rewriting 30+ files that query the `subscribers` table
- Risk of regressions across send pipeline, merge tags, webhooks, Hermes API
- Estimated 2–3 weeks of careful migration work
- Path 1 delivers 90% of the business value at ~10% of the cost

### When to revisit Path 2
Consider migrating to Path 2 when:
- You have 5+ active workspaces regularly sending campaigns
- You need cross-workspace analytics ("how many people are in both DreamPlay
  and MusicalBasics?")
- Profile sync inconsistencies from Path 1 become a real operational problem
- You want a unified preference center where a person can manage all their
  workspace subscriptions in one place

---

## Operational rules (applicable under both paths)

- **Campaigns are always workspace-scoped.** A campaign created in MusicalBasics
  only sends to MusicalBasics rows.
- **Unsubscribes are workspace-scoped.** Opting out of DreamPlay Marketing
  emails does not remove Musical Basics access.
- **Workspace membership is explicit.** Adding someone to a workspace requires
  an intentional action (CSV import, signup form, bulk tag, SQL insert).
- **DreamPlay purchasers** should be in `dreamplay_support` with their
  `dreamplay_marketing` row set to inactive (or removed) if the goal is to
  prevent them from receiving broad marketing emails.
