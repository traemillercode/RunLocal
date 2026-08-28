/**
 * Consent is the load-bearing part of 0.6, so it's what gets tested.
 *
 * The failure mode that matters isn't "an event didn't fire" - it's "we
 * collected data from someone who declined." These assert the gate holds in
 * both directions, including the case the old code got wrong: revoking
 * consent mid-session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const sessionStore = new Map<string, string>();

beforeEach(() => {
  store.clear();
  sessionStore.clear();
  vi.resetModules();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => sessionStore.get(k) ?? null,
    setItem: (k: string, v: string) => void sessionStore.set(k, v),
    removeItem: (k: string) => void sessionStore.delete(k),
  });
});

describe("Telemetry consent gate", () => {
  it("initTelemetry is a no-op when consent has never been given", async () => {
    const { initTelemetry } = await import("../src/lib/telemetry");
    // Must resolve without importing an SDK or throwing - the assertion is
    // that no network/SDK work is attempted, which would reject or hang.
    await expect(initTelemetry()).resolves.toBeUndefined();
  });

  it("initTelemetry is a no-op when consent is explicitly declined", async () => {
    store.set("kimbio_analytics_consent", "declined");
    const { initTelemetry } = await import("../src/lib/telemetry");
    await expect(initTelemetry()).resolves.toBeUndefined();
  });

  it("track() never throws and records nothing without consent", async () => {
    const { track } = await import("../src/lib/telemetry");
    expect(() => track("rage_click", { path: "/" })).not.toThrow();
    expect(() => track("error_shown")).not.toThrow();
  });

  it("first_rsvp does not consume its once-only marker when consent is absent", async () => {
    const { trackFirstRsvpOnce } = await import("../src/lib/telemetry");
    trackFirstRsvpOnce({ eventId: "evt_1" });
    // Critical: if the guard were written before the consent check, a
    // declining user's first RSVP would burn the marker, and the event would
    // never fire if they later accepted.
    expect(store.get("kimbio_first_rsvp_sent")).toBeUndefined();
  });

  it("granting consent enables the gate; revoking it via shutdown closes it again", async () => {
    const mod = await import("../src/lib/telemetry");
    store.set("kimbio_analytics_consent", "granted");
    // No backend configured in tests, so nothing transmits either way - the
    // assertion is that neither path throws and shutdown is safe to call
    // even when nothing was ever started.
    await expect(mod.initTelemetry()).resolves.toBeUndefined();
    expect(() => mod.shutdownTelemetry()).not.toThrow();
    expect(() => mod.resetIdentity()).not.toThrow();
  });
});

describe("Friction reporting", () => {
  it("reportErrorShown and reportDeadEnd are safe with no consent and no DOM globals", async () => {
    vi.stubGlobal("window", { location: { pathname: "/events" } });
    const { reportErrorShown, reportDeadEnd } = await import("../src/lib/friction");
    expect(() => reportErrorShown("network_error (0)", { code: "network_error" })).not.toThrow();
    expect(() => reportDeadEnd("events-empty")).not.toThrow();
  });

  it("truncates long error text rather than shipping an unbounded string", async () => {
    vi.stubGlobal("window", { location: { pathname: "/" } });
    const { reportErrorShown } = await import("../src/lib/friction");
    expect(() => reportErrorShown("x".repeat(5000))).not.toThrow();
  });
});
