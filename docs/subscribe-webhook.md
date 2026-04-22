# Subscribe Webhook — Integration Reference

> **Public endpoint** for adding subscribers to any workspace from external landing pages, bots, or forms.

---

## Endpoint

```
POST https://email.dreamplaypianos.com/api/webhooks/subscribe
```

- No authentication required
- `Content-Type: application/json`
- CORS-enabled for approved origins (see below)

---

## Payload Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | `string` | ✅ | Subscriber email address |
| `first_name` | `string` | — | First name |
| `last_name` | `string` | — | Last name |
| `tags` | `string[]` | — | Tags to apply. Merged with existing tags (never overwritten). Defaults to `["Website Import"]` if omitted. |
| `workspace` | `string` | — | Workspace slug (see table below). Defaults to `dreamplay_marketing`. |
| `city` | `string` | — | City (for geo data) |
| `country` | `string` | — | Country code e.g. `"BE"` |
| `ip_address` | `string` | — | IP address for geo/compliance logging |
| `gdpr_consent` | `boolean` | — | `true` = explicit consent given. Stored as `gdpr_consent` + `consent_timestamp` in DB. Required for EU subscribers. |
| `temp_session_id` | `string` | — | Anonymous session ID for identity stitching (pre-subscribe tracking) |

---

## Workspace Slugs

| Slug | Audience |
|---|---|
| `dreamplay_marketing` | DreamPlay main marketing list |
| `musicalbasics` | Musical Basics list |
| `dreamplay_support` | DreamPlay purchasers / support |
| `crossover` | Cross-brand segment |
| `concert_marketing` | Concert announcements & ticket promotions |

---

## Allowed CORS Origins

Only these origins can make browser-side requests to this endpoint:

```
https://dreamplaypianos.com
https://www.dreamplaypianos.com
https://belgium-concert-landing-page.vercel.app
```

> To add a new origin, edit `allowedOrigins` in `app/api/webhooks/subscribe/route.ts`.

---

## Examples

### Belgium Concert Landing Page

```json
POST https://email.dreamplaypianos.com/api/webhooks/subscribe

{
  "email": "user@example.com",
  "first_name": "Jane",
  "tags": ["belgium-concert-2026"],
  "workspace": "concert_marketing",
  "gdpr_consent": true
}
```

### DreamPlay Preorder Form

```json
{
  "email": "user@example.com",
  "first_name": "Jane",
  "tags": ["dreamplay-preorder"],
  "workspace": "dreamplay_marketing"
}
```

### Musical Basics Signup

```json
{
  "email": "user@example.com",
  "tags": ["newsletter"],
  "workspace": "musicalbasics"
}
```

---

## Behaviour Notes

- **Tags are merged**, never replaced. If a subscriber already has `["newsletter"]` and you submit `["vip"]`, they end up with `["newsletter", "vip"]`.
- **Triggers only fire on new tags.** Re-submitting the same tag does not re-fire automation.
- **Unsubscribes are respected.** If a subscriber has unsubscribed, their status is NOT reset to `active` on re-submit.
- **Tag definitions are auto-created.** You don't need to pre-create tags in the UI — the webhook creates them automatically on first use.
- **Workspaces are independent.** The same email can exist in `concert_marketing` AND `dreamplay_marketing` as separate rows with separate tags, status, and send history.

---

## GDPR / Consent

For EU subscribers (`country: "BE"` etc.), always pass `gdpr_consent: true` when the user checks an explicit consent checkbox on your form.

This writes two fields to the `subscribers` table (run this SQL migration if not done yet):

```sql
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS gdpr_consent BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS consent_timestamp TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_subscribers_gdpr_consent
  ON subscribers (workspace, gdpr_consent)
  WHERE gdpr_consent IS NOT NULL;
```

---

## Response

```json
{ "success": true, "id": "<subscriber-uuid>" }
```

Errors return `{ "error": "description" }` with the appropriate HTTP status code.
