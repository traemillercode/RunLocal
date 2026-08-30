import { useEffect, useState } from "react";

/**
 * Tells someone their bundle is out of date, by two independent routes.
 *
 * WAS NEVER MOUNTED — nothing rendered it, which is the second reason the
 * prompt never appeared (the first being that the cache name never changed, so
 * a new worker was never detected as different).
 *
 * The BUILD CHECK is the one that matters during a beta. The footer stamp comes
 * from import.meta.env at build time, so a stale bundle honestly reports its
 * own build: correct, and useless for confirming two people are looking at the
 * same code. Comparing it against /api/health — which the server answers fresh
 * every time — turns "your report is about code I fixed hours ago" from a
 * four-round diagnosis into a reload.
 */
export function ServiceWorkerUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [staleBundle, setStaleBundle] = useState(false);

  useEffect(() => {
    /*
     * Compared ONCE on mount, not polled. A stale bundle is a condition, not an
     * event — polling would add a request per interval to every session to
     * detect something that cannot change without a reload anyway.
     */
    const mine = String((import.meta.env as Record<string, unknown>).VITE_BUILD_ID ?? "").slice(0, 12);
    if (!mine || mine === "dev") return;
    let alive = true;
    void fetch("/api/health", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { build?: string | null } | null) => {
        // Only flag a real disagreement. A server that does not know its own
        // build must not make every client think it is stale.
        if (alive && d?.build && d.build !== mine) setStaleBundle(true);
      })
      .catch(() => { /* offline is not stale */ });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let registration: ServiceWorkerRegistration | undefined;
    const onControllerChange = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    const onLoad = async () => {
      // Self-heal: anyone who registered the old /app/-scoped worker before
      // this fix has it stuck in their browser forever otherwise — a new
      // registration at a different scope doesn't replace it, both would
      // just run side by side. Unregister anything at the defunct scope
      // before registering the real one.
      const existing = await navigator.serviceWorker.getRegistrations();
      await Promise.all(existing.filter((r) => r.scope.includes("/app/")).map((r) => r.unregister()));
      registration = await navigator.serviceWorker.register(`${new URL("/", window.location.origin).pathname}sw.js`, { updateViaCache: "none" });
      const controllerExists = Boolean(navigator.serviceWorker.controller);
      const inspect = () => { if (controllerExists && registration?.installing) setWaiting(registration.installing); };
      registration.addEventListener("updatefound", inspect);
      inspect();
    };
    window.addEventListener("load", onLoad, { once: true });
    return () => { window.removeEventListener("load", onLoad); navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange); };
  }, []);
  if (!waiting && !staleBundle) return null;
  // A stale bundle needs a hard reload; a waiting worker needs to be told to
  // activate first. Different actions, same prompt.
  const refresh = () => (waiting ? waiting.postMessage({ type: "SKIP_WAITING" }) : window.location.reload());
  return <div role="status" className="fixed inset-x-3 bottom-3 z-[100] flex items-center justify-between gap-3 rounded-xl bg-[#14171C] px-4 py-3 text-sm text-white shadow-lg"><span>A newer version of Kimbio is available</span><span className="flex gap-2"><button type="button" className="rounded-lg px-2 py-1 text-slate-300" onClick={() => { setWaiting(null); setStaleBundle(false); }}>Dismiss</button><button type="button" className="rounded-lg bg-[#FF5741] px-3 py-2 font-bold text-[#14171C]" onClick={refresh}>Refresh</button></span></div>;
}
