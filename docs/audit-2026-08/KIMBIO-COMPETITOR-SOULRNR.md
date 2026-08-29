# Competitive Teardown — SOULRNR RUN CLUB

Jefferson City, MO. Novara, LLC. Native iOS, TestFlight build 1.0 (18), released
**Aug 25 2026** — four days old. 11 MB. Reviewed from a 3-minute walkthrough,
30 frames.

They are ~40 miles from Columbia and they are further along on depth than we
are. Worth taking seriously and worth reading correctly, because the obvious
lesson ("match their features") is the wrong one.

---

## 1. What they built

**Auth** — passwordless. "Send me a code," 6-digit, explicitly *"No passwords.
No links."* Three taps from cold start to inside the app.

**Onboarding that manufactures commitment.** Not a feature tour:

> **Who are you becoming?**
> What should your coach call you? · Your identity statement
> Tap-to-fill: "I am becoming someone who shows up" · "I am a runner — slow is
> not weak" · "I train my body, mind, heart, and spirit"
> Distance units → **Begin the practice**

**Nav: HOME · RUN · TRAIN · CLUB · PROGRESS · MORE.** Six tabs. Note that TRAIN
is a peer tab, not buried.

**Live GPS tracking** — map, GO TIME, running timer, miles, pace, ft climbed,
FINISH & KEEP RUN.

**Per-run privacy toggle** — Visible / Club only / **Private**, with the copy
*"your location never leaves this phone. You still appear in the roster."*

**"ON THE COURSE"** — who is running right now, live, with current distance.

**Post-run reflection** — 1–5 (Heavy/Low/Steady/Good/Alive), an energy slider,
mood chips (calmer, clearer, grateful, strong, spent, lighter), and *"What did
the miles teach you?"* → Keep this reflection · Share this run.

**AI coach** — *"Ask anything. Training, pacing, race prep, showing up. Your
coach knows your recent miles."* Contextual, not generic.

**Training plans** — "First 5K," day-by-day with checkboxes, `0/24 SESSIONS
DONE`, real prescriptions ("Walk 5 min, then run 1 min / walk 90 sec ×8").

**Club leaderboard** — "Founding Miles," ranked, *"Consistency wins — this board
resets every Sunday."* Plus Chat / This Week / Challenges / **Passport** tabs.

**Education library** — Types of Runs & RPE (Zone 2 RPE 3–4 … Speed/Intervals
RPE 8–10), Dynamic Warm-Up, Breathing Guides, Proper Running Form, Static
Stretching, Courses.

**Apple Health / Apple Watch** integration. **Friday reminders** — *"Lay out
your shoes, show up Saturday."* **HYROX Performance Hub.**

**Foundational Partners** — Supplement Superstore, Fleet Feet, Hollon
Chiropractic: *"Businesses that build this club with us."*

**Membership — BELIEVE · BUILD · BECOME**, framed as *"Where you are on the
journey."*

---

## 2. The error, and it's the most useful thing in the video

**GPS recorded nothing.** The run finished at `0.00 MILES / 0:08`, `PACE —`,
`FT CLIMBED —`, and a panel reading **"No route recorded."**

It gets worse in public. The Founding Miles leaderboard shows **two of four
members at 0.00 mi**. Their core feature failed, and the failure is displayed on
a shared board with names attached.

Their AI coach handled it with real grace — it noticed a zero-mile entry
alongside a 5/5 "calmer" rating and said the watch may have missed it, asking
what actually happened. Good design under failure. But no amount of graceful
copy fixes a run tracker that doesn't track runs.

### Three lessons

**1. Do not build GPS tracking.** This validates Competitive Gaps §9 with direct
evidence. Background location on iOS is genuinely hard, it fails silently, and
when it fails on a social leaderboard it is humiliating in public. Import from
Strava and Apple Health instead. Let someone else own the hard part.

**2. Never let an unverified number onto a shared board.** A private 0.00 is a
bug; a public 0.00 next to your name is a reason to stop opening the app.
Anything on a leaderboard needs a provenance rule — imported and confirmed, or
it doesn't rank.

**3. Their cold start is visible.** Four people, two at zero. Launching a
leaderboard before there is volume advertises emptiness. Ours should stay off
until there is enough activity to look alive — which is another argument for
keeping challenges in Phase 7.

---

## 3. The strategic read — do not copy this

**SOULRNR is a single-club vertical app.** One club, one philosophy (The SOUL
Approach™), one coach, one partner set, one city. Deep, opinionated, coherent.

**That model does not scale across clubs.** Columbia Track Club can't use it.
Neither can Fleet Feet's Thursday group or a trail crew — each would need its
own app, its own build, its own TestFlight.

**Kimbio is the horizontal layer they can't be.** Many clubs, one city, one
account, one discovery surface.

But here is the uncomfortable part: **SOULRNR sets the depth bar for what a club
experience should feel like, and a Kimbio club currently feels like a directory
entry.** If Columbia Track Club compares its Kimbio page to what SOULRNR gives
its members, we lose on feel.

