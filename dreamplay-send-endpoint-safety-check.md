# DreamPlay Email API — Send Endpoint Safety Check

_Last reviewed: 2026-04-10 by Antigravity_

---

## ✅ Short answer: NOT safe to call `/send` blindly — use `subscriber_ids` lock

---

## 1. How recipients are resolved (actual implementation)

**File:** `inngest/functions/send-campaign.ts` — `fetch-recipients` step

```ts
const lockedSubscriberId  = campaign.variable_values?.subscriber_id;
const lockedSubscriberIds = campaign.variable_values?.subscriber_ids;
const targetTag           = campaign.variable_values?.target_tag;

let query = supabase.from("subscribers").select("*").eq("status", "active");

if (lockedSubscriberIds?.length > 0)   query = query.in("id", lockedSubscriberIds);
else if (lockedSubscriberId)           query = query.eq("id", lockedSubscriberId);
else if (targetTag)                    query = query.contains("tags", [targetTag]);
// ⚠️  If NONE of the above are set → sends to ALL active subscribers (no workspace filter)
```

### What happens if no targeting is configured on the campaign?
The query falls through to `query` with only `.eq("status", "active")` —
**it sends to every active subscriber in the database**, across all workspaces.

---

## 2. Safe targeting fields (baked into `variable_values`)

| `variable_values` field | Effect |
|---|---|
| `subscriber_id` (string) | Locks to exactly 1 subscriber |
| `subscriber_ids` (string[]) | Locks to an explicit list of N subscribers |
| `target_tag` (string) | Sends to all subscribers with that tag |
| _(none set)_ | ⚠️ Sends to ALL active subscribers — **DO NOT USE** |

These are stored on the campaign row itself, not passed at send time.

---

## 3. Is it safe to call `/send` on the current draft?

**Only if** the campaign was created with one of the locking fields above already
set in `variable_values`.

To verify your draft campaign before sending, call:

```http
GET /api/hermes/dreamplay_support/campaigns/{id}
Authorization: Bearer <HERMES_API_KEY>
```

Check the `variable_values` field in the response. If you see:
- `"subscriber_id": "..."` → safe, sends to 1 person
- `"subscriber_ids": ["...", "..."]` → safe, sends to that list
- `"target_tag": "Purchased"` → sends to all Purchased subscribers
- _(nothing)_ → **NOT safe**, would blast the full list

---

## 4. Correct workflow for sending to 1–2 specific people

### Step 1: Create a campaign locked to specific subscribers

```http
POST /api/hermes/dreamplay_support/campaigns
Authorization: Bearer <HERMES_API_KEY>
Content-Type: application/json

{
  "name": "Personal email for Daniel",
  "subject_line": "Your DreamPlay update",
  "html_content": "<p>Hi {{first_name}},...</p>",
  "variable_values": {
    "subscriber_ids": ["<uuid-1>", "<uuid-2>"],
    "from_name": "Lionel Yu",
    "from_email": "lionel@email.dreamplaypianos.com"
  }
}
```

OR update an existing draft to add the lock:

```http
PATCH /api/hermes/dreamplay_support/campaigns/{id}
Authorization: Bearer <HERMES_API_KEY>
Content-Type: application/json

{
  "variable_values": {
    "subscriber_ids": ["<uuid-1>", "<uuid-2>"]
  }
}
```

### Step 2: Confirm targeting before send

```http
GET /api/hermes/dreamplay_support/campaigns/{id}
```

Verify `variable_values.subscriber_ids` is set correctly.

### Step 3: Send

```http
POST /api/hermes/dreamplay_support/campaigns/{id}/send
Authorization: Bearer <HERMES_API_KEY>
Content-Type: application/json

{}
```

---

## 5. Additional safety gap: no workspace filter on recipient query

The `fetch-recipients` step in `send-campaign.ts` does **not** filter by workspace.
Even with `target_tag`, it would match any subscriber with that tag in ANY workspace.

This is safe as long as `subscriber_ids` is used (UUID targeting is globally unique),
but risky if `target_tag` is ever set without the workspace filter.

**Recommendation:** Always use `subscriber_ids` for targeted sends from the agent.
Reserve `target_tag` only for intentional bulk sends.

---

## 6. Undocumented / missing fields (from agent report)

These fields from the old docs do **not** exist on the live `campaigns` table:
- `audience_tags` — does not exist; use `variable_values.target_tag` instead
- `from_email` — does not exist as a top-level column; use `variable_values.from_email`
- `preview_text` — does not exist as a top-level column; use `variable_values.preview_text`

All three live inside the `variable_values` JSONB column.
