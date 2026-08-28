# Kimbio — Self-Updating Demo, Tour & Help

Answers: *is there a demo view, and can it update itself as the platform
changes?* Measured against `d009a2e`. Slots in as **Phase 1.8** and
**Phase 2.11**.

---

## 1. What exists today

A real onboarding tour, already built:

- `src/lib/tour.ts` — 183 lines, `TOUR_STEPS`, pure model (no React/DOM), tested
- `src/components/TourHost.tsx` — the runtime
- `data-tour-target` anchors in BottomNav, Header, DesktopSidebar, EventsPage,
  MyRunsPage, SettingsPage, ProfilePage
- `tests/tour-targets.test.tsx` — asserts the anchors exist in rendered markup
- localStorage marker `runlocal:tour:verified:v2`, replay from Settings

This is better than most products have. Three limits:

**1.1 — Guests never see it.** It's gated to verified runners. There is **no
public demo** — a prospective user must sign up, wait for verification, and then
get a tour. That's backwards for a product asking 100 strangers to try it.

**1.2 — Seven steps, 44 routes.** It covers Events, My Runs, Groups, Forum, and
Settings. Training, coaching, sponsors, routes, races, connections, and messages
have no coverage at all.

**1.3 — It's hand-maintained copy in a const array, and it will rot.** The file's
own docblock is careful about what's "LIVE today" and explicitly says matching,
messaging, and calendar sync are unavailable — but **messaging shipped.** The
tour is already describing the product inaccurately, and the `v2` in the storage
key is a manual bump someone has to remember.

That's not a criticism of whoever wrote it. It's the predictable outcome of
hand-maintained documentation in a fast-moving repo — the same drift that put
`nav-model`, `marketing-page`, and the `/app` path tests into the failing set.

---

## 2. The trap in "make it update automatically"

Be precise about what can and cannot be derived from code, because promising
more than that produces a demo that is *confidently wrong* — worse than one
that's merely stale.

| Derivable from source | Not derivable |
|---|---|
| Which routes exist | Why a runner would care |
| Which nav entry a route belongs to | What order to teach things in |
| Which roles can reach it | What the feature is *for* |
| Whether a tour anchor still exists | Good explanatory copy |
| Whether a route has zero coverage | Whether a step is still accurate |

**Fully generated copy is not the goal.** Prose written by a generator reads as
filler, and users detect it instantly.

The achievable and genuinely valuable version: **a feature registry that is the
single source of truth, plus tests that fail when reality drifts from it.**
Adding a feature means adding one registry entry — and then it appears in the
nav, the tour, the demo, the help index, and the changelog automatically. Forget
to add it, and the build fails.

That is "it fills in and updates the entire platform," implemented in a way that
holds.

---

## 3. The feature registry

Your codebase already proves this pattern works. `src/lib/nav.ts` is a single
source of truth for the bottom bar, sidebar, and account menu, with a shared
`activeForPath()` matcher — built precisely because three parallel definitions
had drifted. The registry is that same idea, one level up.

```ts
export interface Feature {
  id: string;
  route: string;
  /** Nav grouping — Community | Training | Account | Admin */
  area: FeatureArea;
  /** Who can reach it. Drives demo persona filtering and role-gated nav. */
  roles: readonly AccountRole[];
  /** One line, user-facing. The help index and demo caption both use this. */
  summary: string;
  /** Shipping state — the tour must never describe something unbuilt. */
  status: "live" | "beta" | "planned";
  /** Optional walkthrough. Anchors are asserted to exist by tests. */
  steps?: readonly { target: string; title: string; body: string }[];
  /** Where it sits in a journey — powers ordering, not decoration. */
  journey?: "discover" | "join" | "train" | "host" | "sponsor";
}
```

`status` is the field that fixes §1.3. A feature marked `planned` is never
described as available anywhere — the tour, the demo, and the help index all
read the same flag, so the product can't claim messaging is unavailable while
messaging ships.

---

## 4. What renders from it

One registry, six surfaces, none maintained separately:

| Surface | Derived how |
|---|---|
| **Nav** | `area` + `roles` → bottom bar, sidebar, role-gated entries |
| **Onboarding tour** | `steps` filtered by role, ordered by `journey` |
| **Public demo** | `status: "live"` features, no auth required (§5) |
| **Help index** | `summary` grouped by `area` — a real "what can I do here" page |
| **Admin capability map** | `roles` → what each role can actually reach |
| **Changelog** | `status` transitions between releases (§6) |

