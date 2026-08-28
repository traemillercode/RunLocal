# Kimbio — Launch Readiness

Written for the situation you're actually in: **100+ people waiting, and one
shot at a first impression.** Covers what the other five documents don't —
instrumentation, feedback, sponsor price management, marketing, and the gaps
nobody has named yet.

Measured against `d009a2e`. Slots in as **Phase 0.6–0.9** and a new
**Phase 1.7**.

---

## 1. The four things that will actually sink the beta

Not the ugliest problems — the ones that lose users permanently.

### 1.1 — You have no analytics. None.

`src/lib/analytics.ts` is 72 lines and does exactly four things:
`getConsent`, `setConsent`, `captureUtmFromUrl`, `getStoredUtm`.

**It captures UTM parameters and nothing else.** No page views, no events, no
funnels, no error tracking, no session replay. There is a cookie consent banner
gating analytics that do not exist.

You asked whether every click could be traceable during a 3-month beta. Right
now **zero clicks are traceable.** If 100 people join and 60 drop off, you will
have no idea where. Not "imprecise idea" — none.

**This is the single highest-priority item in any of these documents**, because
every other prioritization decision for the next three months depends on data
you are currently not collecting. Ship it before the beta, not during.

### 1.2 — You have no product feedback channel.

Searching for feedback surfaces returns `RunnerFeedbackSheet` — which is **peer
rating** (trust tags, concerns, community standing). Valuable, unrelated.

There is **no way for a user to tell you the app is broken.** Your 100 beta
users will hit the empty icons, the bottom-nav collision, and the `3+4=7` cell,
and their only recourse is texting you personally. That doesn't scale past about
ten people and it means the reports never aggregate into a priority order.

### 1.3 — Sponsor prices are hardcoded in the source.

```ts
// src/server/payments.ts:35
export const SPONSOR_DAY_RATE_USD = { featured: 25, standard: 10 } as const;
```

The comment says "easy to change here." It's easy for *you*, in an editor, with
a deploy. It is not manageable as a business.

Directly answering "can I manage changes to sponsor costs": **no.** Changing a
price means a code edit, commit, push, build, and deploy. You cannot run a
promotion, price a annual deal, offer a nonprofit rate, or raise prices without
shipping software. And any in-flight booking is repriced retroactively, because
nothing stores what the sponsor was actually quoted.

That last part is the real defect. **The price is not captured on the booking.**
If you change the rate, historical bookings recompute at the new number, which
breaks your records and any dispute.

### 1.4 — There's no error tracking.

No Sentry, no equivalent. A runtime error in production is invisible unless a
user reports it — and per §1.2, they can't. During a beta this is the difference
between fixing a crash in an hour and finding out about it in a month.

---

## 2. Beta instrumentation — what to build

You asked for click-level traceability. Here's the concrete shape.

### 2.1 — Event taxonomy, not "track everything"

Tracking every click produces noise you'll never analyze. Track the **journey
stages**, so a funnel falls out of the data:

```
DISCOVERY     app_opened · marketing_viewed · event_viewed · event_detail_opened
ACTIVATION    signup_started · signup_completed · verification_submitted
              verification_approved
FIRST VALUE   first_rsvp · first_checkin · group_joined
RETENTION     rsvp_created · rsvp_cancelled · run_logged · returned_7d · returned_30d
TRAINING      plan_viewed · plan_created · coach_requested · workout_completed
SOCIAL        message_sent · forum_post · connection_made
MONEY         sponsor_inquiry · checkout_started · checkout_completed
FRICTION      error_shown · empty_state_shown · dead_end_reached · rage_click
```

The **FRICTION** group is what answers "where do people get stuck," and it's the
one most teams forget. `dead_end_reached` fires on any screen with no forward
action — which, per the Structural Audit, is most of them today.

### 2.2 — Tooling

**PostHog**, self-hostable or cloud. It gives you product analytics, funnels,
**session replay**, and feature flags in one tool. Session replay is worth more
than every other item here combined for a 3-month beta: you will *watch* someone
fail to find the training page instead of theorizing about it.

Add **Sentry** for errors. Both are small integrations and both should be in
before the first invite goes out.

Respect the consent banner you already built — it currently gates nothing.

### 2.3 — The three metrics that matter for this beta

