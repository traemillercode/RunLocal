# Run Local — Identity Verification & Safety Layer

## Account state model
- **Guest** — browse-only. No RSVP, post, comment, or submit.
- **Pending Verification** — after signup completion; read-only. Stages:
  `phone → code → selfie → pending_review` (resumable via `/api/me`).
- **Verified** — admin-approved. Only a simple **Verified badge** is ever
  shown publicly. Phone, selfie, IPs, timestamps, and retention metadata are
  never in public payloads.

## Verification flow (mobile-first)
1. Profile basics (name, email, optional public profile photo — file input OK here).
2. Phone entry (`type="tel"`, `inputMode="numeric"`) → server sends 6-digit code
   (stored as HMAC + salt, 10-min expiry, 5 attempts, 5 sends/hour/number).
3. Auto-advancing numeric digit boxes (`inputMode="numeric"`).
4. **Explicit consent screen** — live capture, comparison to profile photo,
   no public display/discovery, retention period (from `/api/health`), internal
   safety / law-enforcement access only. Camera opens ONLY after "I agree".
5. **Live selfie via getUserMedia only** (no file/gallery input), downscaled
   JPEG, permission/denied states, tracks stopped on exit.
6. Submit → server stores selfie in `uploads/private` (never served
   statically; audited admin endpoint only) → status `pending_review`.
   **No liveness/match is faked**: review is manual until a provider is wired.

## Required env vars (server, never in the client)
| Var | Purpose | Required? |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account | for real SMS |
| `TWILIO_AUTH_TOKEN` | Twilio auth token (secret) | for real SMS |
| `TWILIO_PHONE_NUMBER` | From number (E.164) | for real SMS |
| `RUN_LOCAL_SMS_MODE` | `twilio` (default) \| `log` (DEV ONLY) | no |
| `RUN_LOCAL_ADMIN_KEY` | unlocks the admin safety tool | for admin UI |
| `RUN_LOCAL_ADMIN_EMAIL` | admin identity in audit log | no (default admin@runlocal.app) |
| `RUN_LOCAL_DATA_DIR` | data + uploads dir | no (default ./data) |
| `RUN_LOCAL_RETENTION_YEARS` | retention window | no (default 3) |

**Missing-config behavior (explicit, never fake):** without the three Twilio
vars the API returns `503 sms_unconfigured` and the UI shows a clear
"SMS provider not configured — no code was sent" state. Without
`RUN_LOCAL_ADMIN_KEY` the admin tool shows a "not configured" state.
`RUN_LOCAL_SMS_MODE=log` prints the code to the server console for local
development only — it is real server-side code verification, never claimed as SMS.

## Admin safety tool (`#/admin`, not linked anywhere)
- Login with `RUN_LOCAL_ADMIN_KEY` → HttpOnly admin session.
- Search by **username/email only** (no phone-based discovery).
- Every lookup/export/approve/reject/delete/purge requires a **reason** and is
  **audited** (admin, timestamp, reason, action, IP).
- Full record (phone, signup IP, 90-day login IPs, retention metadata, selfie)
  is admin-only; selfie streams through an audited endpoint.
- Export CSV (audited). Verified runners / group leaders have no access — the
  API rejects any non-admin session.

## Retention ("never keep data indefinitely")
- Default **3 years** from last activity (`RUN_LOCAL_RETENTION_YEARS`).
- Account deletion scrubs phone/selfie/photo/IPs **immediately** (tombstone kept
  for audit linkage, then purged).
- Purge removes phone + selfie + photo + IP history and drops the record.
- Runs on server boot, daily in-process, via admin "Run purge", or on demand:
  `bun run retention:purge [--dry-run]` (suggested cron: `0 3 * * *`).

## Deployment notes
- `serve.ts` serves the SPA **and** `/api/*` on one origin (port 3000).
- Data persists under `RUN_LOCAL_DATA_DIR` (JSON + uploads). Swap for a real DB
  in production; the store API is a thin seam.
- Never log raw phone numbers, codes, selfie refs, or IPs (code logs masked
  values only).
- Rate limits (phone sends, code attempts, admin login) are in-memory —
  move to a shared store when scaling horizontally.
