# Kimbio — Competitive & Technical Gaps

The things the other six documents don't cover. Measured against `d009a2e`.
Ordered by how much each one costs you.

---

## 1. You are invisible to Google, and that's a strategy problem

`BrowserRouter` — good, real URLs. But:

- **No SSR and no prerendering.** `vite.config.ts` and `serve.ts` have neither.
  Every route ships an empty `<div id="root">` and hydrates client-side.
- **One global `<title>`** — `Kimbio — Columbia, MO` — for all 44 routes. No
  `document.title` updates, no per-route meta.
- **No `robots.txt`, no `sitemap.xml`.**
- **No Open Graph or Twitter card tags**, so every link shared to a group chat,
  Instagram story, or Facebook post renders as a bare grey URL.

### Why this is strategic, not technical

Your entire thesis is the *local* layer. The highest-intent user in the world
for Kimbio is someone typing **"group runs columbia mo"** or **"running club
near me"** into Google. That is free, permanently compounding, perfectly
targeted demand — and it's the one acquisition channel Strava and Garmin
structurally cannot own, because they have no local pages.

Right now Google sees an empty div. You are invisible for the exact query your
product was built to answer.

Every local-community product that has worked — Meetup, Nextdoor, Eventbrite —
won on local SEO. Not on features.

### The geofence blocks this today, even once you prerender

`/events` is **not** in `GEOFENCE_BYPASS_PATHS`. Google crawls from datacenters,
not Columbia — so the crawler hits the geofence wall and indexes nothing, no
matter how good the prerendered HTML is.

**Prerendering without fixing the bypass accomplishes nothing.** Do them
together: add the public read routes to the bypass, keep the geofence on write
actions (which is what it actually protects). See Master Roadmap **D2**.

### What to do

Prerender the public routes only: `/`, `/demo`, `/events`, `/events/:id`,
`/groups`, `/groups/:id`, `/races`, `/routes`. That's a static-generation step at
build time, not a migration to Next.js — the app stays a SPA behind auth. Add
per-route `<title>`/meta, OG tags, `robots.txt`, a generated `sitemap.xml`, and
`Event` / `Organization` JSON-LD structured data so events can appear as rich
results.

Sharing matters as much as search: **OG tags are how a Tuesday run gets posted
to a club's Facebook group and looks like something.** Today it looks like spam.

---

## 2. The bundle is 1.32 MB, shipped to runners on mobile data

```
dist/assets/index-DwB8XFu7.js   1,324.84 kB │ gzip: 350.34 kB
dist/assets/index-*.css            97.64 kB │ gzip:  22.33 kB
```

One chunk. No route splitting, no lazy loading — the build itself warns about it.

350 KB gzipped before any data loads, on a phone at a trailhead with two bars,
is several seconds of blank screen. And the users who most need it to be fast —
someone checking the meeting spot while walking to their car — are on the worst
connections.

**Fix:** `React.lazy` per route. Admin (1,436 lines), Forum (1,494), Settings
(1,132), and Messages (967) are 36% of the app and are loaded by a minority of
users on any given visit; none of them belongs in the first-paint bundle. This
is a small change with a large effect and it pairs naturally with the Phase 1
route restructure.

---

## 3. No push notifications — so no run reminders

`Notification.requestPermission()` is called in Settings, but there is **no
`pushManager`, no subscription, no push handler in `sw.js`.** The permission is
requested and then nothing can be sent.

For an events product, the single highest-retention message is *"your run is
tomorrow at 6."* Right now you cannot send it. Email (Launch Readiness §6.3) is
the faster path and should come first, but web push on the PWA you already have
is the one that actually gets read.

Also worth noting: asking for notification permission when nothing can be sent
burns the permission. Users who decline once are hard to re-ask.

---

## 4. Time is a free-text string, and it will break you at city #2

```ts
// src/types.ts:92
time: string; // "6:00 PM"
```

No timezone anywhere in the event model. The only `timeZone` usage in the
codebase is hardcoded `"UTC"` in `weeklyPlanEmail.ts`.

This works while Kimbio is Columbia-only. The moment you add a second city —
which the marketing page already promises ("More cities, same local feeling") —
you have events whose start time is a string with no zone, rendered to users who
may be anywhere.

It also blocks correct `.ics` export, correct reminder scheduling, and any
sorting by actual start instant rather than by string.

**Fix now, while there are seven events.** Store `startsAtUtc` plus the city's
IANA zone; keep the display string derived. Migrating seven records is trivial;
migrating seven thousand is not. This is the cheapest it will ever be.

---

## 5. Accessibility has never been audited

Nothing in the test suite checks it, and the visual audit already surfaced
failures: `text-[8px]` and `text-[9px]`, and `h-10` touch targets below the 44px
minimum in 50 places. Both remain valid.

> **CORRECTION.** ~~139 icon-only controls rendering empty SVGs — which for a
> screen reader means a button with no accessible name at all.~~ This leg is
> **void**: there are zero undefined icon names (see Master Roadmap 0.1). The
> underlying a11y concern may still be real — icon-only buttons need an
> `aria-label` whether or not the glyph paints — but it must be **re-derived
> from actual missing labels**, not inherited from this finding.

