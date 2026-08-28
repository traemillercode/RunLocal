# Kimbio — Admin & Group-Admin Experience

Covers the gap the other four documents left: what admin surfaces should
*become*, not just that they're too large. Measured against `d009a2e`.

Slots into the Master Roadmap as **Phase 1.6** (structural) and **Phase 2.10**
(the settings/forms pass).

---

## 1. Why admin feels "wonky and weird"

Four specific, findable causes. None is a taste problem.

### 1.1 — The dashboard shows nothing until you click Load. Four times.

```
AdminPage.tsx:661   "Load queue"
AdminPage.tsx:721   "Load submission queue"
AdminPage.tsx:796   "Load dashboard"
AdminPage.tsx:644   "Refresh"
```

An admin opens `/admin` and sees a page of **empty sections with buttons in
them**. Nothing loads on mount. They have to know which three buttons to press,
in which order, to assemble a picture of the site.

This is the single biggest reason it feels broken. A dashboard's entire job is
to have already answered the question before you asked it.

**Fix:** load on mount, in parallel, with skeletons matching final geometry. Keep
a single Refresh in the page header. If a section is expensive, load it lazily on
scroll — never on a click the admin has to discover.

### 1.2 — The event CMS shows database column names to humans

`EventCmsSection.tsx` — the entire event management UI, 16 lines, one unbroken
JSX line:

```tsx
(["title","groupId","time","location","distanceLabel","externalUrl"] as const)
  .map((key) => <input key={key} aria-label={key} placeholder={key} ... />)
```

The admin sees six identical grey boxes labelled **`groupId`**,
**`distanceLabel`**, **`externalUrl`**. No labels, no help text, no validation,
no field grouping, no indication which are required. `groupId` expects an opaque
ID typed from memory. There is no picker.

This is the "hard to follow" made literal: the form is a raw projection of the
record type. It also means `pacePolicy` — the field just added — cannot be set
here at all, because the array is hardcoded.

**Fix:** a real form (§3.1). This is the worst single surface in the product and
it is also the one an admin uses most.

### 1.3 — Settings is 14 flat sections with three copies of the same thing

```
Welcome tour · Username · Change password · Profile photo · Notifications ·
Profile details · Social accounts · Training plan · Privacy · Account ·
Preferences · Home city · Session
```

1,132 lines, no grouping, no ordering logic. **Username, Profile photo, and
Profile details are three separate sections describing one thing.** Account,
Session, Preferences, and Home city overlap without a rule. "Welcome tour" — a
one-off — sits at the top above password management.

A user looking for "how do I change my city" has to guess between Preferences,
Account, and Home city.

**Fix:** five groups, ordered by frequency of use (§4).

### 1.4 — Admin has no way in

`/admin` has **no nav entry anywhere** (Structural Audit §3). 1,436 lines of
moderation tooling reachable only by typing a URL.

---

## 2. The permission model is good — the UI doesn't express it

The server already has a real, layered model. `eventModeration.ts:69`
`eventCapabilities()` computes per-event, per-actor capabilities, and the code
documents the tiers:

- **Owner / key admin** — everything, every city
- **City admin** — scoped to `adminCityId`
- **Group lead** — owner or listed leader, verified, home city matches group city
- **Verified runner** — submit, RSVP
- **Everyone else** — read

`CanonicalEvent.capabilities?: string[]` is already returned to the client.

**The problem is that no surface reflects this.** There is one `/admin` page for
global admins and a separate `/groups/:id/manage` for leads, and neither answers
"what can I act on right now." A group lead has no events surface at all — they
manage membership and the group profile, and their runs live in a global CMS
they cannot reach.

**This is the core answer to "how do I manage events effectively":** you don't
need new permissions. You need surfaces that render the permissions that exist.

---

## 3. Event management, redesigned

### 3.1 — One event editor, three permission levels

Replace `EventCmsSection`'s six raw inputs with a single real form used by
everyone who can edit an event — owner, city admin, or group lead. Capability
flags hide what an actor can't do; the form itself is one component.

```
BASICS        Title            [text, required]
              Group            [searchable picker — never a raw groupId]
              Type             [Track / Group run / Long run / Trail]

WHEN          Repeats          [One-time ▾ | Weekly ▾]
              Day / Date       [contextual on the above]
              Time             [time input, not free text]

WHERE         Meeting point    [text + optional map pin]

DETAILS       Distance         [text: "3–5 mi"]
              Pace             [select: No-drop / All paces / …]
              Invite           [Open to all / Members + guests / RSVP requested]
              External link    [url, validated]
              Min participants [number — confirmation threshold]

STATUS        Draft → Approved → Published        [owner/city admin only]
              Hidden · Archived                    [with reason, audited]
```