Don't build a dashboard. Watch these:

1. **Signup → first RSVP conversion.** The core activation event. If someone
   never RSVPs, nothing else matters.
2. **Day-7 return rate.** A local running app lives or dies on weekly rhythm —
   if they don't come back for next Tuesday, they're gone.
3. **Median time to first RSVP.** Measures whether the navigation restructure
   worked. Should fall sharply after Phase 1.

---

## 3. Feedback — one place, in the product

### 3.1 — A persistent, contextual feedback affordance

Not a form buried in Settings. A control available on **every** screen that
captures context automatically:

```
What's not working?

[ Something's broken ]  [ Confusing ]  [ Idea ]  [ Praise ]

Tell us more…
                                              [ Send ]

Automatically attached: page, route, role, device, app version,
last 3 actions, screen size, any error on screen.
```

The auto-attached context is what makes this usable. "The button doesn't work"
is useless; "the button doesn't work, `/training-plan`, coach role, iPhone 14,
after tapping Add run" is a bug report you can act on.

Route it into the **admin unified queue** (Admin Spec §3.2) so feedback lands in
the same place as moderation. One inbox.

### 3.2 — Beta cohort tagging

Tag the first 100 accounts as `beta_cohort_1`. It lets you filter analytics to
them, message them as a group, and treat their feedback with more weight than a
later drive-by signup.

### 3.3 — Structured check-ins beat waiting

Passive feedback under-reports badly — people quietly leave rather than
complain. At day 7 and day 30, ask three questions in-app: what did you use it
for, what almost made you stop, what's missing. Three questions, one screen.

---

## 4. Sponsor pricing — making it a business, not a constant

### 4.1 — Move rates into CMS settings

You already have `src/server/cms.ts` with admin-managed settings and a working
CMS admin surface. Sponsor rates belong there:

```ts
sponsorRates: {
  featured: { dayRateUsd: 25, minDays: 7 },
  standard: { dayRateUsd: 10, minDays: 7 },
}
```

Editable from `/admin/sponsors`, audited like every other CMS change.

### 4.2 — Snapshot the price on the booking *(the important one)*

Add to the sponsor record: `quotedDayRateUsd`, `quotedTotalUsd`,
`quotedAt`, `rateVersion`.

The booking is priced from the snapshot, forever. Change the rate tomorrow and
existing bookings are untouched. Without this, every price change silently
rewrites financial history — and that's not a UX problem, it's an accounting one.

### 4.3 — What a real sponsor business needs

- **Discount codes / promo rates** — you will want to give the first three
  Columbia businesses a founding rate.
- **Nonprofit and club rates** — a running store and a hospital shouldn't pay
  the same.
- **Longer-term packages** — monthly and seasonal, not just day rates. Day rates
  make sense for one-off events; a local shoe store wants a season.
- **Sponsor dashboard** — already in Roadmap §3.5. They pay and currently get no
  logged-in view at all.
- **Proof of delivery** — impressions, clicks, dates ran. Without it, renewal is
  a conversation about vibes, and local sponsors renew on evidence.

---

## 5. Marketing page — does it make sense?

### 5.1 — The copy is genuinely good

"Running alone is optional," "Every run, on your terms," "the local layer,"
"City-scoped · Human-reviewed · Private by default." That's specific, honest,
and differentiated. Don't rewrite it.

### 5.2 — The images are the problem

Ten stock photos: `hero-marathon-crowd.jpg`, `trail-misty-forest.jpg`,
`trail-jump-fisheye.jpg`, `race-legs-closeup.jpg`.

None of them is Columbia. A marathon crowd and a misty forest are the visual
language of **every running app** — they say "generic fitness product," which is
the exact opposite of your positioning. A fisheye trail jump is an *action
sports* image; your product is about a Tuesday evening group run.

**This matters more than usual for you.** Your entire claim is "we are local and
they aren't." Stock photography contradicts that claim on the first screen, and
your audience is 100 people who will recognize whether the trail is theirs.

**Fix:** photograph real Columbia runs. MKT Trail, Stephens Lake, Stankowski
Field, Flat Branch. Real Columbia Track Club members. Ten decent phone photos of
actual local runs beat ten polished stock images, because a Columbia runner
recognizes the location instantly and everyone else reads it as authentic. Ask
the 100 waiting people — several will have photos already.

