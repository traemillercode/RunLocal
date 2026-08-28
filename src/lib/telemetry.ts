/**
 * Beta instrumentation — PostHog (product analytics + session replay) and
 * Sentry (errors), both gated behind the SAME consent the cookie banner
 * already collects.
 *
 * Why this exists: before this module, `analytics.ts` captured UTM params and
 * nothing else — zero page views, zero events, zero error tracking. The
 * consent banner gated a capability that didn't exist. With a staged beta
 * (10 people, watch what breaks, then 90), there was nothing to watch.
 *
 * SCOPE — deliberately not the full 8-group taxonomy. This ships the two
 * groups that answer "what broke for the first 10":
 *   FRICTION    error_shown · dead_end_reached · rage_click
 *   ACTIVATION  first_rsvp
 * The remaining groups (DISCOVERY, RETENTION, TRAINING, SOCIAL, MONEY) are
 * deliberately deferred rather than stubbed, so nothing here claims coverage
 * it doesn't have.
 *
 * CONSENT IS LOAD-BEARING, not decorative:
 *  - Nothing initializes until consent is "granted". Declining means neither
 *    SDK is ever loaded, so no network call is made and no cookie is set.
 *  - Consent is re-checked on every capture, so a mid-session revoke
 *    (see `shutdownTelemetry`) stops collection immediately rather than at
 *    the next reload.
 *  - Sentry is included in the same gate. It's error tracking rather than
 *    marketing analytics, but it still transmits usage data to a third party,
 *    and splitting the gate would mean the banner tells a half-truth.
 */

import { getConsent } from "./analytics";

/**
 * The events actually wired today. A closed union rather than a `string` so a
 * typo becomes a build failure instead of a silently-missing funnel step —
 * the same reasoning behind union-typing icon names.
 */
export type TelemetryEvent =
  // FRICTION — what answers "where did the first 10 get stuck"
  | "error_shown"
  | "dead_end_reached"
  | "rage_click"
  // ACTIVATION — the single event that matters most for a local events product
  | "first_rsvp";

export interface TelemetryProps {
  [key: string]: string | number | boolean | null | undefined;
}

let posthogClient: typeof import("posthog-js").default | null = null;
let sentryLoaded = false;
let initInFlight: Promise<void> | null = null;

