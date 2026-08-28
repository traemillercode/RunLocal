# Kimbio — Structural & Design Audit

Measured against `d009a2e` on `mvp/columbia-launch`. Every number here came from
reading the repo, not from impression.

---

## 1. The diagnosis

Kimbio is not underbuilt. It is **unstructured**.

- 44 routes. 6 bottom tabs. 10 sidebar items. **24 routes have no nav entry.**
- 13,788 lines across 41 pages — but distributed 17 to 1,494. There is no
  consistent notion of what "a page" is.
- 21 of 41 pages are locked to `max-w-md` (448px) — mobile width, on desktop.
- 322 uses of non-brand color families (emerald 113, amber 108, rose 75, sky 26).

The "cartoonish / hideous / missing half the resources" reaction is those four
facts. It is not a taste problem and it will not be fixed by restyling pages one
at a time.

**The core failure:** every page was designed as a destination, and nothing was
designed as a path. A runner lands somewhere and the page answers "what is
here," never "what do I do next" or "where am I in this product."

---

## 2. The entry-point contradiction

```
/            guest → MarketingPage        signed-in → DiscoverEventsPage (89 lines)
/events      EVERYONE → EventsPage (753 lines)
/landing     EVERYONE → MarketingPage
/events/manage  guest → MarketingPage     signed-in → EventsPage
```

Three problems, in order of severity.

**A guest who clicks "Events" bypasses the marketing page entirely.** `/events`
has no auth gate. So the funnel is: `/` sells, `/events` gives away the whole
product. Whichever is intended, both cannot be.

**The signed-in home page is the least-built page in the app.** 89 lines versus
the 753-line page it replaced. The DepartureBoard is a good component, but a
board alone is not a home. A returning runner arrives and sees a list, with no
answer to "what did I commit to," "what's my group doing," "what changed since
I was last here."

**A guest sees marketing at `/`, and a signed-in user sees a different page at
the same URL.** Shared links break: post `/` in a group chat, and members see
the board while non-members see a sales page.

### RESOLVED — `/events` is public read-only, writes are gated

See Master Roadmap **D2**. Public: `/events`, `/events/:id`, `/groups`,
`/groups/:id`, `/races`, `/routes`, `/demo` — time, place, distance, pace
policy, host, and going **count**. Gated: identities, RSVP, check-in, messaging,
forum, training, group join.

**Additional finding:** `/events` is **not** in `GEOFENCE_BYPASS_PATHS`. The
bypass covers only `/landing`, `/legal`, `/login`, `/recovery`, `/confirmation`,
`/callback`, `/sponsor*`, `/` for guests, and exempt accounts. So `/events` is
ungated for auth but **walled by geography** — a Columbia guest skips the
marketing funnel entirely while Google's crawler and every out-of-town visitor
hit the geofence. Too open and too closed simultaneously. Add public read routes
to the bypass; keep the geofence on writes.

### Answering "should the marketing page populate differently?"

Yes — but the real fix is that there should be **three** distinct root
experiences, not two:

| Visitor | Sees at `/` | Job of the page |
|---|---|---|
| Never visited | Marketing + **live event preview** | Prove there's a real community here this week |
| Visited, not signed up | Marketing, condensed + "3 runs this week" | Reduce friction to signup |
| Signed in | **Home**, not a board | Orient: your next run, your group, what's new |

The marketing page currently sells Kimbio with words. It should sell it with
**this Tuesday's actual runs**. You have real events, real hosts, real attendee
counts. A landing page showing three live Columbia runs and a "14 runs this
week" counter is more persuasive than any headline, and it costs one component
you already built.

---

## 3. Information architecture

### Current, actual structure

```
BOTTOM (6)   Events · Races · Forum · Connections · Messages · My Runs
SIDEBAR (10) + Routes, Groups & Clubs, Profile, Settings
MENU (3)     Profile · Settings · My submissions

ORPHANED (24 routes, no nav entry anywhere):
  /admin  /checkin  /coach-roster  /coaches  /coaching  /events/manage
  /my-groups  /notifications  /pace-calculator  /past-events  /personal-runs
  /recurring-schedules  /shoes  /sponsor  /training-plan  /training-summary
  /verify  /legal  + auth callbacks
```

**Three of six mobile tabs are social plumbing** (Forum, Connections, Messages)
— features for people already embedded. Meanwhile Groups & Clubs and the entire
training product have **zero** mobile presence.

