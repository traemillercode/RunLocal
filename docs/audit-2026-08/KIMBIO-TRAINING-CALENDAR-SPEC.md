# Kimbio — Training Calendar Redesign

Addresses the reported "4+3=7" cell and the AM/PM display. Measured against
`TrainingPlanDetailPage.tsx` at `d009a2e`. Slots into the Master Roadmap as
**Phase 1.5** (structural — the current model loses data) and **Phase 6.5**
(zoom views).

---

## 1. What's actually wrong

```ts
// TrainingPlanDetailPage.tsx:199
return `${a.distanceValue}+${bInAUnit}=${sum}${unitAbbrev(a.distanceUnit)}`;
// rendered at text-[8px]
```

**1.1 — It's arithmetic, not information.** `3+4=7mi` shows a runner the
equation instead of the training. No athlete has ever needed to be told that
three plus four is seven. What they need to know is *what the two sessions were*
— and the sum actively hides that one of them was a tempo.

**1.2 — AM/PM is computed but never displayed.** Line 251 derives the slot
(`Number(time.slice(0,2)) < 12 ? "am" : "pm"`), and the cell then collapses both
sessions into one equation. So the slot exists in the data and is invisible in
the UI. That is the reported bug: not that AM/PM renders wrongly, but that a
two-a-day renders as a sum with no AM/PM at all.

**1.3 — It silently drops the third entry.** The branch is
`dayList.length === 2`. A day with a run, a strength session, and a swim — all
of which the data model supports — falls back to rendering `primary` only. The
other two vanish with no indication anything is hidden.

**1.4 — `text-[8px]` is unreadable.** Below the accessibility floor, and this is
a product used at arm's length before a workout.

**1.5 — Unit conversion runs inside the render loop.** `toMilesLocal` /
`fromMilesLocal` are redefined on every cell of every month render, and the
conversion is a display concern leaking into layout code.

---

## 2. What every serious training platform does instead

Final Surge, TrainingPeaks, Garmin Connect, and Coros disagree on plenty. They
agree completely on this:

> **One session is one row. Sessions are never merged.**

Nobody sums a two-a-day into a single number, because the two sessions have
different *purposes*. An AM shakeout and a PM tempo are not seven miles of the
same thing — one is recovery, one is the hard session of the week. Summing them
destroys the only distinction that matters.

The other shared conventions worth adopting:

| Convention | Who does it | Why it matters |
|---|---|---|
| Stacked session rows per day cell | Final Surge, TrainingPeaks, Garmin | Preserves both sessions; scales to 3+ |
| Planned vs completed as the primary visual state | TrainingPeaks (outline → filled), Final Surge (✓) | The #1 question is "did I do it," not "what is it" |
| Sport/discipline icon per row | Garmin, Coros, TrainingPeaks | Multi-sport days read instantly |
| Intensity encoded by color, not text | All of them | Hard vs easy at a glance without reading |
| Weekly volume in the row header | Final Surge, TrainingPeaks | The total belongs to the *week*, not the day |
| Day / week / month zoom | All of them | Different intents: execute today vs plan the block |
| Distance-sized visual weight | Strava training log | Volume shape visible without numbers |

**The single most important borrowing:** the total belongs in the **week row
header**, not inside a day cell. That's where `3+4=7` was trying to be useful
and picked the wrong scope. Final Surge and TrainingPeaks both put weekly
mileage at the end of the week row — which is the number a runner actually
plans against.

---

## 3. The redesign

### 3.1 Month cell — stacked rows, never merged

```
┌──────────────┐
│ 14           │  date, --type-meta
│ ▌AM  3mi     │  ← coral bar = quality; slate = easy
│ ▌PM  4mi  ✓  │  ← ✓ = completed
└──────────────┘
```

Rules:
- **One row per session**, capped at three. A fourth renders `+1 more`.
- **AM/PM is the row's leading label** — this is the fix. Derived from
  `scheduledTime`, which already exists. When no time is set, the label is the
  discipline instead (`RUN`, `SWIM`, `LIFT`), never blank.
- **Intensity is the left bar**, not text: coral for quality (interval structure
  or a run label beyond easy/recovery), slate for easy, hollow for rest.
- **Completion is a filled state**, not a separate icon column.
- No arithmetic anywhere in a day cell.

Drop `aspect-square`. A square cell can't hold two rows legibly; the cell should
be ~1:1.3 and let the grid breathe.