function env(key: string): string | undefined {
  const v = (import.meta.env as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** True only when consent is granted AND at least one backend is configured. Keeps every call site free of environment checks. */
function enabled(): boolean {
  return getConsent() === "granted" && Boolean(env("VITE_POSTHOG_KEY") || env("VITE_SENTRY_DSN"));
}

/**
 * Loads and starts whichever backends are configured. Idempotent and
 * concurrency-safe: multiple callers share one in-flight promise, so a burst
 * of early events can't start two PostHog instances.
 *
 * Both SDKs are dynamically imported so that a declining user never downloads
 * them — this matters for the 1.32 MB bundle problem (roadmap 0.10) as well
 * as for consent.
 */
export async function initTelemetry(): Promise<void> {
  if (!enabled()) return;
  if (initInFlight) return initInFlight;

  initInFlight = (async () => {
    const posthogKey = env("VITE_POSTHOG_KEY");
    if (posthogKey && !posthogClient) {
      try {
        const { default: posthog } = await import("posthog-js");
        posthog.init(posthogKey, {
          api_host: env("VITE_POSTHOG_HOST") ?? "https://us.i.posthog.com",
          // Page views are captured explicitly on route change (see
          // useRouteTelemetry) because this is a SPA - the automatic
          // pageview fires once on load and would undercount every
          // subsequent navigation.
          capture_pageview: false,
          // Session replay: the highest-value signal for a staged beta -
          // watching someone fail to find the training page beats theorizing.
          disable_session_recording: false,
          session_recording: {
            // Never record what people type. Free-text in this app includes
            // forum posts, direct messages, and feedback - none of which
            // belongs in a replay.
            maskAllInputs: true,
          },
          persistence: "localStorage+cookie",
          autocapture: false, // explicit taxonomy only - see module docblock
        });
        posthogClient = posthog;
      } catch {
        // A blocked or failed SDK load must never break the app. Telemetry is
        // strictly observational; it has no business affecting what a runner
        // can do.
      }
    }

    const sentryDsn = env("VITE_SENTRY_DSN");
    if (sentryDsn && !sentryLoaded) {
      try {
        const Sentry = await import("@sentry/react");
        Sentry.init({
          dsn: sentryDsn,
          environment: import.meta.env.PROD ? "production" : "development",
          release: env("VITE_BUILD_ID"),
          // Beta-scale volumes: full error capture, light performance sampling.
          tracesSampleRate: 0.1,
          sendDefaultPii: false,
        });
        sentryLoaded = true;
      } catch {
        // same reasoning as above
      }
    }
  })();

  return initInFlight;
}

/**
 * Records one taxonomy event. Safe to call anywhere: no-ops entirely without
 * consent, and never throws.
 */
export function track(event: TelemetryEvent, props?: TelemetryProps): void {
  if (!enabled()) return;
  try {
    posthogClient?.capture(event, props);
  } catch {
    // never let instrumentation break a user action
  }
}

/** Records a page view. Separate from `track` because PostHog treats `$pageview` specially (it powers funnels and session replay navigation). */
export function trackPageView(path: string): void {
  if (!enabled()) return;
  try {
    posthogClient?.capture("$pageview", { $current_url: path, path });
  } catch {
    // ignore
  }
}

/**
 * Associates subsequent events with a real account, so a funnel can follow one
 * person from signup through their first RSVP.
 *
 * Only the opaque account id and coarse role are sent - never name, email,
 * phone, or city. For a product whose pitch is "private by default", leaking
 * identity into a third-party analytics tool would contradict the promise on
 * the marketing page.
 */
export function identify(accountId: string, role?: string): void {
  if (!enabled()) return;
  try {
    posthogClient?.identify(accountId, role ? { role } : undefined);
    if (sentryLoaded) {
      void import("@sentry/react").then((Sentry) => Sentry.setUser({ id: accountId }));
    }
  } catch {
    // ignore
  }
}

/** Clears identity on sign-out so a shared device doesn't attribute one person's session to another. */
export function resetIdentity(): void {
  try {
    posthogClient?.reset();
    if (sentryLoaded) {
      void import("@sentry/react").then((Sentry) => Sentry.setUser(null));
    }
  } catch {
    // ignore
  }
}

const FIRST_RSVP_KEY = "kimbio_first_rsvp_sent";

/**
 * Fires `first_rsvp` exactly once per browser. Signup → first RSVP is the core
 * activation funnel for a local events product (Launch Readiness §2.3): if
 * someone never RSVPs, nothing else about their session matters.
 *
 * Guarded by localStorage rather than a server field because this is a funnel
 * measurement, not a business record - and a stricter server-side "is this
 * genuinely their first ever" check isn't worth a schema change to answer a
 * question the analytics tool can already de-duplicate by person.
 */
export function trackFirstRsvpOnce(props?: TelemetryProps): void {
  if (!enabled()) return;
  try {
    if (localStorage.getItem(FIRST_RSVP_KEY)) return;
    localStorage.setItem(FIRST_RSVP_KEY, "1");
  } catch {
    return; // storage blocked - skip rather than risk firing on every RSVP
  }
  track("first_rsvp", props);
}

/**
 * Hard stop for a mid-session consent revoke: ends recording, clears the
 * PostHog cookie, and drops the client so `enabled()` short-circuits every
 * later call. Without this, declining after accepting would only take effect
 * on the next page load.
 */
export function shutdownTelemetry(): void {
  try {
    posthogClient?.stopSessionRecording?.();
    posthogClient?.reset(true);
  } catch {
    // ignore
  }
  posthogClient = null;
  initInFlight = null;
}
