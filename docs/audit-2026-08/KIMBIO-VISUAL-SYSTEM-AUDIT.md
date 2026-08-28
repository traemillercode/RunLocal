# Kimbio — Visual System Audit

Companion to the Structural Audit and Master Roadmap. Measured against
`d009a2e`. This is the "why does it look like six people built it" layer.

Everything here is counted, not estimated.

---

## 1. The bottom-nav collision — confirmed, and it's 15 pages

You reported that content at the end of a scroll is unreadable behind the nav
and button. It's real, it's measurable, and it's worse than one page.

### What's actually obstructing the viewport

```
BottomNav tabs        min-h-14                          = 56px
Safe-area inset       env(safe-area-inset-bottom)       = ~34px (iPhone)
FAB                   h-14 w-14, absolute top-0,
                      centered — protrudes ABOVE the bar = +28px
─────────────────────────────────────────────────────────────────
Obstruction at edges                                    ≈ 90px
Obstruction at center (under the FAB)                   ≈ 118px
```

### What pages actually reserve

| Padding | px | Pages | Verdict |
|---|---|---|---|
| `pb-32` | 128 | 18 pages | ✅ clears — barely, 10px margin |
| `pb-24` | 96 | 9 pages | ❌ **22px short**; FAB overlaps content |
| `pb-12` | 48 | Checkin | ❌ **70px short** |
| `pb-5` / `pb-4` / `pb-3` / `pb-1` | 4–20 | Routes, Messages, Events, Races, Forum, Settings, MyRuns | ❌ **catastrophic** |
| **none** | 0 | **11 pages** | ❌ **fully obstructed** |

**Pages with zero bottom padding:** DiscoverEventsPage, GroupDetailPage,
GroupManagePage, GroupsPage, LegalPage, MarketingPage, MyGroupsPage,
RouteDetailPage, SponsorInquiryPage, SponsorPaymentPage.

Two of those are the worst possible cases: **DiscoverEventsPage is your signed-in
home**, and **SponsorPaymentPage is a checkout screen** — the last card and the
pay button sit under the nav.

Note the pattern: every newer training page uses `pb-24` (96px), which is *less*
than the 118px the FAB occupies. Whoever set that convention measured the bar
and not the button.

### Fix

This must not be a per-page padding value — that's how you got four conventions
and eleven zeroes.

```css
:root {
  --nav-height: 56px;
  --nav-safe: env(safe-area-inset-bottom, 0px);
  --fab-overhang: 28px;
  --content-bottom-gap: 24px;   /* breathing room, not just clearance */
  --page-bottom-pad: calc(
    var(--nav-height) + var(--nav-safe) + var(--fab-overhang) + var(--content-bottom-gap)
  );
}
```

`PageShell` (Roadmap §2.1) applies `padding-bottom: var(--page-bottom-pad)`
once, and every `pb-*` on a page root gets deleted. Pages without a bottom nav
(auth, wizard routes in `CHROME_FREE_PATHS`) pass `bottomNav={false}` and get
the standard gap instead.

**Also:** any sticky footer action (the pay button, "Save plan") needs the same
offset, or it stacks *on top of* the nav. Give it
`bottom: calc(var(--nav-height) + var(--nav-safe))`.

**Add a test.** This is regression-prone and invisible in code review: assert
every page root uses `PageShell` and no page file contains a raw `pb-` on its
outermost element.

---

## 2. Type scale — two competing systems, 815 arbitrary sizes

```
ARBITRARY PX          TAILWIND SCALE
text-[13px]   311     text-sm     394
text-[11px]   145     text-xs     228
text-[12px]   121     text-2xl     45
text-[15px]    84     text-lg      29
text-[14px]    76     text-xl      28
text-[16px]    36     text-3xl      3
text-[10px]    30
text-[9px]      6
text-[8px]      4
text-[18px]     1
```

**815 arbitrary px sizes running alongside 727 scale utilities.** There are
effectively ten body sizes between 8px and 16px — 8, 9, 10, 11, 12, 13, 14, 15,
16 — which is not a type scale, it's ten one-off decisions.

`text-[8px]` and `text-[9px]` fail accessibility outright and are unreadable at
arm's length mid-run — the exact context this product is for.

### Fix — one scale, six steps, semantic names

