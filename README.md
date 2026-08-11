# Run Local

Mobile-first, installable web app for city-scoped running communities. **Launch city: Columbia, MO.**

This is the **current build**: core browsing and navigation, an explicit Guest → Pending Verification → Verified account model with email-first verification and live-selfie review, server-backed RSVPs and My Runs, group memberships, community submissions with moderation, an audited admin safety tool, and a 3-year retention purge. See `docs/VERIFICATION.md` for the full contract and env vars.

## What's here

- **Home / Events** — this week's group runs, chronological, with date, time, location, host, invitation label, RSVP affordance, and external-link affordance. Includes a search box (`type="search"`).
- **Races** — seeded race cards with external registration links.
- **Forum** — three distinct sections (Announcements / Community / Q&A) with Q&A sorting controls (Newest / Unanswered / Top). Guests browse; posting & replying are gated behind sign-in/verification messaging.
- **Profile** — guest / pending / verified presentation with the email-first verification flow (`#/verify`): Supabase Auth email verification → explicit consent → live selfie (getUserMedia), reviewed manually by an admin. Phone is collected only as an unverified field; SMS verification is a future upgrade. Only a Verified badge is public.
- **City switcher** — Columbia, MO is the live launch city; future cities are data-model placeholders ("Coming soon").
- **PWA shell** — web manifest, service worker (offline shell), generated PNG icons, theme colors, standalone display.
- **App-like interactions** — no full page reloads (SPA), bottom sheets, toasts, RSVP/sign-in feedback, gated create-sheets.

Explicitly **not** included (per plan): training plans, pace calculators, nutrition, direct messaging, follower graphs, algorithmic feeds, and unverified official/RRCA claims. Group types render only the two allowed labels: **"RRCA-Chartered Club"** (admin-assigned in the seed data) and **"Community Run Group"**.

> **Truthfulness note:** seed listings are *sample* content; approved community submissions and private account data are served from the local server (`src/server`). External links point at real organizers' sites where they exist. Email verification (Supabase Auth email verification) and selfie review are implemented; no biometric match or automated approval is claimed. See `docs/VERIFICATION.md` for env vars and the Supabase dashboard setup.

## Stack

Vite + React 19 + TypeScript + Tailwind CSS v4 + react-router (hash routing). Local Node server (`src/server`) with SQLite persistence and Supabase Auth, serving the SPA plus a same-origin API; city-first data model. Unit tests with Vitest.

## Data model (city-first)

Everything hangs off a `City` in `src/types.ts` and `src/data/cities.ts`:

```
City → groups[] (RunGroup: name + admin-assigned groupType label)
     → events[] (recurring weekly slots resolved against the current week)
     → races[]  (one-off listings with external registration URLs)
     → forum[]  (posts tagged announcements | community | qa)
```

Adding a city = adding one `City` entry with its own seed data. No code changes required.


## Usernames

Every new account picks a **username** at signup (legacy accounts created before
usernames existed stay fully functional and can claim one from their profile at
any time — it's never required retroactively).

- **Allowed characters:** 3–24 characters; must start with a letter, then
  lowercase letters, digits, underscore (`_`) or hyphen (`-`):
  `^[a-z][a-z0-9_-]{2,23}$`
- **Case behavior:** usernames are **case-insensitive** and stored normalized
  to lowercase — `JordanLee` and `jordanlee` are the same name, so the second
  claim is rejected as a duplicate.
- **Uniqueness:** enforced **server-side** on the normalized form (signup and
  profile updates). The client never decides uniqueness; it only surfaces the
  server's verdict. Duplicate claims return `409 username_taken` with a clear
  message.
- **Privacy:** the username is public profile identity (like name/email) and
  appears in the public account payload — no phone, selfie, IP, or verification
  data ever travels with it.

## Scripts

```bash
bun install          # install deps
bun run dev          # local dev server (port 5173)
bun run typecheck    # tsc --noEmit
bun run test         # vitest unit tests
bun run build        # typecheck + vite build → dist/
bun run publish      # build + serve dist on port 3000 (team public surface, detached)
bun run icons        # regenerate public/icons/*.png (pure-node, zero deps)
```

## Layout

```
src/
  App.tsx                 # router + shell (header, bottom nav, city sheet)
  main.tsx                # entry + service worker registration
  types.ts                # city-first data model
  data/cities.ts          # seed data (Columbia + future-city placeholders)
  lib/dates.ts            # this-week resolution + formatting (unit tested)
  lib/store.ts            # persisted client state (city, RSVPs, profile)
  lib/toast.tsx           # toast feedback
  components/             # header, bottom nav, sheets, cards, ui primitives
  pages/                  # Events, Races, Forum, Profile
tests/                    # vitest unit tests (dates + seed data invariants)
public/                   # manifest, service worker, icons
serve.ts / publish.sh     # static hosting for the team's public port 3000
```

## Roadmap (not shipped yet)

ICS export for private My Runs, deeper calendar views, operational roles and notifications, profile photos and trust flags, and more launch cities.
