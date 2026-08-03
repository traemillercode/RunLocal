# Run Local verification

Email is the verification gate. Signup creates a **Pending Verification** read-only account; RSVP, comments, posts, and submissions remain unavailable until email verification and selfie review succeed. Phone is collected only as an unverified profile field (`phone_verified: false`) for a future SMS upgrade.

## Flow and privacy
1. Signup requires name, email, optional phone, and birthdate; the server rejects users under `RUN_LOCAL_MIN_AGE` (default 16).
2. A six-digit numeric code is sent to the signup email by Resend. Code boxes auto-advance and use `inputmode=numeric`.
3. A mandatory consent screen appears before `getUserMedia`; no gallery/file picker is used for selfies. Consent states live capture, comparison/review, no public display/discovery, admin-only access, and retention.
4. Selfie submissions are explicitly `pending_review`; no liveness or biometric match is claimed without a real provider.

## Server env vars
- `RESEND_API_KEY` — Resend API key (server-only).
- `RUN_LOCAL_EMAIL_FROM` — verified sender, e.g. `Run Local <verify@example.com>` (server-only).
- `RUN_LOCAL_MIN_AGE` — minimum age, default `16`.
- `RUN_LOCAL_RETENTION_YEARS` — default `3` years after deletion/inactivity.
- `RUN_LOCAL_ADMIN_KEY`, `RUN_LOCAL_ADMIN_EMAIL` — admin safety tool.

If email vars are missing, `/api/verify/start` returns `503 email_unconfigured`; no code is stored as deliverable and UI states that no email was sent. Provider errors return explicit error states. Twilio/SMS credentials are not required or used.

Sensitive verification records (email, timestamps, selfie reference, unverified phone, signup IP, rolling 90-day login IP history, birthdate) remain server-only and are absent from public payloads. Admin search/view/CSV export/selfie access requires a reason and is audited; non-admins are rejected. Selfies and phone/verification records are purged by the existing retention job after the configured window.
