# Kimbio — Master Roadmap

Merges the 39-item list with the structural audit findings, adds the two
monetization products, and **resequences by dependency rather than by severity**.

Baseline: `d009a2e` on `mvp/columbia-launch`. Original item numbers are kept in
`[brackets]` so nothing gets lost in the reshuffle.

**All four blocking decisions are RESOLVED** — see the Decisions section at the
end. Summary: Training is a peer tab; `/events` is public read-only with gated
writes; coach payments are platform-billed (not Connect); self-serve plans are
one-time per block.

**This is the index document.** Seven companions carry the detail:

| Document | Covers |
|---|---|
| `KIMBIO-STRUCTURAL-AUDIT.md` | Information architecture, 24 orphaned routes, per-audience journeys, entry-point contradiction, monetization gaps |
| `KIMBIO-VISUAL-SYSTEM-AUDIT.md` | Bottom-nav collision math, type/radius/elevation/control drift, coral rule, per-page grouping into 3 remediation batches |
| `KIMBIO-TRAINING-CALENDAR-SPEC.md` | The `3+4=7` cell, AM/PM display, Final Surge / TrainingPeaks / Garmin / Coros conventions |
| `KIMBIO-ADMIN-EXPERIENCE-SPEC.md` | Admin & group-lead event management, the unified work queue, settings restructure |
| `KIMBIO-LAUNCH-READINESS.md` | Beta instrumentation, feedback channel, sponsor pricing, marketing imagery, staged rollout |
| `KIMBIO-DEMO-AND-DISCOVERY-SPEC.md` | Feature registry, public demo, self-updating tour/help/changelog, component gallery |
| `KIMBIO-COMPETITIVE-GAPS.md` | SEO/shareability, bundle size, timezones, accessibility, safety layer, push, competitive position |

Counts appearing throughout, all measured:

| Finding | Count |
|---|---|
| Routes with no nav entry | **24 of 44** |
| ~~Icon call sites rendering empty SVGs~~ | ~~139~~ → **0** (see 0.1 correction) |
| Pages locked to mobile width (`max-w-md`) | **21 of 41** |
| Pages that don't clear the bottom nav | **15+** (11 with zero padding) |
| Arbitrary px font sizes | **815** (10 sizes, 8px–16px) |
| Border-radius uses / variants | **899 / 10** |
| Non-brand color uses | **322** |
| Hand-rolled button strings | **251** (4 heights, no component) |
| Stripe payment modes supported | **1 of 3 needed** |

---

## Why the order changed

The original list is ordered by *what is most broken*. That's the natural
instinct and it's the wrong axis, because the most broken thing is rarely the
thing blocking the most other work.

Three reorderings matter:

**Navigation moved up, from Tier 2 to Phase 1.** `[17]` scoped it as "training
hub navigation." The real scope is app-wide: **24 of 44 routes have no nav entry
anywhere.** Every feature in Tiers 2–8 adds capability to a structure that
can't surface what already exists. This is the single highest-leverage item in
the document.

**Tests moved down, from Tier 1 to Phase 5 — but before payments.** They're
mostly stale assertions, not product bugs, so they don't block design work. They
absolutely do block billing work: you don't touch money code with a red suite.

**Growth moved to last and partially cut.** Streaks, run-buddy discovery, and
welcome cohorts `[31][32][33]` are cold-start acquisition mechanics. Kimbio is
not cold-start limited; it's findability limited. You have a coach directory, a
shoe library, and a pace calculator that a signed-up user cannot reach.

---

## Phase 0 — Trust and broken affordances

Nothing here is cosmetic. Each item makes the product feel unreliable in a way
that contaminates features that are actually fine.

**0.1 — ~~139 icon call sites render empty SVGs~~ → CORRECTED: three optional polish items**

> **CORRECTION (verified at `215f969`, and re-verified against `d009a2e` itself
> so this is not drift).** The claim below is **false**. All ten allegedly
> undefined names are defined in `PATHS`. A comprehensive cross-reference of
> every icon name used anywhere (32 distinct, static and dynamic) against every
> name defined (42) yields **zero** undefined names, and all 42 were rendered
> through the real `Icon` component and inspected — only `messages` was
> malformed, and that was fixed in `215f969`.
>
> **Cause of the error:** the audit's extraction regex was
> `^\s{2}(\w+):\s*\(` — requiring an open paren after the colon, which
> silently skipped the ten icons defined as single-line JSX
> (`close: <path … />`). The *used* set was correct; the *defined* set was short
> by exactly those ten. The deeper failure was treating script output as an
> observation without rendering anything.
>
> **What actually remains of 0.1**, all optional polish, none of it broken:
> normalize optical weight across `flag` / `trophy` / `mapPin` / `rsvp`; drop
> unused `home` / `mail` / `phone`; keep **0.2** (union-typing `name`) as a
> *guard against future breakage*, not a fix for current breakage.

