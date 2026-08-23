/**
 * UTM capture + consent gate.
 *
 * Honest scope: this app has no analytics library wired in at all (no GA,
 * no Segment, nothing) - so "Accept enables tracking" can't mean "starts
 * sending events to a real analytics backend" yet, because there isn't one.
 * What this DOES do, for real: captures utm_source/utm_medium/utm_campaign
 * from the landing URL, holds them in sessionStorage (cleared when the tab
 * closes - never a persistent cross-session cookie), and attaches them to
 * the signup payload if the person converts - so ad-spend attribution
 * actually works the moment a real analytics tool gets wired in, without
 * needing to touch the signup flow again later.
 *
 * "Decline" means exactly what it says: nothing is captured, nothing is
 * stored, this file's functions become no-ops for the rest of the session.
 */

const CONSENT_KEY = "kimbio_analytics_consent"; // "granted" | "declined"
const UTM_KEY = "kimbio_utm";

export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

export function getConsent(): "granted" | "declined" | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "declined" ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(value: "granted" | "declined"): void {
  try {
    localStorage.setItem(CONSENT_KEY, value);
    if (value === "granted") captureUtmFromUrl();
    else sessionStorage.removeItem(UTM_KEY);
  } catch {
    // Storage can throw in locked-down/private browsing contexts - consent
    // still "works" in the sense that nothing gets captured either way.
  }
}

/** Reads utm_* from the current URL and stores them, but only if consent was already granted. Safe to call on every page load - it's a no-op once params are already captured or consent isn't granted. */
export function captureUtmFromUrl(): void {
  if (getConsent() !== "granted") return;
  try {
    if (sessionStorage.getItem(UTM_KEY)) return; // already captured this session
    const params = new URLSearchParams(window.location.search);
    const utm: UtmParams = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign"] as const) {
      const v = params.get(key);
      if (v) utm[key] = v.slice(0, 100);
    }
    if (Object.keys(utm).length > 0) sessionStorage.setItem(UTM_KEY, JSON.stringify(utm));
  } catch {
    // ignore
  }
}

/** Returns captured UTM params to attach to the signup payload, or an empty object if none were captured/consented to. */
export function getStoredUtm(): UtmParams {
  try {
    const raw = sessionStorage.getItem(UTM_KEY);
    return raw ? (JSON.parse(raw) as UtmParams) : {};
  } catch {
    return {};
  }
}