**`TrainingPlanDetailPage` is a hidden hub.** Six features hang off it and
nowhere else: Shoes, Pace calculator, Recurring schedules, Training summary,
Coach directory, Coach roster. And `/training-plan` itself has no nav entry.
A coach who signs up cannot find their own roster.

**`/personal-runs` has zero inbound links.** It is unreachable dead code.

### Proposed structure

Kimbio is two products sharing one flat tab bar that only fits the first.

```
COMMUNITY                    TRAINING
 events, groups, races,       plans, coaches, shoes,
 routes, forum                summary, calculator

BOTTOM (5)  Home · Events · Groups · Training · You     ← RESOLVED (D1)
```

- **Home** — the orientation page that doesn't exist yet (§2).
- **Events** — DepartureBoard discovery.
- **Groups** — currently sidebar-only, invisible on mobile. It is the single
  strongest retention surface you have and it isn't in the tab bar.
- **Training** — a real hub page surfacing the six orphans as visible cards.
- **You** — profile, settings, my runs, connections, messages, notifications,
  submissions. Messages and Connections belong here: they are relationship
  management, not discovery.

**Role-conditional sidebar entries**, rendered only when the account has the
role: Sponsor dashboard, Coach roster, Admin. These exist and are invisible.

This changes one nav model and adds one hub page. **It does not touch a single
feature already built** — it makes them findable.

---

## 4. Per-audience journey audit

| Audience | Journey today | What's missing |
|---|---|---|
| **Interested person** | Marketing → signup → board of events | No proof of life before signup. No "join a group" anywhere in the flow. |
| **New runner** | Board → RSVP → nothing | No next step after first RSVP. No onboarding, no cohort, no "you're in." |
| **Community person** | Wants Groups; sidebar-only | Invisible on mobile. `/my-groups` redirects to a tab param — no distinct surface. |
| **Athlete** | No path to training at all | Six training features, zero front doors. |
| **Coach** | Directory linked from one page | Cannot reach own roster. No coach identity in nav. No verification tier surfaced. |
| **Sponsor** | Marketing → inquiry → Stripe | Journey ends at payment. No dashboard, no proof of delivery, no renewal. |
| **Administrator** | `/admin`, 1,436 lines | No nav entry. Moderation queue invisible until a URL is typed. |

The consistent gap: **every journey terminates instead of continuing.** RSVP
ends. Payment ends. Signup ends. Nothing hands the user to the next step.

---

## 5. Monetization is one-eighth built

`src/server/payments.ts` monetizes exactly one thing: **sponsor day-rates**
(featured/standard tiers, date-range capacity, Stripe Checkout, webhook
activation). That part is real and well built.

Everything else that should be paid is not wired:

- **Coaching** — coach/athlete relationships, plan authoring, roster management
  all exist. No payment path. This is the most obvious revenue line in the
  product and it's free.
- **Event fees** — `DepartureBoard` renders a `priceCents` badge and
  `startCheckout` throws "not built yet." The UI promises a paid path that has
  no backend.
- **Memberships / club dues** — Columbia Track Club is a real org with real
  dues. No surface.
- **Sponsor dashboard** — sponsors pay and then have no logged-in view of what
  they bought, impressions, or when it expires.

**Recommendation:** do not build all four. Build **coaching payments** next —
the relationship model, consent flow, and roster already exist, so it's the
shortest path from built-to-billable. Remove the `priceCents` badge from the
event card until event fees are real; a price that can't be paid is worse than
no price.

---

## 6. Messaging — the specific complaint

967 lines. It is **not** missing formats. It already has photo attachments,
emoji, typing indicators, reactions, drafts, and a report/leave flow. The
feature set is competitive.

**The scroll bug is real and locatable:**

```ts
useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); },
  [messages.length]);
```

Three defects in one line:

1. **`behavior: "smooth"` on initial load.** Opening a thread animates a scroll
   through the entire history instead of starting at the bottom. Use `"auto"`
   on first paint, `"smooth"` only for messages arriving while open.
2. **Keyed on `messages.length`.** An edit, a reaction, or a deletion doesn't
   change length, so the view doesn't correct. A deletion *reduces* length and
   fires a scroll-to-bottom while the user is reading history.
3. **No scroll anchoring.** Reading older messages when a new one arrives yanks
   you to the bottom. Standard fix: only auto-scroll when already within ~100px
   of the bottom; otherwise show a "New messages ↓" pill.

Plus `h-full overflow-y-auto` on the list inside a page shell that doesn't
guarantee a bounded height — that's the "scrolling doesn't work properly."