~~`Icon` does `{PATHS[name] ?? null}`. Ten referenced names are undefined, so they
paint nothing: `check` (42 uses), `chevronRight` (38), `close` (21), `plus` (17),
`spark` (10), `settings` (4), `chevronDown` (3), `user` (2), `logout`, `menu`.~~

~~Checkmarks, chevrons, close buttons, and create buttons are **invisible across
the entire app**.~~

Fix: define the 10 missing icons at the existing 24×24 / `strokeWidth="1.8"` /
round-cap geometry; redraw `messages` (three disconnected arcs that don't form a
shape, sitting next to a correct `chat` bubble); normalize optical weight across
`flag` / `trophy` / `mapPin` / `rsvp`; drop unused `home` / `mail` / `phone`.

**0.2 — Make icon failure loud** *(new)*

Type `name` as a union of defined keys instead of `string`. The build already
gates on `tsc --noEmit`, so this becomes impossible to reintroduce. Add a
dev-mode fallback glyph so anything slipping through is visibly wrong rather
than invisibly absent. Silent failure is why this reached 139 sites.

**0.3 — Training-plan number input** `[1]`

Confirmed broken; input isn't reflected. Needs a different layout, not a patch.
First interface that eats your input costs you credibility everywhere else.

**0.4 — Page-by-page button/link audit** `[2]`

Do this **after** Phase 1, not before. Restructuring changes which surfaces
matter; auditing first means auditing pages you're about to reorganize.

**0.5 — Delete `/personal-runs`** *(new)*

Zero inbound links from anywhere. Unreachable, `max-w-md`, entire JSX on one
line, non-brand emerald kicker, no empty or loading state. Fold into My Runs as
a private-run toggle.

> **CAVEAT (verified).** Delete `PersonalRunsPage` only — **keep the
> personal-run API** (`/api/personal-runs`, and the four client functions in
> `lib/api.ts`). `MyRunsPage` uses them.

**0.6 — Analytics and error tracking** *(new — see Launch Readiness)*

`src/lib/analytics.ts` is 72 lines that capture **UTM parameters and nothing
else**. No page views, no events, no funnels, no session replay, no error
tracking. There is a cookie consent banner gating analytics that do not exist.

**Zero clicks are currently traceable.** With 100 beta users incoming, this
blocks every prioritization decision for the next three months. PostHog
(analytics + session replay + flags) and Sentry, with the event taxonomy in
Launch Readiness §2.1.

**0.7 — In-app feedback channel** *(new)*

> **SEQUENCING CORRECTION (accepted).** As written this depends on the unified
> admin queue, which is **1.6** — a Phase 1 item. Decoupled: land feedback into
> a plain table plus a Resend notification, and wire it to the queue when 1.6
> arrives.

There is **no way for a user to report that something is broken**.
`RunnerFeedbackSheet` is peer trust-rating, unrelated. Beta users' only recourse
is texting you personally. Persistent affordance, auto-attached context, routed
to the admin queue.

**0.8 — Snapshot sponsor price on the booking** *(new)*

`SPONSOR_DAY_RATE_USD` is hardcoded in `payments.ts:35` and the price is **not
stored on the booking** — changing a rate silently reprices historical bookings.
Add `quotedDayRateUsd` / `quotedTotalUsd` / `quotedAt`. Small change, prevents
rewriting financial history.

**0.9 — Marketing imagery** *(new)*

Ten stock photos, none of them Columbia. A marathon crowd and a fisheye trail
jump are the visual language of every running app — they contradict the "local
layer" positioning on the first screen a stranger sees.

**0.10 — Route-level code splitting** *(new — see Competitive Gaps)*

**1.32 MB in one chunk** (350 KB gzipped), no lazy loading; the build warns
about it. Admin, Forum, Settings, and Messages are 36% of the app and don't
belong in first paint. Runners open this on mobile data at a trailhead.

**0.11 — Accessibility minimum bar** *(new)*