### 3.2 Week row header — where the total goes

```
Week of Sep 14                    32 mi  ·  4 quality  ·  5h 10m
```

Planned volume, quality-session count, and time. This is the number the athlete
and coach actually plan against, and moving it here removes the entire reason
the `3+4=7` string existed.

### 3.3 Day view — the execution surface

The month view is for planning. A runner about to train needs one screen with no
navigation:

```
Tuesday, Sep 14

AM · 6:00 AM                    ✓ Completed
Easy shakeout · 3 mi
Ghost Max 14 · 8:45/mi avg

PM · 5:30 PM                      Planned
Tempo · 4 mi
  2 mi @ 7:00  ·  1 mi easy  ·  1 mi @ 6:50
Coach note: hold back on the first rep.
```

Interval structure expands here rather than being hinted at with a sparkle icon.

### 3.4 Week view — the coach surface

Seven columns, sessions stacked, weekly total in the header. This is where
bulk-scheduling (`[15]`) and propose-a-change (`[16]`) belong — a coach thinks
in weeks, not months, and the month grid is the wrong canvas for both.

---

## 4. AM/PM, specifically

Current model: `slot: "am" | "pm"` derived from `scheduledTime`.

Three corrections:

**4.1 — Show the actual time when it exists.** `AM · 6:00 AM` is more useful
than `AM`. The runner needs to know whether it's a 5am alarm.

**4.2 — Don't force a slot when no time is set.** Falling back to a discipline
label (`RUN`, `SWIM`) is honest; defaulting to "AM" invents a commitment the
athlete never made.

**4.3 — Order by time, not by slot string.** Line 83 sorts with
`(a.slot === "pm" ? 1 : 0) - (b.slot === "pm" ? 1 : 0)` — so two AM sessions
have undefined relative order. Sort by `scheduledTime` with untimed entries last.

---

## 5. What this needs that doesn't exist yet

| Need | Status |
|---|---|
| `scheduledTime` per session | ✅ exists (HH:MM, server-validated) |
| `intervalStructure` | ✅ exists |
| `runLabel` (tempo/long/easy…) | ✅ exists |
| Completion link (`completedRunId`) | ✅ exists — **not surfaced in the cell** |
| Swim / strength discipline | ✅ exists |
| Shoe assignment | ✅ exists |
| **Weekly planned volume** | ❌ compute from day records |
| **Quality-session count per week** | ❌ derivable from existing fields |
| **Discipline icons** | ❌ blocked on Phase 0.1 (icon set) |
| **Day / week / month toggle** | ❌ `[20][21]` |

Almost everything is already stored. This is a **display** problem, not a data
problem — which is the same pattern as the rest of the app: built, then never
surfaced.

`completedRunId` is the standout. Plan-vs-actual compliance is the primary
signal every reference platform leads with, and Kimbio has the link and shows
nothing.

---

## 6. On the "bring every tool into one place" instinct

Chasing Strava/Garmin feature parity loses — they have a decade and 100M users.
But the *training calendar* is a place where matching the category conventions
is mandatory, because athletes arrive with expectations formed by Final Surge
and TrainingPeaks. Deviating there reads as broken, not as differentiated.

So: **conform on the calendar, differentiate on the local layer.** The stacked
row, the weekly total, the plan-vs-completed state — those are table stakes and
should look familiar. What none of them have is your group-run graph: a planned
Tuesday tempo that *is* the Columbia Track Club track session, with the roster
attached. That link between a personal plan and a real local run is the thing
worth building, and no other platform can.

Concretely: a plan day linked to a group run should show the group and going
count in the cell — `▌PM  Track  ·  CTC  ·  12 going`. That is Kimbio's calendar
doing something Final Surge structurally cannot.

---

## 7. Roadmap placement

- **Phase 0.3** — the number input bug `[1]` sits on this same page; fix both in
  one pass, since both are "the calendar cell doesn't reflect reality."
- **Phase 1.5** *(new)* — stacked session rows, AM/PM labels, weekly header
  total, completion state. Structural: the current cell **loses data** at 3+
  sessions.
- **Phase 2** — the cell inherits the type scale (retires `text-[8px]`), radius,
  and color tokens. Blocked on Phase 0.1 for discipline icons.
- **Phase 4.5** — bulk-scheduling `[15]` lands in the new week view.
- **Phase 6.5** — day/week/month toggle `[20]`, list view `[21]`.
