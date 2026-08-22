import { useEffect, useState } from "react";

export function ServiceWorkerUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
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
  if (!waiting) return null;
  return <div role="status" className="fixed inset-x-3 bottom-3 z-[100] flex items-center justify-between gap-3 rounded-xl bg-[#14171C] px-4 py-3 text-sm text-white shadow-lg"><span>A new version is available</span><span className="flex gap-2"><button type="button" className="rounded-lg px-2 py-1 text-slate-300" onClick={() => setWaiting(null)}>Dismiss</button><button type="button" className="rounded-lg bg-[#FF5741] px-3 py-2 font-bold text-[#14171C]" onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}>Refresh</button></span></div>;
}