Never audited. `text-[8px]` and 50 touch targets under 44px — both
independently verified in the Visual System Audit and both still valid.
~~139 icon-only controls with no accessible name (empty SVGs)~~ — **this third
leg is void** (see 0.1). The a11y concern may still be real but must be
re-derived from actual missing `aria-label`s on icon-only controls, not from
empty SVGs.
>
> **DEPENDENCY ADDED (0.7, commit 53cc487).** Feedback reports attach the user's
> last 3 actions, and those breadcrumbs describe a control by its `aria-label`
> (falling back to `data-tour-target`, then `name`, then the tag name) —
> deliberately never `innerText`, so a click on a message bubble can't capture
> the message. **An icon-only button with no accessible name therefore produces
> a near-blank crumb** like `button[]`. So 0.11 is no longer only a
> compliance/usability item: adding accessible names directly improves the
> quality of every bug report a beta tester sends. Fixing a11y makes the
> feedback channel measurably more useful, which raises 0.11's value above its
> original framing. Running clubs skew older than
tech products; your own seed data has a "walkers welcome" run. Add `axe` to CI.

---

## Phase 1 — Structure

**1.1 — App-wide navigation restructure, built as a feature registry** `[17, expanded]`

> **Build this as a typed feature registry, not a nav array** (see Demo &
> Discovery Spec §3). You are already going to define which features exist,
> which area they belong to, and which roles can see them — that work *is* the
> registry. Done as a registry, it also drives the tour, the public demo, the
> help index, and the changelog. Done as a nav array, that information gets
> defined a second time later, which is how three drifted nav definitions
> happened before.

Current: 44 routes, 6 bottom tabs, 10 sidebar items, **24 orphans**. Three of
six mobile tabs are social plumbing (Forum, Connections, Messages) while Groups
and the entire training product have zero mobile presence.

`TrainingPlanDetailPage` is a hidden hub: Shoes, Pace calculator, Recurring
schedules, Training summary, Coach directory, and Coach roster hang off it and
nowhere else — and `/training-plan` itself has no nav entry. **A coach who signs
up cannot find their own roster.**

```
BOTTOM (5)   Home · Events · Groups · Training · You
SIDEBAR      + Races, Routes, Forum, and role-conditional entries
ROLE-GATED   Sponsor dashboard · Coach roster · Admin
```

Messages and Connections move under **You** — relationship management, not
discovery. **Training** becomes a real hub surfacing the six orphans as cards.

**1.2 — Build a real signed-in Home** *(new)*

`/` currently renders `DiscoverEventsPage` (89 lines) — the least-built page in
a 13,788-line app is the primary entry point. A board is not a home. Home
answers: what did I commit to, what is my group doing, what changed since I was
last here.

**1.3 — Public/gated split + geofence bypass** *(resolved — see D2)*

`/` shows marketing to guests, but `/events` has **no auth gate** — a guest
clicking Events bypasses the funnel entirely and gets the full 753-line page.
Pick one. Also: `/` renders different pages for guest and signed-in, so a shared
link shows members a board and non-members a sales page.

**1.4 — Marketing page shows live events** *(new)*

It sells with words while you have real Tuesday runs, real hosts, and real
attendee counts. Three live Columbia runs plus a "14 runs this week" counter is
more persuasive than any headline, and it reuses a component you already built.
This is also `[30]`'s public demo, solved for the community half.

**1.5 — Training calendar: stacked session rows** *(new — see Calendar Spec)*

`TrainingPlanDetailPage.tsx:199` renders two-a-days as `3+4=7mi` at
`text-[8px]`, and the branch is `dayList.length === 2` — a third session
(run + lift + swim, all supported by the model) is **silently dropped**. AM/PM
is derived on line 251 and then never displayed.

Structural, not cosmetic: the current cell loses data. One row per session,
AM/PM as the row label, weekly total moved to the week header, `completedRunId`
surfaced as a completion state. Full spec in **KIMBIO-TRAINING-CALENDAR-SPEC.md**.

Pair with **0.3** — the number-input bug is on this same page.

**1.6 — Admin IA + group-lead event management** *(new — see Admin Spec)*

Group leads **cannot manage their own runs at all** — `/groups/:id/manage`
covers membership and profile only, and events live in a global CMS they can't
reach. The server already computes per-actor capabilities
(`eventModeration.ts:69`); no surface renders them.