| Token | px / line-height | Use |
|---|---|---|
| `--type-kicker` | 11 / 1.2, `700`, `0.14em` | Metric labels, eyebrows |
| `--type-meta` | 13 / 1.4 | Timestamps, secondary rows |
| `--type-body` | 15 / 1.5 | Default reading size |
| `--type-title` | 20 / 1.15, `800`, `-0.02em` | Card titles |
| `--type-display` | 30 / 1.05, `800`, `-0.03em` | Page headings |
| `--type-hero` | 44 / 1, `800`, `-0.04em` | Numerals, hero |

Nothing below 11px survives. 8/9/10px map up to `--type-kicker`; 12 and 14
collapse into 13 and 15. That's ten sizes down to six.

**Note the DepartureBoard already uses exactly this scale** (11/13/15/20/30/44
with tabular numerals). It was built as a system; nothing else adopted it.
Promote it rather than invent something new.

---

## 3. Radius — 899 uses, 10 variants, no rule

```
rounded-full   281      rounded-[10px]  62     ← a one-off between lg and xl
rounded-xl     259      rounded-t        9
rounded-2xl    191      rounded-md       8
rounded-lg      90      rounded          7
                        rounded-3xl      2     ← used twice, in Messages only
```

`rounded-[10px]` (62 uses) sits between `rounded-lg` (8px) and `rounded-xl`
(12px) for no reason. `rounded-3xl` appears twice — message bubbles — so bubbles
are rounder than everything else in the app by 12px.

### Fix — four values, assigned by role

| Token | Value | Applies to |
|---|---|---|
| `--r-pill` | `9999px` | Chips, badges, tab pills, avatars |
| `--r-control` | `12px` | Buttons, inputs, selects |
| `--r-card` | `16px` | Cards, sheets, panels |
| `--r-sheet` | `24px` (top only) | Bottom sheets, modals |

`rounded-[10px]` → `--r-control`. `rounded-lg`/`md`/plain → `--r-control` or
`--r-card` by role. `rounded-3xl` → `--r-card`, so bubbles match cards.

---

## 4. Elevation — one shadow doing four jobs

```
shadow-sm            128
ring-slate-200/70    113      ← the same border at two opacities
ring-slate-200        33
shadow-lg              3
shadow-md              2
shadow-                5      ← empty class, renders nothing
```

Everything is `shadow-sm` + a hairline ring, so **nothing has hierarchy**. A
modal, a card, a nav bar, and a toast all sit at the same apparent depth. That
flatness is a big part of why pages read as "a wall of boxes."

There are also 5 instances of a bare `shadow-` class that produces no style at
all, and the ring is drawn at two different opacities.

### Fix — four levels tied to meaning

| Token | Use |
|---|---|
| `--elev-flat` | hairline ring only — list rows, inline panels |
| `--elev-raised` | cards that lift on hover |
| `--elev-overlay` | sheets, dropdowns, popovers |
| `--elev-modal` | full modals, toasts |

Pick **one** ring opacity. Delete the five empty `shadow-` classes.

---

## 5. Controls — four button heights, no primary/secondary language

```
h-11  151      h-10   50      h-12   32      h-14   18
```

Four heights with no rule about which means what. `h-11` (44px) is correct for a
touch target; `h-10` (40px) is under Apple's 44px minimum and appears 50 times.

More important: there is **no button component**. Every button is a hand-rolled
`className` string, which is why primary actions look different on every page
and why the disabled, loading, and pressed states are inconsistent or missing.

### Fix — a real `Button` with variants

`primary` (ink fill) · `secondary` (ink outline) · `ghost` (text only) ·
`danger` (status-danger) · `accent` (coral — reserved, see §6)

Sizes `sm` 36 / `md` 44 / `lg` 52, with 44 the default. Every variant ships
`:hover`, `:active` (scale 0.98, 90ms), `:disabled`, `:focus-visible`, and a
loading state. That one component retires 251 bespoke button strings.

---

## 6. Color — 322 off-brand uses, and coral has no rule

From the structural audit: emerald 113, amber 108, rose 75, sky 26 against a
two-color brand.

The deeper problem isn't the count — it's that **coral has no defined meaning**.
It's used for the FAB, for accents, for highlights, and for decoration. When
your one loud color means everything, it means nothing, and the eye stops
treating it as signal.

### Fix — coral is a signal, not a decoration

