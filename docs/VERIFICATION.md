# Run Local verification

Email is the verification gate. Signup creates a **Pending Verification** read-only account; RSVP, comments, posts, and submissions remain unavailable until email verification and selfie review succeed. Phone is collected only as an unverified profile field (`phone_verified: false`) for a future SMS upgrade.

Primary account authentication uses **Supabase Auth email + password**. With Confirm email enabled, signup sends a confirmation link; the callback is routed to confirmation, and the user then signs in with the password. This is distinct from the legacy OTP helpers (`signInWithOtp` / `verifyOtp`), which remain only for the separate identity-verification funnel and are not used by the primary signup/login UI. The browser uses only the public anon key. There is no Resend, no Gmail/domain sender, and no service_role key anywhere.

## Flow and privacy
1. Signup requires name, email, optional phone, and birthdate; the server rejects users under `RUN_LOCAL_MIN_AGE` (default 16).
2. Supabase emails a confirmation link for the password signup. The callback is parsed before the hash router claims it, then the runner logs in with the password; the resulting access token is sent to the Run Local server. Legacy OTP code boxes (`signInWithOtp` / `verifyOtp`) are separate and are not part of this password confirmation-link flow.
3. The server **never trusts the client's claim**: it validates the access token against Supabase's `/auth/v1/user` endpoint (public anon key only) and only then links the Supabase user UUID to the Run Local account (`supabaseAuthId`, server-side only). The token's email must equal the account email, and an already-linked account can't be re-homed to a different Supabase identity.
4. **Email verification alone does NOT grant the Verified badge.** It only advances the funnel to the selfie step; the badge comes from manual owner review.
5. A mandatory consent screen appears before `getUserMedia`; no gallery/file picker is used for selfies. Consent states live capture, comparison/review, no public display/discovery, admin-only access, and retention.
6. Selfie submissions are explicitly `pending_review`; no liveness or biometric match is claimed without a real provider.

## Server env vars
- `VITE_SUPABASE_URL` — Supabase project URL, e.g. `https://abcd1234.supabase.co` (browser-safe; embedded in the client bundle by Vite and read by the server).
- `VITE_SUPABASE_ANON_KEY` — Supabase **public anon key** (browser-safe). This is the only key the app ever uses; a `service_role` key is never requested, stored, or shipped to the client.
- `VITE_AUTH_REDIRECT_URL` — optional explicit callback origin/path for Supabase confirmation and recovery links. If omitted, the browser falls back to the current origin (and server-side checks use the production origin fallback). The configured/missing signal reports presence only.
- `RUN_LOCAL_MIN_AGE` — minimum age, default `16`.
- `RUN_LOCAL_RETENTION_YEARS` — default `3` years after deletion/inactivity.
- `RUN_LOCAL_ADMIN_KEY`, `RUN_LOCAL_ADMIN_EMAIL` — admin safety tool.

If the Supabase vars are missing, auth requests fail closed with an explicit unconfigured state and **no email is requested** — delivery is never faked. Provider/network failures return explicit error states. SMS/Twilio is not active or used; phone verification is reserved for a future upgrade.

## Supabase dashboard settings (project setup)
The repository cannot verify or change Dashboard settings. These are operational unknowns until checked in the connected Supabase project:
- **Authentication → Providers → Email** should be enabled.
- **Authentication → Sign In / Up** should allow new users to sign up, with **Confirm email left enabled**. The password signup creates the Supabase auth user; the Run Local profile is created separately by the server.
- **Authentication → URL Configuration** must allow the configured `VITE_AUTH_REDIRECT_URL` (or the production origin fallback) for confirmation and recovery callbacks.
- SMTP sender/domain configuration and delivery are Dashboard/provider concerns; the app exposes only presence/configuration state and never claims delivery from that signal.
- **Authentication → JWT Settings** need no app-side secret: the server validates tokens via `/auth/v1/user` with the public anon key.

Legacy OTP length/template settings are not required for the primary password confirmation-link flow; they apply only if the separate identity-verification OTP funnel is used.

## Known limitation (documented, not faked)
The server validates Supabase access tokens by introspection against the Supabase project (one authenticated call per verify/sign-in, using only the public anon key). If Supabase is unreachable at that moment, verification returns an explicit network error — it never grants access without a validated identity. Local HS256 JWT verification is not used as the trust source, so a custom project JWT secret does not break the flow.

Sensitive verification records (email, timestamps, selfie reference, unverified phone, signup IP, rolling 90-day login IP history, birthdate, Supabase auth UUID) remain server-only and are absent from public payloads. Admin search/view/CSV export/selfie access requires a reason and is audited; non-admins are rejected. Selfies and phone/verification records are purged by the existing retention job after the configured window.