Split `/admin` (1,436 lines) into sections, add a role-conditional nav entry,
add an Events tab to group management with per-occurrence cancel. Full spec in
**KIMBIO-ADMIN-EXPERIENCE-SPEC.md**.

**Do §1.1 of that spec immediately regardless of phase:** the admin dashboard
loads nothing on mount — it has **four separate "Load" buttons** the admin must
find and press to assemble a picture of the site.

**1.7 — First-run experience and invites** *(new)*

No orientation for a first-time signed-in user, and **no invite mechanism** —
you have 100 people waiting and no way to invite them as a batch. For a
community product, invitation is the growth model. Also missing: the email
lifecycle (welcome, run reminder, weekly digest) despite Resend being verified
and sending.

**1.8 — Public demo view** *(new — delivers `[30]`)*

There is **no public demo**. The existing tour is gated to *verified* runners, so
a stranger must sign up and wait for verification before seeing anything. For a
beta inviting 100 strangers, that's backwards.

`/demo`, no auth, persona-first (find runs / lead a club / training / sponsor),
4–6 screens each, rendering **real Columbia data** read-only. Real data can't go
stale and doubles as proof the community is alive.

**1.9 — Tour onto the registry + non-drift tests** *(new — delivers `[36]`)*

`TOUR_STEPS` is 7 hand-written steps for 44 routes, and it is **already
inaccurate** — its docblock says messaging is unavailable, but messaging
shipped. Migrate onto the registry with a `status` flag, and add four CI
assertions: every route has a registry entry; every tour anchor exists; nothing
`planned` is described as available; every live feature has a nav path for the
roles that can reach it.

That last assertion converts findability from an occasional audit into a build
gate — it's what prevents the next 24 orphaned routes.

**1.10 — Timezone-correct event times** *(new)*

`time: string; // "6:00 PM"` with **no timezone anywhere** in the event model.
Fine for Columbia-only; breaks the moment you add the second city your marketing
page already promises. Also blocks correct `.ics` export and reminder
scheduling. **Do it now, at seven events** — this is the cheapest it will ever be.

**1.11 — Filters on the DepartureBoard** *(new)*

Four separate per-page search boxes, no way to answer "is there a run tomorrow
morning near downtown that isn't too fast?" You now have day, time, location,
distance, and `pacePolicy`. Filters beat search for a new runner, who doesn't
know what to type.

---

## Phase 2 — Systemic visual fixes

Mechanical, high-leverage, and they fix `[34]` structurally instead of
page-by-page.

> Full measurements and per-page grouping in **KIMBIO-VISUAL-SYSTEM-AUDIT.md**.
> Sequence within this phase: **tokens first (2.4–2.6, 2.8), then components
> (2.1, 2.7), then the sweep.** Components consume tokens.

**2.1 — `PageShell` with three widths + bottom-padding token** *(new)*

**21 of 41 pages are locked to `max-w-md`** — 448px centered on a desktop
monitor. Affected: Admin, Settings, Forum, Messages, Profile, Events,
EventDetail, Login, Connections, RunnerProfile, Verify, Checkin, both Sponsor
pages, TrainingPlanDetail, and more. This is the single largest cause of "looks
hideous on desktop."

Three widths — `narrow` (forms, auth), `standard` (feeds, detail), `wide`
(admin, forum, messages) — replacing every hand-rolled `mx-auto w-full max-w-md`.

**2.2 — Semantic color tokens + the coral rule** *(new)*

**322 non-brand color uses**: emerald 113, amber 108, rose 75, sky 26, against a
two-color brand (`#14171C`, `#FF5741`). Some are legitimately semantic — verified
badges, waiver status. 322 is drift. Rainbow chips on white cards is what reads
as cartoonish.

Define `--status-ok` / `--status-warn` / `--status-danger`; allow color only
through them. Everything else is ink, coral, or slate.

**2.3 — Messaging scroll** `[37, rediagnosed]`

Not a CSS bug. One line, three defects:

```ts
useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); },
  [messages.length]);
```

1. `"smooth"` on initial load animates through the entire history instead of
   opening at the bottom. Use `"auto"` on first paint.
2. Keyed on `messages.length` — edits and reactions never correct the view, and
   a deletion *reduces* length, firing a scroll while you're reading history.
3. No scroll anchoring — an incoming message yanks you off what you're reading.
   Auto-scroll only within ~100px of the bottom; otherwise show "New messages ↓".

Plus `h-full overflow-y-auto` inside a shell with no guaranteed bounded height.

