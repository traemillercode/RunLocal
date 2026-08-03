# Run Local

Mobile-first, installable web app for city-scoped running communities. **Launch city: Columbia, MO.**

This is the **MVP + identity/safety layer**: core browsing and navigation, plus an explicit Guest → Pending Verification → Verified account model with phone + live-selfie verification (Twilio), an admin-only safety tool (audited), and a 3-year retention purge. See `docs/VERIFICATION.md` for the full contract and env vars.

## What's here

- **Home / Events** — this week's group runs, chronological, with date, time, location, host, invitation label, RSVP affordance, and external-link affordance. Includes a search box (`type="search"`).
- **Races** — seeded race cards with external registration links.
- **Forum** — three distinct sections (Announcements / Community / Q&A) with Q&A sorting controls (Newest / Unanswered / Top). Guests browse; posting & replying are gated behind sign-in/verification messaging.
- **Profile** — guest / pending / verified presentation with the real verification flow (`#/verify`): phone code → explicit consent → live selfie (getUserMedia), reviewed manually by an admin. Only a Verified badge is public.
- **City switcher** — Columbia, MO is the live launch city; future cities are data-model placeholders ("Coming soon").
- **PWA shell** — web manifest, service worker (offline shell), generated PNG icons, theme colors, standalone display.
- **App-like interactions** — no full page reloads (SPA), bottom sheets, toasts, RSVP/sign-in feedback, gated create-sheets.

Explicitly **not** included (per plan): training plans, pace calculators, nutrition, direct messaging, follower graphs, algorithmic feeds, and unverified official/RRCA claims. Group types render only the two allowed labels: **"RRCA-Chartered Club"** (admin-assigned in the seed data) and **"Community Run Group"**.

> **Truthfulness note:** all events/races/posts are locally seeded *sample* content, not a live community feed. External links point at real organizers' sites where they exist. No account is created; "verification" is explicitly communicated as coming in a later phase.

## Stack

Vite + React 19 + TypeScript + Tailwind CSS v4 + react-router (hash routing). Zero backend — local seeded data behind a city-first model. Unit tests with Vitest.

## Data model (city-first)

Everything hangs off a `City` in `src/types.ts` and `src/data/cities.ts`:

```
City → groups[] (RunGroup: name + admin-assigned groupType label)
     → events[] (recurring weekly slots resolved against the current week)
     → races[]  (one-off listings with external registration URLs)
     → forum[]  (posts tagged announcements | community | qa)
```

Adding a city = adding one `City` entry with its own seed data. No code changes required.

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

## Roadmap (later phases — not in this MVP)

Runner sign-in + phone verification, verified badges, RSVP syncing, event/race submission and admin workflows, organizer dashboards, more cities.
