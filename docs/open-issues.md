# Open Issues — DreamPlay Email Pipeline

_Last updated: 2026-04-12_

---

## Issue 1: Scheduled Send — Images Not Proxied / Optimized

### Symptom
Emails sent via "Send Now" arrive with properly compressed images (~100KB). The
exact same campaign sent via "Schedule Send" arrives with unoptimized originals
(1–2MB+). The scheduled path uses Inngest to sleep until the target time, then
calls `/api/send-stream` via HTTP fetch.

### Root Cause Analysis

The failure is a **nested Vercel timeout cascading into silent image skipping**:

1. **Outer Inngest handler timed out first.**
   `app/api/inngest/route.ts` previously had _no_ `maxDuration` export.
   Vercel enforced its default 15s (Hobby) or 60s (Pro) limit on that route.
   When Inngest's `step.run("send-broadcast")` called `fetch(/api/send-stream)`,
   Vercel killed the Inngest handler mid-stream, severing the HTTP connection.

2. **send-stream was cut off mid-execution.**
   `proxyEmailImages()` never completed (or never ran), so images were returned
   as their original external URLs — unoptimized.

3. **No error surfaced.**
   Inngest silently treated the severed connection as success (no `done: true`
   check was enforced). The campaign was marked "completed" despite skipping
   image optimization entirely.

### Fixes Applied (deployed)

| File | Change |
|------|--------|
| `app/api/inngest/route.ts` | Added `export const maxDuration = 300` — outer Inngest handler now gets same 5-min budget as send-stream |
| `app/api/send-stream/route.ts` | Already had `maxDuration = 300` |
| `inngest/functions/scheduled-send.ts` | Now `throw`s if stream ends without `done: true` — forces Inngest retry instead of silent success |
| `inngest/functions/scheduled-rotation-send.ts` | Same truncation detection |

### Verification Status
⏳ **Pending confirmation.** A scheduled send needs to fire and show a
`scheduled` (purple) entry in `/logs → Send Logs`. If it appears with
`✅ proxied` badge, the fix is confirmed. If _no_ entry appears at all,
Inngest is failing _before_ calling send-stream (different failure mode —
check Inngest dashboard for step errors).

### If Still Failing — Next Steps
- Check Inngest dashboard for the step `send-broadcast` — does it show an error?
- If Inngest reports a timeout on the step itself, the Inngest platform may have
  its own per-step time limit independent of Vercel's `maxDuration`.
- Architectural escalation: move the send loop _into_ Inngest batch steps so
  each batch gets its own independent timeout budget (see Issue 2 below).

---

## Issue 2: Manual "Send Now" Fails for Lists > ~250 Recipients

### Symptom
A 500-person Send Now campaign hits a `429 Too Many Requests` error from Resend
partway through and the send loop is aborted. A 250-person send completes
successfully.

### Root Cause Analysis

Two compounding constraints:

#### A. Vercel 300s Hard Ceiling
`send-stream` has `maxDuration = 300`. The send loop processes one recipient at a
time with a 600ms inter-send delay:

```
500 recipients × ~1,000ms per recipient = ~500 seconds > 300s limit
250 recipients × ~1,000ms per recipient = ~250 seconds ✅ fits
```

Vercel terminates the function at 300s, cutting off any remaining sends.

#### B. Resend API Rate Limiting (429)
At 600ms between sends, throughput is ~1.7 emails/second or ~100/minute.
Resend's rate limits (which vary by plan) can throttle burst sending and
return `429`. The current code logs the error and counts it as a failure
but continues — however if multiple 429s stack it kills throughput entirely.

### Immediate Workaround
Split large lists into two manual sends of ≤250 recipients each. The 250 chunk
size reliably completes within the 300s budget.

### Permanent Fix (architectural)
Move the send loop into **Inngest batch steps** so large sends are not
constrained by a single Vercel function timeout:

```
Inngest scheduled-send
  └─ step: proxy-images           (one-time, ~30s)
  └─ step: send-batch-1 (1–50)    → own 300s budget
  └─ step: send-batch-2 (51–100)  → own 300s budget
  └─ step: send-batch-3 ...       → own 300s budget
  └─ step: finalize               → update campaign status
```

Each Inngest step gets an independent timeout budget. A 500-person send becomes
10 steps of 50 recipients each, all well within the 300s limit.

**Prerequisites before implementing:**
1. Confirm scheduled send image proxy is working (Issue 1 must be resolved first)
2. Inngest batch step architecture will use the same `proxyEmailImages()` call
   in a dedicated step, shared across all send batches

### Related Files
- `app/api/send-stream/route.ts` — single-function send engine (current)
- `inngest/functions/scheduled-send.ts` — Inngest orchestration (needs batching)
- `inngest/functions/scheduled-rotation-send.ts` — same for rotation sends

---

## Tracking

| Issue | Status | Blocker |
|-------|--------|---------|
| Scheduled send image proxy | ⏳ Fix deployed, awaiting confirmation | Need a live scheduled send to fire |
| 500-person manual send limit | 🟡 Workaround: use 2× 250-person sends | Fix requires Issue 1 resolved first |