**Note:** messaging is *not* missing formats. It already has photo attachments,
emoji, typing indicators, reactions, and drafts. It was never interaction-tested.
That pattern — built, never exercised — repeats across the app.

**2.4 — Type scale** *(new)*

**815 arbitrary px font sizes** (`text-[13px]` ×311, `text-[11px]` ×145,
`text-[12px]` ×121, down to `text-[8px]`) running alongside 727 Tailwind scale
utilities. Ten body sizes between 8 and 16px is not a scale. Collapse to six
tokens — the DepartureBoard already uses exactly this scale (11/13/15/20/30/44,
tabular numerals); promote it rather than invent one. Nothing below 11px
survives.

**2.5 — Radius tokens** *(new)*

899 uses, 10 variants. `rounded-[10px]` (62) sits between `lg` and `xl` for no
reason; `rounded-3xl` (2, Messages only) makes bubbles rounder than everything
else. Collapse to four role-based tokens: pill / control / card / sheet.

**2.6 — Elevation tokens** *(new)*

128 `shadow-sm` + a hairline ring at **two different opacities**
(`ring-slate-200/70` ×113, `ring-slate-200` ×33) means modals, cards, nav, and
toasts all sit at the same apparent depth — nothing has hierarchy. Four levels:
flat / raised / overlay / modal. Also delete 5 bare `shadow-` classes that
render nothing.

**2.7 — `Button` component** *(new)*

Four heights (`h-11` ×151, `h-10` ×50, `h-12` ×32, `h-14` ×18) with no rule, and
**no Button component at all** — 251 hand-rolled className strings. `h-10` (40px)
is under the 44px touch minimum and appears 50 times. Variants: primary /
secondary / ghost / danger / accent, each shipping hover, active, disabled,
focus-visible, and loading.

**2.8 — Motion tokens** *(new)*

Three durations only: 90ms press, 200ms state change, 260ms spring enter/lift,
all `prefers-reduced-motion` gated. Motion currently exists **only** on the
DepartureBoard, which is why it reads as a different app.

**2.9 — List state contract** *(new)*

Every list ships loading (skeleton matching final geometry, not a spinner),
empty (an invitation to act), and error (what happened, what to do). Missing
empty states are a large part of "feels like it's missing half the resources."

**2.10 — Admin forms and settings restructure** *(new)*

`EventCmsSection.tsx` renders **raw database column names as placeholders** —
`groupId`, `distanceLabel`, `externalUrl` — with no labels, no validation, no
group picker, and a page-level reason textarea shared across every action.
It's also hardcoded to six fields, so `pacePolicy` can't be set there.

`SettingsPage` is 14 flat sections with Username / Profile photo / Profile
details as three separate entries for one thing. Collapse to five groups.

Depends on `PageShell`, `Button`, and the type scale.

**2.11 — Component gallery** *(new)*

`/dev/gallery` rendering every primitive from the real components — Button
variants, PageShell widths, type scale, radius/elevation tokens, **the icon
set**, list states. Genuinely self-updating because it imports the components.
An icon gallery would have made the 139 empty SVGs visible on sight.

**2.12 — SEO and shareability** *(new — highest-leverage growth work here)*

No SSR or prerendering, one global `<title>` for 44 routes, no `robots.txt`, no
sitemap, **no Open Graph tags**. Google sees an empty div for "group runs
columbia mo" — the highest-intent query in your market and the one channel
Strava and Garmin structurally cannot own. Every link shared to a club's
Facebook group renders as a bare URL.

Prerender the public routes only (`/`, `/demo`, `/events`, `/events/:id`,
`/groups`, `/races`, `/routes`); the app stays a SPA behind auth. Add per-route
meta, OG tags, sitemap, and `Event` JSON-LD.

---

## Phase 3 — Payments architecture *(decide once, before building any of it)*

This is the biggest gap in the original list, and the new coaching/self-serve
requirement makes it urgent.

**Today `payments.ts` supports exactly one mode: `mode: "payment"` — one-time
sponsor day-rates.** No subscriptions. No Connect. No transfers.

The two products just requested need **two payment modes neither of which
exists**, and one of them is an entirely different Stripe product:

| Product | Money flow | Stripe surface | Exists? |
|---|---|---|---|
| Sponsor day-rate | payer → platform | Checkout, one-time | ✅ |
| **Self-serve plan** `[29]` | athlete → platform | **Billing / subscriptions** | ❌ |
| **Coach-led plan** `[29]` | athlete → **coach**, platform takes fee | **Connect** | ❌ |