Interim: cut to three or four images, drop the fisheye and the marathon crowd,
and lead with the **live event board** instead of a photo (Roadmap 1.4). Real
data beats stock imagery.

### 5.3 — Icons

> **CORRECTION — premise void.** See Master Roadmap 0.1. There are **zero**
> undefined icon names; all 42 were rendered and inspected. The "cheapest
> credibility fix in the entire backlog" framing below does not apply, and the
> budget it implied has been reallocated to 0.6 (analytics).

~~Covered in Roadmap Phase 0.1 — **139 call sites render empty SVGs**, including
`check`, `chevronRight`, `close`, `plus`, and `settings`. Fix the icon set
before any invite goes out. It's the cheapest credibility in the entire
backlog.~~

---

## 6. What's still missing that nobody has named

Reading the whole product as a new user would:

**6.1 — There's no "what is this" for a first-time signed-in user.** They land on
a board of events with no orientation. Roadmap 1.2 addresses the page; the
*first-run* experience is separate and unbuilt.

**6.2 — No invite mechanism.** You have 100 people waiting and no way to invite
them as a batch, no referral link, no "bring a friend." For a community product,
invitation *is* the growth model. `/invitations` exists server-side — check
whether it's surfaced.

**6.3 — No email lifecycle.** Resend is verified and sending. What sends? A
welcome email, a "your run is tomorrow" reminder, and a weekly "what's happening
in Columbia" digest are the three highest-retention emails for a local events
product. A run reminder the evening before is the single highest-value
notification you can build.

**6.4 — No offline or poor-signal handling.** A service worker exists and
precaches the shell. But a runner at a trailhead with one bar needs the event
details they already loaded. Test the app on a throttled connection before beta.

**6.5 — No moderation SLA.** With 100 users, submissions and reports will arrive
faster than one person checking a URL-only admin page. Roadmap 1.6 and the Admin
Spec cover the tooling; you also need a rule — "reviewed within 24h" — or the
queue silently becomes a graveyard.

**6.6 — No status or changelog surface.** During a beta, users who report
something need to see it acknowledged. A simple "what changed this week" page
converts frustrated testers into invested ones. This is cheap and it's the
difference between a beta that generates goodwill and one that burns it.

**6.7 — No data export or account deletion path surfaced.** `retention.ts` and a
purge tool exist server-side. GDPR/CCPA aside, this is a trust signal for a
product whose pitch is "private by default."

---

## 7. Does this hit the local-community niche?

Yes — the *concept* does, and it's genuinely differentiated. Nothing else tells
a Columbia runner which group run is happening Tuesday at 6 and who's going.

But be clear-eyed about what those 100 people will experience today:

- They can't find the training features (24 orphaned routes)
- Half the icons are invisible (139 call sites)
- Text hides behind the nav on 15+ pages
- Half the app renders at phone width on desktop
- They have no way to tell you any of this

**The concept will survive that. The first impression may not.** Those 100
people are your best and cheapest distribution, and they are a one-time
resource — you don't get a second first impression with the same group.

**Recommendation: stage the beta.**

Invite **10 first**, from the most forgiving group (Columbia Track Club
regulars who already know you). Watch the session replays. Fix what actually
breaks — which will not be what any of us predicted. Then invite the remaining
90 with the fixes in.

Ten people who feel heard become advocates. A hundred people who hit the same
wall become a hundred people who tried Kimbio once.

---

## 8. Roadmap placement

**Phase 0 additions — before any invite:**

- **0.6** PostHog + Sentry, event taxonomy (§2.1). *Blocks everything: without
  it the beta produces no learning.*
- **0.7** In-app feedback with auto-context (§3.1), routed to the admin queue.
- **0.8** Sponsor rate snapshot on booking (§4.2). Small change, prevents
  rewriting financial history.
- **0.9** Marketing images — cut stock to four, or shoot real Columbia photos
  (§5.2).

**Phase 1 addition:**

- **1.7** First-run experience: welcome, one orientation moment, invite
  mechanism (§6.1–6.2).

**Phase 3 addition:**

- **3.6** Sponsor rates into CMS, promo codes, term packages (§4.1, §4.3).

**Operating rule for the beta:** stage 10 → fix → 90 (§7).
