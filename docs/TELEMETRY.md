# Telemetry (Roadmap 0.6)

Consent-gated PostHog + Sentry. Everything here no-ops unless **both** a key is
configured **and** the visitor granted consent.

## Environment variables

Set these on Railway (service `0ce54846`). All are build-time `VITE_*` vars, so
**a deploy is required after changing them** — they're inlined into the bundle.

| Variable | Required | Purpose |
|---|---|---|
| `VITE_POSTHOG_KEY` | for analytics | PostHog project API key |
| `VITE_POSTHOG_HOST` | optional | Defaults to `https://us.i.posthog.com` |
| `VITE_SENTRY_DSN` | for errors | Sentry DSN |
| `VITE_BUILD_ID` | already set | Reused as the Sentry release |

With none of them set the app runs exactly as before — this is the current
state until the keys are added, so **merging this does not start collecting
anything.**

## What is collected

Deliberately scoped to the two groups that answer "what broke for the first 10"
(Launch Readiness §2.1). The other six taxonomy groups are **not** wired, rather
than stubbed, so nothing claims coverage it doesn't have.

| Group | Events |
|---|---|
| FRICTION | `error_shown`, `dead_end_reached`, `rage_click` |
| ACTIVATION | `first_rsvp` |
| — | `$pageview` on every route change |

`TelemetryEvent` is a closed union, so adding an event without adding it to the
type is a build failure.

## What is deliberately NOT collected

- **Keystrokes.** Session replay runs with `maskAllInputs: true`. Forum posts,
  direct messages, and feedback text are never recorded.
- **Identity.** `identify()` sends the opaque account id and coarse role only —
  never name, email, phone, or city. For a product whose pitch is "private by
  default," leaking identity to a third party would contradict the marketing
  page.
- **Response bodies.** `error_shown` records the error code, HTTP status, and
  endpoint path — never the payload, which can contain user content.
- **Autocapture.** Off. Only the explicit taxonomy above.

## Consent

`getConsent()` in `lib/analytics.ts` remains the single source of truth, and the
cookie banner still writes it. Three things changed:

1. Consent now gates something real. Previously the banner gated UTM capture
   and nothing else — analytics that didn't exist.
2. **Declining loads nothing.** Both SDKs are dynamically imported inside
   `initTelemetry()`, so a declining visitor never downloads them and no
   network call is made.
3. **Revoking mid-session takes effect immediately** via `shutdownTelemetry()`,
   which stops recording and clears the PostHog cookie — not at the next reload.

Sentry is behind the same gate as PostHog. It's error tracking rather than
marketing analytics, but it still transmits to a third party, and splitting the
gate would make the banner tell a half-truth.

## Bundle impact

Both SDKs are lazy — they land in their own chunk and are fetched only after
consent. Main bundle grew ~3 KB (1,325 → 1,328 KB). They do **not** add to
first paint, which matters given Roadmap 0.10.
