import { useEffect, useState } from "react";
import { getConsent, setConsent } from "../lib/analytics";
import { initTelemetry } from "../lib/telemetry";

/**
 * TEMPORARY — Sentry smoke test. Delete this file and its route once the test
 * error has been confirmed in Sentry Issues.
 *
 * Exists because getkimbio.com is blocked by a corporate DNS filter on the
 * owner's work machine (new domain, no reputation yet), so the browser-console
 * method isn't available. This gives a phone-tappable equivalent.
 *
 * Deliberately self-diagnosing rather than a bare button. Sentry only
 * initializes after consent is granted AND a DSN is configured, so a plain
 * "throw" button that produced nothing in Sentry would be ambiguous between
 * three very different causes: consent not granted, DSN missing from the
 * build, or the pipeline genuinely broken. This page distinguishes them
 * before you tap anything.
 */
export function SentryTestPage() {
  const [consent, setConsentState] = useState<string | null>(null);
  const [sentryLoaded, setSentryLoaded] = useState<boolean | null>(null);
  const [thrown, setThrown] = useState<string | null>(null);

  const dsnConfigured = Boolean((import.meta.env as Record<string, unknown>).VITE_SENTRY_DSN);
  const buildId = String((import.meta.env as Record<string, unknown>).VITE_BUILD_ID ?? "unknown");

  const refresh = () => {
    setConsentState(getConsent());
    void import("@sentry/react")
      .then((S) => setSentryLoaded(Boolean(S.getClient())))
      .catch(() => setSentryLoaded(false));
  };

  useEffect(refresh, []);

  const grantAndInit = async () => {
    setConsent("granted");
    await initTelemetry();
    // Give the dynamic import a beat to register the client before re-reading.
    setTimeout(refresh, 600);
  };

  /** Real uncaught error - exercises Sentry's global handler, the same path a genuine crash takes. */
  const throwUncaught = () => {
    setThrown(`Uncaught thrown at ${new Date().toISOString()}`);
    setTimeout(() => {
      throw new Error(`Kimbio Sentry smoke test (uncaught) — build ${buildId}`);
    }, 0);
  };

  /** Explicit capture - proves transport works even if the global handler is interfered with. */
  const captureExplicit = async () => {
    const S = await import("@sentry/react");
    S.captureException(new Error(`Kimbio Sentry smoke test (captured) — build ${buildId}`));
    setThrown(`Captured and sent at ${new Date().toISOString()}`);
  };

  const row = (label: string, value: string, ok: boolean | null) => (
    <div className="flex items-center justify-between border-b border-slate-100 py-2">
      <span className="text-[13px] text-slate-600">{label}</span>
      <span className={`text-[13px] font-bold ${ok === null ? "text-slate-400" : ok ? "text-emerald-600" : "text-rose-600"}`}>{value}</span>
    </div>
  );

  const ready = consent === "granted" && dsnConfigured && sentryLoaded === true;

  return (
    <div className="mx-auto max-w-md px-4 py-6 pb-32">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Temporary diagnostic</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Sentry smoke test</h1>
      <p className="mt-1 text-sm text-slate-500">This page is temporary and will be removed once the test error is confirmed.</p>

      <div className="mt-5 rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
        {row("DSN in this build", dsnConfigured ? "configured" : "MISSING", dsnConfigured)}
        {row("Analytics consent", consent ?? "not chosen", consent === "granted")}
        {row("Sentry client live", sentryLoaded === null ? "checking…" : sentryLoaded ? "yes" : "no", sentryLoaded)}
        {row("Build", buildId.slice(0, 12), null)}
      </div>

      {consent !== "granted" ? (
        <button type="button" onClick={() => void grantAndInit()} className="mt-4 h-11 w-full rounded-xl bg-[#14171C] text-[14px] font-bold text-white">
          Grant consent &amp; start Sentry
        </button>
      ) : null}

      {!ready && consent === "granted" ? (
        <button type="button" onClick={refresh} className="mt-3 h-11 w-full rounded-xl bg-slate-100 text-[14px] font-bold text-slate-700">
          Re-check status
        </button>
      ) : null}

      <div className="mt-4 space-y-2">
        <button type="button" disabled={!ready} onClick={captureExplicit} className="h-11 w-full rounded-xl bg-[#FF5741] text-[14px] font-bold text-[#14171C] disabled:opacity-40">
          Send captured test error
        </button>
        <button type="button" disabled={!ready} onClick={throwUncaught} className="h-11 w-full rounded-xl bg-slate-100 text-[14px] font-bold text-slate-700 disabled:opacity-40">
          Throw uncaught test error
        </button>
      </div>

      {thrown ? <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-[13px] font-semibold text-emerald-800">{thrown} — check Sentry Issues.</p> : null}

      {!dsnConfigured ? (
        <p className="mt-4 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-800">
          No DSN in this build. VITE_ vars bake in at build time, so setting it needs a fresh build, not a cached redeploy.
        </p>
      ) : null}
    </div>
  );
}