Add a feature → it appears in all six. That's the answer to your question.

---

## 5. The public demo view

Currently missing entirely, and it's the highest-value piece for a beta with 100
strangers. This also delivers backlog item `[30]` (public sample/demo page).

**Route:** `/demo` — no auth, no geofence, linked from the marketing page.
Consistent with **D2** (public read-only event data), so the demo renders real
Columbia runs with no auth workaround. Add it to `GEOFENCE_BYPASS_PATHS`
alongside the other public read routes.

**Shape: persona-first, not feature-first.** A visitor doesn't want a tour of 44
routes; they want to know if this is for *them*:

```
What brings you here?

[ I want to find runs ]   [ I lead a club ]
[ I'm training ]          [ I want to sponsor ]
```

Each path is 4–6 screens showing **real Columbia data** — actual Tuesday runs,
real hosts, real going counts — in a read-only shell. Not screenshots, not a
video, and not a fake dataset: the live board rendered without write actions.

Two reasons real data beats a mockup. It can't go stale, and it doubles as proof
the community is alive — which is the one thing a local product must establish
before anyone signs up. It's the same argument as putting live events on the
marketing page (Roadmap 1.4).

**Ending:** each path ends with the action for that persona — Join, Claim your
club, Start a plan, Sponsor a run — not a generic signup button.

---

## 6. How it stays honest — the non-drift guarantee

Registry + tests. Four assertions, all cheap, all in CI:

1. **Every route in `App.tsx` has a registry entry.** Add a route without one →
   build fails. This is what prevents the next 24 orphans.
2. **Every `steps[].target` exists in the rendered markup.** You already have
   this pattern in `tour-targets.test.tsx` — extend it to every step, not seven.
3. **No `status: "planned"` feature is described as available** in tour or demo
   copy. Catches the messaging inaccuracy that exists today.
4. **Every `live` feature reachable by a role has a nav path for that role.**
   Catches "built but unreachable" — which is currently the single most common
   defect in this codebase.

Assertion 4 is the one that matters most. It converts findability from something
you audit occasionally into something the build enforces.

---

## 7. Component gallery — the other half of "demo"

Separate from the user-facing demo, and worth having once Phase 2 lands: a
`/dev/gallery` route rendering every design-system primitive — `Button` variants,
`PageShell` widths, the type scale, radius and elevation tokens, the icon set,
list states.

This one **is** genuinely self-updating, because it imports the real components.
Three payoffs:

- The icon gallery makes a missing icon **visibly obvious** — the failure that
  reached 139 call sites would have been caught on sight
- New components get built against the system instead of hand-rolled, which is
  how 251 bespoke button strings happened
- Design review happens on one page instead of 41

Dev-only route, excluded from the sitemap.

---

## 8. Honest cost

This is not free, and it competes with Phase 1 structural work.

| Piece | Effort | Value |
|---|---|---|
| Feature registry + 4 tests | Medium | High — enforces findability forever |
| Public `/demo` | Medium | High — top-of-funnel for 100 strangers |
| Tour migrated onto registry | Small | Medium — fixes the drift |
| Help index from registry | Small | Medium — free once registry exists |
| Component gallery | Small | Medium — prevents future drift |
| Changelog from status | Small | Medium — beta goodwill (Launch §6.6) |

**Sequencing recommendation:** build the registry as *part of* the Phase 1
navigation restructure, not after it. You're already going to define which
features exist, which area they belong to, and which roles can see them — that
work **is** the registry. Doing it as a typed registry instead of a nav array
costs very little extra and gives you the demo, help, and changelog for free.

Doing the nav restructure first and the registry later means defining the same
information twice, which is how you got three drifted nav definitions before.

---

## 9. Roadmap placement

- **Phase 1.1 (amended)** — implement the nav restructure **as a feature
  registry**, not a nav array. Same work, six surfaces instead of one.
- **Phase 1.8** *(new)* — public `/demo`, persona-first, real Columbia data.
  Pairs with 1.4 (live events on marketing) and delivers `[30]`.
- **Phase 1.9** *(new)* — migrate `TOUR_STEPS` onto the registry; add the four
  non-drift tests. Fixes the existing inaccuracy about messaging. Delivers `[36]`.
- **Phase 2.11** *(new)* — `/dev/gallery` component gallery, after the design
  tokens land.
- **Phase 5** — the four registry tests join the suite as permanent guards.

**Consolidates three backlog items:** `[30]` public demo, `[36]` onboarding tour,
and the "training hub navigation" half of `[17]`.