**So messaging isn't underbuilt. It's untested.** Which matches the pattern
everywhere: the features exist, the interaction details were never exercised.

---

## 7. Why pages "look hideous"

Two mechanical causes, both fixable systematically rather than page-by-page.

### 21 of 41 pages are `max-w-md`

448px, centered, on a 2,560px monitor. On desktop these read as a phone
screenshot floating in white space. Affected: Admin, Settings, Forum, Messages,
Profile, Events, EventDetail, Login, Connections, RunnerProfile, Verify,
Checkin, Sponsor ×2, and more.

**Fix:** one `PageShell` component with three widths — `narrow` (forms, auth),
`standard` (feeds, detail), `wide` (admin, forum, messages) — and replace every
hand-rolled `mx-auto w-full max-w-md px-4` with it. That single change fixes
desktop across half the app.

### 322 non-brand color uses

Your palette is `#14171C` and `#FF5741`. The codebase has 113 emerald, 108
amber, 75 rose, 26 sky. Some are legitimately semantic (verified badges, waiver
status) — but 322 is not semantic use, it's drift. Rainbow chips on white cards
is exactly what reads as "cartoonish."

**Fix:** define semantic tokens (`--status-ok`, `--status-warn`,
`--status-danger`) and allow color *only* through them. Everything else becomes
ink, coral, or slate.

### Worked example: `PersonalRunsPage`

25 lines, entire JSX on one unbroken line, `max-w-md`, an emerald kicker
(brand violation), no empty state, no loading state — and **zero inbound
links**. It is simultaneously the worst-looking page and unreachable.

Delete it, or fold it into My Runs as a "private run" toggle. It should not
exist as a standalone route.

---

## 8. "It has to have every tool Strava/Garmin have"

Push back on this directly: **that framing loses.** Strava has 100M users and a
decade of engineering. Feature parity is not achievable and not the point.

What Strava, Garmin, Facebook, and Instagram all structurally cannot do:

- Tell you **which group run is happening Tuesday at 6 in Columbia** and who's
  going.
- Let a **local club** manage membership, waivers, verification, and dues.
- Connect a **local coach** to a local athlete with a real consent model.
- Let a **local business** sponsor a real run and reach real local runners.

That is Kimbio's defensible position: the **local layer** none of them serve.
Your own marketing copy already says this ("the local layer," "city-scoped,"
"real verification"). The product should commit to it rather than chase parity.

The correct integration posture is **import, don't rebuild**: let runners
connect Strava/Garmin so their logged runs appear on their Kimbio profile, and
spend your engineering on the group, club, coach, and sponsor layer that nobody
else touches. Note the old provider-connection route was removed — rebuilding
it as *read-only import* is worth doing; rebuilding activity tracking is not.

---

## 9. Sequenced plan

Ordered by what unblocks the most, not by what's most broken.

**Phase 1 — Structure (do first; everything else depends on it)**
1. Nav restructure: 5 tabs, Training hub page, role-conditional entries.
2. Home page at `/` for signed-in users — orientation, not a board.
3. Resolve the `/` vs `/events` guest contradiction; add live events to marketing.
4. Delete `/personal-runs`; fold into My Runs.

**Phase 2 — Systemic visual fixes (mechanical, high leverage)**
5. `PageShell` with three widths; replace 21 `max-w-md` pages.
6. Semantic color tokens; retire the 322 ad-hoc color uses.
7. Fix the messaging scroll (three defects in §6).

**Phase 3 — Journey completion**
8. Post-RSVP next step; post-signup onboarding.
9. Sponsor dashboard (the paid journey currently ends at checkout).
10. Coach roster and identity in nav.

**Phase 4 — Revenue**
11. Coaching payments — shortest path from built to billable.
12. Remove the unpayable `priceCents` badge until event fees exist.

**Phase 5 — Depth**
13. Strava/Garmin read-only import.
14. Route decoder, event-type classification, verification tiers.

**Explicitly deferred:** streak challenges, run-buddy discovery, welcome
cohorts, affiliate/gear, PDF export, coach audio. All are growth and depth
features stacked on a structure that can't surface what exists. They are not
wrong — they are premature.

---

## 10. Two decisions needed before building

1. **Is Training a peer of Events in the tab bar, or secondary under You?**
   This is positioning, not design, and the whole nav depends on it.

2. **Is `/events` public or gated?** Right now the funnel both sells at `/` and
   gives the product away at `/events`. Pick one.