Reserve `#FF5741` for exactly three things:
1. **Your** relationship to something (you're going, you're the host, it's yours)
2. The single primary action on a screen
3. Live/imminent state (a run starting soon)

Everything else is ink, slate, or a semantic status token. And the brand rule
already in the codebase holds: **never white text on coral** — ink on coral,
always.

Status tokens replace the 322: `--status-ok` (verified, confirmed),
`--status-warn` (pending, needs action), `--status-danger` (rejected, blocked),
`--status-info` (neutral notice). Semantic use is legitimate; 322 ad-hoc
Tailwind palette picks are not.

---

## 7. Per-page remediation

Grouped by what each page needs, so this can be worked as batches rather than
41 individual passes.

### Group A — Structural rebuild (page doesn't do its job)

| Page | Lines | Problem |
|---|---|---|
| `DiscoverEventsPage` | 89 | Signed-in home; least-built page in the app; **no bottom padding** |
| `PersonalRunsPage` | 25 | Unreachable, one-line JSX, emerald kicker, no empty/loading state — **delete** |
| `PastEventsPage` | 31 | Thin; should be a filter on Events, not a route |
| `GroupDetailPage` | 38 | Group pages are your retention surface and this is 38 lines |
| `CoachRosterPage` | 55 | Coach's primary workspace |
| `CoachDirectoryPage` | 56 | The discovery surface for a paid product |
| `GroupsPage` | 71 | Becoming a top-level tab |

### Group B — Over-grown, needs decomposition

| Page | Lines | Problem |
|---|---|---|
| `ForumPage` | 1,494 | Largest file; `[35]` simplification belongs here |
| `AdminPage` | 1,436 | One page for every admin task; needs sections |
| `SettingsPage` | 1,132 | Flat list of everything; needs grouping |
| `MessagesPage` | 967 | Feature-rich, untested interaction (scroll, §2.3 of roadmap) |

Above ~600 lines a page is carrying several screens' worth of work. These four
are 5,029 lines — 36% of the app — in four files.

### Group C — Systemic-fix-only (no bespoke work)

The remaining 30 pages need only: `PageShell`, the type scale, radius tokens,
elevation tokens, `Button`, and the color pass. **They should not be touched
individually.** Doing the six system fixes lifts all of them at once — that is
the entire argument for doing Phase 2 before any per-page polish.

---

## 8. Cohesion rules — the part that creates "pizazz"

Consistency alone gets you inoffensive. These four make it feel designed.

**8.1 One signature element, used everywhere.** The DepartureBoard's ink time
gutter with tabular numerals is genuinely distinctive. Extend that vocabulary:
the same left-rail treatment for race dates, plan days, and message timestamps.
One memorable device repeated beats five clever ones.

**8.2 Motion as a system, not per-component.** Three durations only —
`--motion-fast` 90ms (press), `--motion-base` 200ms (state change),
`--motion-spring` 260ms `cubic-bezier(0.34,1.4,0.64,1)` (enter/lift). Every
`prefers-reduced-motion` gated. Right now motion exists only on the
DepartureBoard, so it feels like a different app.

**8.3 Every list has three states.** Loading (skeleton matching final geometry,
not a spinner), empty (an invitation to act — "No runs Thursday. Post one and
the club will see it."), and error (what happened, what to do). Missing empty
states are a large part of "feels like it's missing half the resources."

**8.4 Density that matches context.** A runner checking their phone in a parking
lot before a run needs different density than a coach planning a week on desktop.
`PageShell` widths plus the type scale give you this; the current mobile-width
lock on 21 pages actively prevents it.

---

## 9. Where this slots into the roadmap

All of it is **Phase 2 — Systemic visual fixes**, expanded:

- **2.1** `PageShell` — three widths **+ the bottom-padding token** (§1)
- **2.2** Semantic color tokens **+ the coral rule** (§6)
- **2.3** Messaging scroll — unchanged
- **2.4** *(new)* Type scale — 815 arbitrary sizes → 6 tokens (§2)
- **2.5** *(new)* Radius tokens — 10 variants → 4 (§3)
- **2.6** *(new)* Elevation tokens — 4 levels, one ring opacity (§4)
- **2.7** *(new)* `Button` component — retires 251 bespoke strings (§5)
- **2.8** *(new)* Motion tokens — 3 durations (§8.2)
- **2.9** *(new)* List state contract — loading / empty / error (§8.3)

**Sequence within Phase 2:** tokens first (2.4–2.6, 2.8), then components
(2.1, 2.7), then the sweep. Components consume tokens, so tokens can't come
second.

Group A pages then get rebuilt in **Phase 1** (they're structural, not visual).
Group B decomposition belongs in **Phase 6**. Group C needs nothing beyond
Phase 2 — which is the whole point.