**3.1 — The Connect decision** *(new, and it's the important one)*

Paying a coach is a **marketplace** transaction, not a checkout. It requires
Stripe Connect: express accounts, onboarding, KYC/identity verification, payout
schedules, `application_fee_amount`, refund and dispute handling where the funds
sat in someone else's account, and 1099-K reporting for coaches who cross the
threshold.

That is materially more work than the sponsor flow and it carries real
compliance surface. **Decide this before writing any pricing UI**, because the
answer changes the data model:

- **Connect (marketplace)** — coaches set their own price, you take a cut.
  Scales, but you own onboarding and tax reporting.
- **Platform-billed** — you charge a flat rate, pay coaches out-of-band. Ships
  far faster, works for the first 10 coaches, does not scale.

For a Columbia launch with a handful of coaches, **platform-billed is the right
call.** Ship revenue now; migrate to Connect when coach count justifies the
compliance work. But make it a deliberate decision, not a default.

**3.2 — Self-serve training plan purchase** *(new — the "no coach" product)*

The requested product: someone who doesn't want a coach buys a plan themselves.

You have plan authoring, a day-level model, and a recurrence engine. You do
**not** have plan *templates* — `grep template src/server/types.ts` returns
nothing. Every plan today is bound to a coach-athlete relationship
(`CoachRelationshipRecord`).

Build order:
1. `PlanTemplateRecord` — an authorable plan not bound to a relationship.
2. Template library + preview (this is also `[30]`, the public demo).
3. Purchase → instantiate: clone the template into the buyer's own calendar with
   dates resolved from their chosen start date.
4. Subscription vs one-time. **One-time per plan** for a 12-week block; a
   subscription implies ongoing service you aren't delivering without a coach.

**3.3 — Coach-led paid tier** `[29]`

Relationship model, consent flow, roster, freeze, and propose-a-change all
exist. This is the **shortest path from built to billable** in the entire
product. Gate the existing relationship on an active payment; don't build a
parallel system.

**3.4 — Remove the unpayable price badge** *(new)*

`DepartureBoard` renders a `priceCents` badge and `startCheckout` throws "not
built yet." A price that cannot be paid is worse than no price. Pull it until
event fees are real.

**3.5 — Sponsor dashboard** *(new)*

The sponsor journey **ends at checkout**. They pay and get no logged-in view of
what they bought, when it runs, or when it expires. Every other journey in the
app terminates the same way — this is the most expensive one to leave hanging.

**3.6 — Sponsor rates into CMS + commercial terms** *(new)*

Move rates into `cms.ts` settings so pricing is admin-editable and audited.
Add promo/founding rates, nonprofit tier, and monthly/seasonal packages — day
rates suit one-off events, but a local shoe store wants a season.

**3.7 — Safety layer** *(new — differentiator, not compliance)*

Verification, waivers, reports, trust ratings, and geofencing already exist —
genuinely more than Strava or a Facebook group. Missing for people meeting
strangers at dawn: share-your-run, emergency contact visible to a lead at
check-in, map pins for meeting points, and a first-timer flag. "Verified
runners, real names, someone knows where you are" is a reason to choose Kimbio,
and it matters disproportionately to women runners.

---

## Phase 4 — Journey completion

The consistent structural gap: **every journey terminates instead of
continuing.** RSVP ends. Payment ends. Signup ends.

**4.1** Post-RSVP next step — right now RSVP is a dead end.
**4.2** Post-signup onboarding — `[36]`, and the highest-value version is
        "join a group," not a feature tour.
**4.3** Coach identity and roster in nav — `[15][16]` are unreachable without it.
**4.4** Athlete "propose a change" form `[16]` — backend exists; the athlete
        currently hits an error with no path forward. A constraint shown without
        an alternative is a dead end.
**4.5** Coach bulk-scheduling `[15]` — extend the recurrence engine to target
        another person's plan.
**4.6** Web push + email lifecycle — `Notification.requestPermission()` is called
        but there is **no pushManager and no push handler**; the permission is
        burned and nothing can be sent. "Your run is tomorrow" is the highest-
        retention message an events product has.
**4.7** Offline data caching — the shell is precached but event data isn't, so a
        runner with no signal gets a spinner at the trailhead.

---

## Phase 5 — Test suite *(before Phase 3 ships, not before Phase 1 starts)*

40 failures at `8ae7514`; 32/15 after the recent fixes. Root causes, corrected:

**`provider-availability.test.ts` `[6]` — do not fix.** `GET /api/connections/:provider`
no longer exists; the path was repurposed for social connections. ~14 tests
guard a **removed Strava integration**. Since Strava is wanted again later
(Phase 6), `describe.skip` with a comment rather than delete — that file is the
only surviving spec of the four provider states, CMS gating, and per-account
token isolation. It compiles skipped; imports still resolve.

**`cms-admin.test.ts` `[5]`** — mixed. Some failures are provider-settings tests
that die with Strava; others are the admin-env problem. Separate before fixing.

**`desktop-layout` / `-hardening` `[3][4]`** — assertions expect CSS class
structure that was refactored. Stale.

**`marketing-page` / `copy-truthfulness` `[7]`** — copy rewritten; assertions
weren't. Stale. Note these will change **again** in Phase 1.4, so do them after.

**`notifications-model` / `settings-notifications` `[8]`** — categories grew past
the exact arrays asserted. App is right.

**`header-auth` `[9]`, `username-ui` `[11]`, `tour-targets` `[14]`** — renders
returning empty; same class as the Router/context issues already fixed.

**`trust-api` `[10]`, `auth-error-normalization` `[12]`, `owner-admin-menu` `[13]`**
— single failures, individually diagnosed, genuinely small.

**Also add:** a `/app` → `/` sweep. That base-path migration is complete and
correct in `vite.config.ts`, the manifest, `sw.js`, and the registration — only
the tests were left behind.

---

## Phase 6 — Depth

**6.1** Strava/Garmin **read-only import** *(reframed)*. Do not chase feature
parity with a 100M-user company — that framing loses. Import logged runs onto a
Kimbio profile; spend engineering on the group/club/coach/sponsor layer none of
them serve. Your own copy already says "the local layer."
**6.2** GPX→SVG route decoder `[24]`. Note: the sliver is **not** rendering
blank — line 554 is `{event.routePath && <RouteSliver …/>}`, so it's absent, not
broken. Enhancement, not repair.
**6.3** Real event-type classification `[25]` — everything says "group." A wrong
label is worse than none.
**6.4** Verified Coach tier `[18]`; Partner/Notable `[19]` — gates trust before
someone commits training time to a stranger.
**6.5** Calendar zoom: 3-day/5-day `[20]`, list view `[21]`.
**6.6** Coach audio `[22]`, PDF export `[23]`.

---

## Phase 7 — Social and growth *(genuinely last)*

**7.1** Connections sidebar `[26]`, reactions `[27]`, forum tie-in `[28]`.
**7.2** Forum simplification `[35]`.
**7.3** Streak challenge `[31]`, run-buddy discovery `[32]`, welcome cohort `[33]`.
**7.4** Affiliate/gear `[38]` — needs its own pattern language; browsing products
is a different task than logging a run.
**7.5** Route creation, draw-on-map `[39]` — a spatial interaction vocabulary
unlike anything else here. Effectively its own mini design system. Standalone,
and correctly so.

---

## Decisions — RESOLVED

All four are decided. Build against these; don't re-litigate them mid-phase.

### D1 — Training is a peer tab. `Home · Events · Groups · Training · You`

Training is where the revenue lives (Phase 3) and it is currently **100%
unreachable** — six features behind a hub page with no nav entry. Burying it
under You repeats the same mistake one level down.

**Tradeoff, stated honestly:** it costs a tab, and a new runner with no plan
could land on an empty screen. **Mitigation that turns the risk into revenue:**
when the user has no plan, the Training tab shows the coach directory and the
self-serve plan library. It becomes the storefront for the paid product instead
of an empty state.

### D2 — `/events` is public, read-only. Write actions are gated.

Local SEO is the one acquisition channel Strava and Garmin structurally cannot
take, and it requires indexable event pages. Event listings are already public
information — clubs post them to Facebook today — so hiding them protects
nothing. What's defensible is the **graph**, not the listing.

```
PUBLIC  (indexable, shareable, geofence-bypassed)
  /events · /events/:id · /groups · /groups/:id · /races · /routes · /demo
  → time, place, distance, pace policy, host name, going COUNT

GATED   (signup required)
  → who's going (names/faces), RSVP, check-in, contact host, messaging,
    forum, training, group join
```

**Show the count, never the identities.** "12 going" is proof of life; twelve
names and faces exposed to anonymous visitors contradicts "private by default"
and is unsafe for a product whose safety story matters most to women runners.

This also places the conversion moment correctly: signup prompts at **RSVP**
("Join to save your spot and see who's going") where the value exchange is
obvious, not at the door where it's a toll.

**Implementation note — this is currently broken in both directions.**
`/events` is not in `GEOFENCE_BYPASS_PATHS`, and the bypass only covers
`/landing`, `/legal`, `/login`, `/recovery`, `/confirmation`, `/callback`,
`/sponsor*`, `/` for guests, and exempt accounts. So `/events` today is
**ungated for auth but walled by geography**: a Columbia guest skips the entire
marketing funnel and gets the full page, while Google's crawler and every
out-of-town visitor hit the geofence. Too open and too closed at once.

Add the public read routes to the bypass. **Keep the geofence on write
actions** — that's what it actually protects.

`/events/manage` stays gated exactly as it is. That's moderation tooling, not
discovery.

### D3 — Coach payments: platform-billed, not Stripe Connect.

Ship revenue now. Connect means express accounts, KYC, payout schedules,
`application_fee_amount`, disputes over funds held in someone else's account,
and 1099-K reporting. That's the right architecture at 50 coaches and the wrong
one at 5. Migrate when coach count justifies the compliance surface — and design
the data model so that migration doesn't require re-onboarding anyone.

### D4 — Self-serve plans: one-time purchase per plan block.

A subscription implies ongoing service you are not delivering without a coach.
Sell a 12-week block. Recurring revenue is the coach tier's job.

---

## Appendix A — Security and operational items

Raised during the audit; not feature work, but none of it should be lost.

**A.1 — Rotate the GitHub PAT. Do this first.**

A personal access token appeared in **plaintext in stored conversation history**
while searching this project for context. A credential in transcript history is
one you no longer control the blast radius of. Rotate at
`github.com/settings/tokens` and update the remote URL in any session using it.

**A.2 — `traemillercode/RunLocal` is a public repository.**

Confirmed by an unauthenticated `git clone`, which succeeds. Consequences:

- Reading the repo needs **no credentials at all**. A PAT is only required to
  push. Any session can clone, read, build, and test without secrets.
- Anyone can read the source, including the admin logic and moderation rules.
  Nothing sensitive is committed today (verified — no keys, no tokens), and
  `.gitignore` correctly excludes `data/*` while allowing
  `data/uploads/public/`. **Keep it that way**: the flat-file store must never
  be committed.
- If the repo should be private, changing it does not break anything except
  unauthenticated clones.

**A.3 — There is no GitHub MCP connector.**

Confirmed against the connector directory. Repo work happens through `git` in a
sandbox, not through a connector. Sessions with a PAT in the remote can push;
sessions without can still clone and read, because the repo is public.

**A.4 — Multi-session conflict risk.**

Two sessions editing the same files from different baselines will conflict.
Rebase any patch onto current `origin/mvp/columbia-launch` before applying, and
avoid having two sessions fix the same test files simultaneously.

---

## Appendix B — Test-suite fixes already landed

Context for Phase 5, so the same ground isn't re-covered.

Baseline was **56 failures / 25 files**. Two root causes were fixed and verified:

**B.1 — Missing admin environment** (`content-admin`, `admin-api-errors`, 12
tests). Neither file set `ADMIN_KEY` / `ADMIN_EMAIL`, which every passing admin
suite does. Without them the `runlocal_admin` session resolves to no operator,
responses come back with no `results` payload, and `rows[0]` throws. Fixed with
a `beforeEach`/`afterEach` pair per file.

**B.2 — Missing Router wrapper** (`notifications-center`, `runner-profile-page`,
`runner-feedback-ui`, 6 tests). `NotificationsCenter` and `RunnerProfilePage`
adopted `useNavigate()` after their tests were written; bare
`renderToStaticMarkup` calls needed `MemoryRouter`. A stale doc comment calling
`NotificationsCenter` "presentational" was corrected.

That took the suite to **40 / 19**, which the build session then reduced further.
The remaining clusters and their verdicts are in Phase 5.

**B.3 — Method note.** The suite must run under **Bun**, not Node. Running
`vitest` under Node produces a different and misleading failure set. Always
capture the failing-file list before a change and diff it after; that is how
every regression in this audit was caught.