This isn't only compliance. Running clubs skew older than tech products
generally; RRCA-chartered clubs include a lot of masters runners, and your own
seed data has a "walkers welcome" run. Small grey type on a phone in the dark
before a 6am run is a real usability problem for a real share of your audience.

**Minimum bar before beta:** every interactive control has an accessible name,
contrast meets AA, focus is visible everywhere (`.kb-focus` exists in
DepartureBoard — generalize it), and nothing below 11px. Add `axe` to the test
suite so it can't regress.

---

## 6. Safety is your strongest differentiator and it's half-built

You have: verification, waivers, safety reports, trust ratings, concerns,
geofencing, private-by-default. That is genuinely more than Strava, Meetup, or a
Facebook group offers — and Strava has a well-documented history of *creating*
safety problems with public activity data.

What's missing for people meeting strangers at dawn:

- **Share-your-run** — send a live or after-the-fact "I'm at this run" to a
  chosen contact. Strava has Beacon; a local group-run product needs it more.
- **Emergency contact** on the profile, visible to a group lead at check-in.
- **Meeting-point clarity** — a map pin and a "look for the group by the
  fountain" note. `location` is currently free text.
- **First-timer signal** — a lead knowing someone is new changes how the run
  goes, and it's the difference between a person returning and not.
- **Report from anywhere**, not only from a profile.

**Frame this as marketing, not compliance.** "Verified runners, real names,
someone knows where you are" is a reason to choose Kimbio over a Facebook group,
and it matters disproportionately to women runners — a large share of the market
that every existing platform underserves.

---

## 7. Search is per-page and can't answer real questions

Four separate search boxes exist (Events, Connections, Messages, plus a
"Search runs, routes, or groups" field on EventsPage). There is no global
search, and none of them answers what a runner actually asks:

> "Is there a run tomorrow morning near downtown that isn't too fast?"

You now have the data to answer that — day, time, location, distance, and
`pacePolicy`. **Filtering is worth more than search here**: day, time of day,
pace policy, distance range, and area, applied to the DepartureBoard. Filters
work when you don't know what to type, which is the state a new runner is in.

Global search matters later, at more cities and more content.

---

## 8. No offline resilience for the one moment it matters

The service worker precaches the shell, which is correct. But event *data* isn't
cached, so a runner at a trailhead with no signal gets an app shell and a
spinner — at exactly the moment they need the meeting spot.

**Fix:** stale-while-revalidate for this week's events and the user's RSVPs.
Show cached data with a "last updated" note rather than a spinner. Small change,
and it's the difference between the app being useful at the trailhead and not.

---

## 9. Where Kimbio actually wins

Worth being explicit, because it should drive what gets built:

| | Strava | Garmin | Facebook Group | Meetup | **Kimbio** |
|---|---|---|---|---|---|
| Which run is Tuesday at 6 | ✗ | ✗ | ~ | ✓ | ✓ |
| Who is going | ✗ | ✗ | ~ | ✓ | ✓ |
| Pace policy up front | ✗ | ✗ | ✗ | ✗ | **✓** |
| Verified real identity | ✗ | ✗ | ~ | ✗ | **✓** |
| Club membership + waivers | ✗ | ✗ | ✗ | ~ | **✓** |
| Local coach ↔ athlete | ✗ | ✗ | ✗ | ✗ | **✓** |
| Local business sponsorship | ✗ | ✗ | ✗ | ✗ | **✓** |
| Activity tracking | ✓✓ | ✓✓ | ✗ | ✗ | ✗ (import) |
| Training plans | ~ | ✓ | ✗ | ✗ | ✓ |

**Your real competitor is not Strava. It's the Columbia Track Club Facebook
group and a group text.** That's what a Columbia runner uses today. Beat that —
which is a low bar on structure and a high bar on reliability — and Strava
becomes an integration, not a rival.

The four rows nobody else has are pace policy, verified identity, club
infrastructure, and the local coach/sponsor economy. Those should get
disproportionate investment. Anything that makes Kimbio more like Strava should
be viewed with suspicion.

---

## 10. Roadmap placement

**Phase 0 (before beta):**
- **0.10** Route-level code splitting (§2) — small change, large effect
- **0.11** Accessibility minimum bar + `axe` in CI (§5)

**Phase 1:**
- **1.10** Timezone-correct event times (§4) — *do it now, at seven events*
- **1.11** Filters on the DepartureBoard: day, time of day, pace, distance (§7)

**Phase 2:**
- **2.12** Prerender public routes, per-route meta, OG tags, sitemap,
  JSON-LD (§1) — **the highest-leverage growth work in any of these documents**

**Phase 3:**
- **3.7** Safety layer: share-your-run, emergency contact, map pins,
  first-timer flag (§6) — differentiator, not compliance

**Phase 4:**
- **4.6** Web push + the email lifecycle (§3)
- **4.7** Offline data caching (§8)
