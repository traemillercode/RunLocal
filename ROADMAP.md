# Kimbio Roadmap

Last updated: 2026-08-22. This file is the source of truth for what's done and what's open — update it as things ship or priorities shift.

## Shipped

**Infrastructure & deploy**
- Railway hosting, custom domain (getkimbio.com), Resend email deliverability
- Local build verification (bun installed) — every change typechecked and built before pushing, not after
- Owner account (`RUN_LOCAL_ADMIN_EMAIL`) auto-verified as site_admin, self-heals on every session check

**Auth & onboarding**
- Signup, email confirmation, password reset (root cause was a malformed Supabase email template)
- Selfie image-quality pre-filter (too dark/bright/blank/small rejected before admin review — never auto-approves)
- Admin approval flow: real success/failure confirmation, notification + email sent to the runner on verification

**Profile**
- Editable name, bio, custom title, pace, goal, training block (free text), upcoming races (free text)
- Social account linking (Instagram/Facebook/TikTok) with an opt-in "show on profile" toggle, off by default
- Home city selection (fixed a two-layer bug: button disabled-state and the save function's own guard)

**Forum**
- Category taxonomy (Training/Races/Gear/Routes/General) with filter chips
- Posts open to full untruncated view with a real shareable URL (`?post=id`)
- Edit/delete/pin permissions confirmed correctly scoped (author + admin only)

**Connections & Messaging**
- Runner-to-runner connections (already existed, just wasn't discoverable — nav confirmed)
- Messaging: 1:1 and group conversations, connection-gated, reactions, "create a run from this group chat" handoff
- Fixed: no way to actually start a conversation (missing UI), and the single-conversation endpoint returning bad data (name/profile always empty)

**Integrations**
- Strava OAuth: was fully scaffolded but never actually wired — built the missing callback endpoint end to end

**Notifications**
- Account Alerts and Run Reminders: were placeholder categories, now real (Strava connect, credential/appeal decisions, verification, and a 90-minutes-before-your-run background check)

**Standing fix**
- Service worker was still registering at a defunct `/app/` scope since the domain migration — fixed, and self-heals for anyone already carrying the stale registration

**Legal**
- Terms of Service &amp; Privacy Policy pages, covering the real risk areas (in-person run liability, selfie verification, data sharing, third-party integrations). Linked from signup and Settings. Substantive draft — still worth an actual lawyer's review before treating as final.

**Training**
- Structured training plan: plan type (5K/10K/half/marathon/ultra/custom), length in weeks, start date, optional link to a specific race. Current week is computed fresh every time (never stored), shown in Settings and on the public profile, replacing the old free-text field when a real plan is set.

**Forum ranking**
- Upvotes ("was this helpful") on every post, verified runners only, one vote per person, optimistic UI. Q&A's "Top" sort now genuinely ranks by votes — it silently used reply count before.

## Open — scoped, not started

1. **Content gating for non-verified viewers** — forum currently fully readable regardless of verification status; the ask was to make it genuinely hard to parse until verified.
2. **Full visual/navigation redesign** — the "feels like Airbnb" ask. Deliberately not started piecemeal; deserves its own pass once the underlying features (forum, messaging, connections) are stable.
3. **Ambassador role + Strava 10-connection cap** — OAuth itself works now; there's no cap enforcement or admin-assigns-ambassador flow yet.
4. **Rejection emails** — verified users get emailed; rejected applicants only get the in-app notification.
5. **Public profile URL by username** — confirm whether `/runners/:id` is sufficient or a `/​@username` style URL is wanted for sharing.

## Open — not yet scoped

- **Real liability waiver language** (current is a free-text admin field).
- Trail safety plan for the six-week Thursday race series: trailhead check-in, sweep runner, cutoff time, who monitors the safety-report queue weekly.
- RRCA insurance confirmation for the trail race series.

## Longer-term (original roadmap, untouched)

- RunSignUp sync (club membership → verified member badge, business perks)
- Stripe, Club dashboard, Business sponsor directory, Supporter tier
- Postgres migration (trigger: ~2–5k active users)
- Local route library
- Not building: native GPS run recording (competes directly with Strava), native app (PWA already installable)
