# Server capabilities with no client path

Generated during the city-status build, after the fifth instance of the same
defect in one week.

## The pattern

A server capability is written, tested, and correct — and nothing in the client
can reach it. Each instance looked complete from the server side and was
unusable from the product side:

| # | Capability | How it surfaced |
|---|---|---|
| 1 | Invitation tokens | `createAccount` had no `invitationToken` field; flipping a city to `invite_only` would have closed signup to everyone, invited or not |
| 2 | Audit reasons | 64 of 75 admin calls returned 400 `reason_required`; the admin panel was unusable |
| 3 | Registry `capability` field | Added for a test assertion; nothing rendered from it |
| 4 | Invitation revoke | Client sent no `x-audit-reason`; every revoke 400'd and the X did nothing |
| 5 | City status | `saveCity` and even `adminSaveCity` existed; no control called it, so the owner could not change their own product's availability |

**The shared shape:** each was added to satisfy a *server-side model* or a *test
assertion* first, and a consumer second — or never. The gap is invisible from
both ends: server tests pass because the handler is correct, and client tests
pass because nothing calls it.

**The habit:** name the consumer in the same commit, or record here that there
isn't one yet.

## Currently unreachable

Swept by matching every `/api/admin/*` route in `src/server/api.ts` against
`src/lib/api.ts`. **62 admin routes, 7 with no client caller.**

| Route | Assessment |
|---|---|
| `/api/admin/city/dashboard` | City-admin surface. No city admins exist yet — 1.6. |
| `/api/admin/city/audit` | Same. |
| `/api/admin/cityadmins`, `/api/admin/cityadmins/*` | Assign and revoke city admins. Same feature, same phase. |
| `/api/admin/city/submissions/backfill` | One-off maintenance. Arguably correct to have no UI — it should not be one click away. |
| `/api/admin/safety-reports`, `/api/admin/safety-reports/*` | **The one that matters.** Safety reports can be filed and cannot be read. Nothing surfaces them, so a report goes into the store and nobody sees it. |

## The one to act on

**Safety reports.** The others are a feature phase that has not arrived; this is
a live intake with no outbox. It does not block the beta at ten people who know
each other, and it must close before the city opens up — a reporting mechanism
nobody reads is worse than none, because it implies someone is looking.

Tracked under 1.6 (admin IA).