Every current failing detail addressed: real labels instead of `placeholder={key}`,
a group **picker** instead of a typed ID, `time` as a time input, `pacePolicy`
present, required-field marking, and grouping so a 12-field form reads as four
short ones.

### 3.2 — A single work queue, not three Load buttons

Admins don't think "submissions, then flags, then verifications." They think
**"what needs me today."** Merge into one triage list, loaded on mount:

```
NEEDS YOU  ·  7                                          [Refresh]

⚠  Safety report — Forum thread                    2h    [Review]
◷  Event submission — Tuesday Tempo (CTC)          5h    [Approve] [Reject]
◷  Verification — mrivera@…                        1d    [Approve] [Reject]
◷  Group application — Como Trail Runners          2d    [Review]
```

Sorted by urgency then age. Safety first, always. Filter chips by type; the
default view is everything. Reason-required actions prompt inline rather than
via a page-level textarea that applies to whatever you click next — which is the
current pattern in `EventCmsSection` and is genuinely dangerous, since the reason
box is shared across every action on the page.

### 3.3 — Group lead event management

Group leads currently manage membership and profile, and **cannot manage their
own runs**. Add an Events tab to `/groups/:id/manage`:

- The group's events, using the §3.1 editor with lead-level capabilities
- Create a run for this group (group pre-filled, not typed)
- Attendance per occurrence — who RSVP'd, who checked in
- Cancel a single occurrence with a note to the roster (a Tuesday run cancelled
  for weather is not the same as archiving the recurring event — the current
  model has no way to express this and it's the most common real-world action a
  lead takes)

### 3.4 — Bulk actions

Approving seven submissions means seven round trips. Add selection checkboxes
with Approve / Reject / Hide on the selection, one shared reason. The audit log
records each individually.

---

## 4. Settings, restructured

Fourteen flat sections → five groups, ordered by how often they're opened:

| Group | Contains |
|---|---|
| **Profile** | Photo, display name, username, bio, home city, social accounts |
| **Notifications** | All categories, one page, honest availability labels |
| **Privacy & visibility** | Profile visibility, run visibility, connections, blocking |
| **Training** | Plan preferences, units, default shoe, coach relationships |
| **Account & security** | Email, password, sessions, data export, delete account |

Username / Profile photo / Profile details collapse into **Profile**. Account /
Session / Preferences / Home city redistribute. "Welcome tour" is not a settings
section — it belongs in Help, or as a one-time card.

On mobile: group list → detail. On desktop: two-pane with the group rail on the
left. Same `PageShell` `wide` variant as Admin.

---

## 5. Admin information architecture

`/admin` becomes sections rather than one 1,436-line scroll:

```
/admin              Overview — needs-you queue, live counts, recent actions
/admin/queue        Unified triage (§3.2)
/admin/events       Event CMS using the §3.1 editor
/admin/people       Accounts, verification, roles, trust
/admin/content      Races, routes, forum moderation
/admin/city         City settings, geofence, CMS copy
/admin/sponsors     Bookings, availability, revenue
/admin/system       Retention, admin key, audit log
```

Entry: a role-conditional sidebar item, visible only when the account is owner,
key admin, or city admin. City admins see the same shell with out-of-scope
sections hidden — not disabled-looking, hidden, because a permanently greyed
menu teaches people to ignore the menu.

---

## 6. What this needs

| Need | Status |
|---|---|
| Per-event capability computation | ✅ `eventCapabilities()` |
| Capabilities on the client type | ✅ `CanonicalEvent.capabilities` |
| Role model (owner / city / lead / verified) | ✅ |
| Audit + reason enforcement | ✅ |
| Group picker component | ❌ |
| Per-occurrence cancel with roster note | ❌ — most common real lead action |
| Bulk approve/reject | ❌ |
| Unified needs-you queue | ❌ — data exists across 3 endpoints |
| Load-on-mount + skeletons | ❌ |

Same pattern as everywhere else in this codebase: **the server is ahead of the
client.** Nearly every capability exists and isn't surfaced.

---

## 7. Roadmap placement

- **Phase 1.6** *(new)* — Admin IA (§5), group-lead events tab (§3.3), admin nav
  entry. Structural: leads currently cannot manage their own runs at all.
- **Phase 2.10** *(new)* — Event editor form (§3.1), settings restructure (§4),
  load-on-mount + skeletons (§1.1). Depends on `PageShell`, `Button`, and the
  type scale.
- **Phase 4** — unified queue (§3.2) and bulk actions (§3.4); these complete the
  admin journey the same way post-RSVP completes the runner's.

**Do §1.1 first regardless of phase.** Loading on mount is a small change and it
is the difference between "this dashboard is broken" and "this dashboard works."
