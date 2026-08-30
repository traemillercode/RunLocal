# Settings in two dashboards that must agree

## Supabase "Confirm email" ↔ Columbia city status

**Current state (beta):**

| Setting | Where | Value |
|---|---|---|
| City status | Kimbio `/admin` | `invite_only` |
| Confirm email | Supabase Auth | **off** |

**Why turning confirmation off is safe right now:** the only people who can
create an account hold an email-bound invitation, sent to that address. The
invitation *is* proof the address works — a second confirmation proves nothing
new, and it was the most fragile step in the funnel. Two of the first four
testers never received theirs; one lost eight days to it.

**It stops being safe the moment the city is not `invite_only`.** With public
signup and confirmation off, anyone can create an account against an address
they do not control.

**So the rule is:** `confirm email = off` **requires** `city status =
invite_only`. Turning the city back to `active` means turning confirmation back
on, in the same sitting.

Neither setting lives in this repo, so no test can read them. What CI *can*
check is that the code still assumes the pairing — see
`tests/paired-settings.test.ts`. That is a reminder, not an enforcement, and the
distinction is worth being honest about.

## Recorded because we would forget

Two settings, two dashboards, no shared owner, and the failure is silent: an
account created against an address someone does not control looks exactly like a
normal account until it matters.