**So the strategy is: platform reach, club-level depth.** Kimbio must let a club
feel as owned as SOULRNR does — its own identity, philosophy, partners,
membership journey — while a runner keeps one account across every club in
Columbia.

That is a real product position, and nothing in the current eight documents
covers it.

---

## 4. What's missing from our docs

Ordered by how much it matters.

### 4.1 — Club identity and theming *(the biggest gap, entirely absent)*

Our docs treat a group as a listing: name, leaders, members, events. SOULRNR
shows what a club actually wants — a philosophy statement, an accent color, its
own partners, its own membership language, its own education content.

Give clubs: an accent color and logo, a mission/philosophy block, club-owned
content, their own partner list, and their own membership tiers. A runner still
has one Kimbio account; each club feels like theirs.

**This is also the moat.** A club that has customized its space doesn't leave.

### 4.2 — Post-run reflection *(absent)*

We store objective plan data — distance, pace policy, completion. SOULRNR
captures **how the run felt**: 1–5, energy, mood chips, free text.

This is the retention loop and it's nearly free to build. It also feeds a real
coach conversation ("you've logged 'spent' four runs running"), and unlike GPS
it cannot fail — the runner is the sensor.

Slots naturally into the Training Calendar Spec's day view.

### 4.3 — Per-run privacy toggle *(absent; better suited to us than to them)*

Visible / Club only / Private, per run, with *"your location never leaves this
phone. You still appear in the roster."*

That copy belongs on a product whose marketing already says "private by
default." We have global privacy settings; per-run control is stronger, and it
pairs exactly with the safety layer in Roadmap 3.7.

### 4.4 — "On the course" live presence *(absent)*

Seeing who is out running right now is the emotional core of their app. Ours
has check-in; it doesn't have presence.

Do this **without GPS**: check in at the meeting point, and the group run shows
"6 runners out now." Presence without location, which is safer, simpler, and
can't fail the way theirs did.

### 4.5 — AI coach *(absent — and it's your self-serve product)*

D4 defined self-serve plans as a static 12-week block. SOULRNR's is
**conversational and context-aware**.

A runner with no human coach paying for a plan *plus* a coach that knows their
recent miles is a materially better product than a PDF-shaped plan, and it's the
same price point. It also feeds the human coach tier rather than competing with
it — AI for the unattached, humans for the committed.

### 4.6 — Education library *(absent)*

RPE zones, warm-ups, breathing, form, stretching. Cheap, high perceived value,
and **it's the best SEO asset you could have** — evergreen content that ranks
and feeds Roadmap 2.12. Nothing else in the backlog does both.

### 4.7 — Apple Health *(our docs say Strava/Garmin)*

Competitive Gaps §6.1 named Strava and Garmin. Apple Health is easier, covers
more users, and aggregates Garmin/Coros/Watch data anyway. Do Apple Health
first.

### 4.8 — Identity-first onboarding *(ours is generic)*

Roadmap 1.7 says "welcome, one orientation moment." Theirs asks who you're
becoming and has you write an identity statement before you see the app.

Whether or not you like the spirituality, the mechanic is sound: a user who has
typed a sentence about themselves is invested. Ours can be secular — "What are
you training for?" — and do the same work.

### 4.9 — Sponsors framed as belonging *(reframes 3.6)*

"Foundational Partners — businesses that build this club with us" is the same
transaction as our sponsor product with completely different meaning. Not an ad
slot; a member of the community.

Adopt the framing. It sells better to local businesses *and* it's less
intrusive to runners — the two things that usually trade off.

### 4.10 — Passwordless auth *(check ours)*

Three taps, no password, no link. Supabase supports email OTP. If we're asking
for a password, we're adding friction they've removed.

---

## 5. On building the app

You asked what's required after a successful web build. The video answers part
of it.

**What actually needs native:** background GPS and HealthKit. That's the list.

**If we don't build GPS tracking — and we shouldn't — the native case gets much
weaker.** Everything else in their app (auth, plans, leaderboards, reflection,
chat, content, club pages) is ordinary web UI in a native shell.

**The real native driver is push notifications on iOS.** Web push works on iOS
16.4+ but only after add-to-home-screen, which most people never do. For an
events product where "your run is tomorrow" is the highest-retention message,
that's the argument — not GPS.

**Recommended path:** PWA first, then a thin native wrapper (Capacitor) that
adds reliable push and HealthKit read, reusing the same web app. Full native
only if a feature genuinely demands it.

And note what SOULRNR is paying for the native path: TestFlight, an 87-day
expiry, build 18 in four days, and every update gated behind review. You can
ship to your 100 people this week.

---

## 5b. Second pass — course builder, achievements, empty states

Additional screens reviewed after the first teardown.

### 5b.1 — The course builder is far cheaper than I estimated *(correction)*

Competitive Gaps and the roadmap both treated route creation `[39]` as
"effectively its own mini design system" and parked it in Phase 7. **That was
wrong**, and their build shows why:

> **Draw it. Load it. Share it.**
> Tap the map to drop the route point by point. Add exercise stops to make it a
> compromised run.
> `0.91 MI` → `1.66 MI` · **Undo point** · Course name · Description ·
> Exercise stops (at mi / exercise / reps) · **Share this route**

**Tap to drop points, straight lines between them, live haversine distance, no
snap-to-road.** Leaflet + OpenStreetMap, which is free. The Capitol Compromise
Loop is visibly a hand-drawn rectangle over city blocks — crude on the map, and
nobody cares, because a club route only needs to communicate *where we go*.

Snap-to-road is what made route creation expensive in my estimate. Skipping it
takes this from a major project to a modest one.

**And it solves 6.2 from the other end.** The GPX→SVG decoder exists because
`routePath` is always null. If runners draw routes in-app, **you have the
polyline natively** — no GPX parsing, no projection pipeline. The DepartureBoard
route sliver gets real data as a side effect of a feature people want anyway.

Kimbio's version shouldn't be HYROX stops. It should be **club routes with
waypoints**: water fountain, regroup point, turnaround, the hill everyone
complains about. Same mechanic, right vocabulary.

### 5b.2 — Character-based achievements *(the strongest idea in the app)*

"BECOMING — ACHIEVEMENTS," ten badges, locked and unlocked states:

| Badge | Trigger |
|---|---|
| First Run · First Sunrise | performance |
| One Week Strong · 30-Day Consistency | consistency |
| **Comeback** | *"You returned after time away. The door was always open."* |
| **Encourager** | *"You lifted another athlete with your words."* |
| **Never Left Anyone Behind** | *"You circled back for a teammate on a club run."* |
| **Inner Miles** | *"Ten reflection runs completed."* |
| Faithful Finisher · GO TIME | plan / HYROX completion |

Four of ten reward **character, not speed** — coming back, encouraging someone,
waiting for a teammate. *"Not a streak on a screen — a person becoming."*

**This fits Kimbio better than it fits them.** Their social badges need manual
attestation; Kimbio can award them from data it already has — check-ins, RSVPs,
forum replies, peer trust tags, coach relationships. Comeback is an RSVP after a
gap. Encourager is forum replies received positively. Never Left Anyone Behind
maps onto a no-drop run check-in.

And it sidesteps the leaderboard problem entirely. A mileage board rewards the
fastest and demoralizes everyone else — bad for a product whose seed data
includes "walkers welcome." Character badges reward showing up, which is the
behavior you actually want.

**Reprioritize:** `[31]` streak challenge stays deferred. Character achievements
move up — they need no GPS, no volume, and no cold start.

### 5b.3 — The empty state is a second, separate failure

`PROGRESS` reads:

> **The miles are adding up.**
> **0.00** TOTAL MILES · 1 runs · 0:08 moving

The copy contradicts the data. Below it, ten achievement cards, nearly all
greyed out — a wall of things you haven't done. And `1 runs` is an unpluralized
string.

Roadmap 2.9 defines loading / empty / error states. Add a fourth: **the
first-run state**, where copy must not assert progress that hasn't happened.
"The miles are adding up" over `0.00` is worse than a blank panel, because it
reads as the app not knowing what's going on.

Also: **run history shows `0:08 · —:——/mi · 0.00`.** Honest placeholders, but a
saved run with no distance shouldn't reach history at all — it should be
discarded or flagged, not stored as a real result.

### 5b.4 — They use TestFlight's feedback, not their own

Their Send Feedback is Apple's built-in TestFlight form. That means feedback is
**gated behind TestFlight** and stops working the moment they ship to the App
Store.

Kimbio's 0.7 in-app channel is the better position: it works for every user on
every platform forever, and it captures route, role, and breadcrumbs that
TestFlight can't.

---

## 6. Roadmap changes

**Phase 1**
- **1.12** *(new)* Club identity — accent color, logo, philosophy block,
  club-owned content, partner list (§4.1). The single biggest competitive gap.

**Phase 2**
- **2.13** *(new)* Education library — RPE, warm-up, breathing, form. Doubles as
  the SEO content 2.12 needs (§4.6).

**Phase 3**
- **3.2 amended** — self-serve plan tier includes a **context-aware AI coach**,
  not a static block (§4.5).
- **3.6 amended** — reframe sponsors as **Foundational Partners** (§4.9).
- **3.7 amended** — add **per-run privacy** (Visible / Club only / Private) to
  the safety layer (§4.3).

**Phase 4**
- **4.8** *(new)* Post-run reflection — feeling, energy, mood, free text (§4.2).
- **4.9** *(new)* "On the course" live presence via check-in, **no GPS** (§4.4).
- **1.7 amended** — identity-first onboarding (§4.8).

**Phase 6**
- **6.1 amended** — **Apple Health before Strava/Garmin** (§4.7).

**Phase 0**
- **0.12** *(new)* Verify auth is passwordless email OTP (§4.10).

**Explicitly rejected:** GPS run tracking. Their leaderboard shows two of four
members at 0.00 miles. Import instead.
