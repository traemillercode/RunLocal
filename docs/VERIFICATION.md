# Run Local verification

Email is the verification gate. Signup creates a **Pending Verification** read-only account; RSVP, comments, posts, and submissions remain unavailable until email verification and selfie review succeed. Phone is collected only as an unverified profile field (`phone_verified: false`) for a future SMS upgrade.

Email verification delivery is provided by **Supabase Auth** (`email verification` → 6-digit code → `verification code`), using only the browser-safe public anon key. There is no Resend, no Gmail/domain sender, and no service_role key anywhere.

## Flow and privacy
1. Signup requires name, email, optional phone, and birthdate; the server rejects users under `RUN_LOCAL_MIN_AGE` (default 16).
2. Supabase emails a six-digit OTP to the signup email. Code boxes auto-advance and use `inputmode=numeric`. The client verifies the code with Supabase (`verification code`, type `email`) and sends the resulting access token to the Run Local server.
3. The server **never trusts the client's claim**: it validates the access token against Supabase's `/auth/v1/user` endpoint (public anon key only) and only then links the Supabase user UUID to the Run Local account (`supabaseAuthId`, server-side only). The token's email must equal the account email, and an already-linked account can't be re-homed to a different Supabase identity.
4. **Email verification alone does NOT grant the Verified badge.** It only advances the funnel to the selfie step; the badge comes from manual owner review.
5. A mandatory consent screen appears before `getUserMedia`; no gallery/file picker is used for selfies. Consent states live capture, comparison/review, no public display/discovery, admin-only access, and retention.
6. Selfie submissions are explicitly `pending_review`; no liveness or biometric match is claimed without a real provider.

## Server env vars
- `VITE_SUPABASE_URL` — Supabase project URL, e.g. `https://abcd1234.supabase.co` (browser-safe; embedded in the client bundle by Vite and read by the server).
- `VITE_SUPABASE_ANON_KEY` — Supabase **public anon key** (browser-safe). This is the only key the app ever uses; a `service_role` key is never requested, stored, or shipped to the client.
- `RUN_LOCAL_MIN_AGE` — minimum age, default `16`.
- `RUN_LOCAL_RETENTION_YEARS` — default `3` years after deletion/inactivity.
- `RUN_LOCAL_ADMIN_KEY`, `RUN_LOCAL_ADMIN_EMAIL` — admin safety tool.

If the Supabase vars are missing, `/api/verify/start` and `/api/login/start` return `503 email_unconfigured`, the client shows an explicit "email verification is not configured" state, and **no code is sent** — delivery is never faked. Provider/network failures return explicit error states. SMS/Twilio is not active or used; phone verification is reserved for a future upgrade.

## Supabase dashboard settings (project setup)
- **Authentication → Providers → Email**: Enabled (this is the "Email provider + OTP" path).
- **Authentication → Sign In / Up**: "Allow new users to sign up" ON — signup OTP (`shouldCreateUser: true`) creates the Supabase auth user for the new email. The Supabase auth user is only an email-identity vehicle; the Run Local account (profile, verification state) is created separately by the Run Local server.
- **Authentication → Email**: "Email verification Length" `6` (must match the six-digit code boxes), confirm email / OTP verification enabled (do not disable email confirmation).
- **Authentication → JWT Settings**: the project's JWT secret can stay whatever it is. The server validates tokens via Supabase's `/auth/v1/user` endpoint, which works with any JWT secret — no JWT secret is needed in the Run Local configuration.

## Known limitation (documented, not faked)
The server validates Supabase access tokens by introspection against the Supabase project (one authenticated call per verify/sign-in, using only the public anon key). If Supabase is unreachable at that moment, verification returns an explicit network error — it never grants access without a validated identity. Local HS256 JWT verification is not used as the trust source, so a custom project JWT secret does not break the flow.

Sensitive verification records (email, timestamps, selfie reference, unverified phone, signup IP, rolling 90-day login IP history, birthdate, Supabase auth UUID) remain server-only and are absent from public payloads. Admin search/view/CSV export/selfie access requires a reason and is audited; non-admins are rejected. Selfies and phone/verification records are purged by the existing retention job after the configured window.
