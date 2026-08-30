/**
 * The service worker, which sits in front of every request and was untested.
 *
 * Two defects in one day — the __BUILD_ID__ placeholder that pinned stale
 * shells indefinitely, and a clone-after-consume that made fetches reject
 * outright. Neither appeared in the suite, because nothing exercised sw.js in a
 * real fetch path, and neither was visible from the server side: curl does not
 * go through a service worker, so every probe said the endpoint was fine.
 *
 * These are structural assertions rather than a runtime harness. A full
 * ServiceWorkerGlobalScope fake would be closer to the truth and is a
 * disproportionate amount of machinery for a 30-line file; what these catch is
 * the specific shape of both bugs, which is what recurred.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SW = readFileSync(new URL("../public/sw.js", import.meta.url).pathname, "utf8");

describe("responses are cloned before their body is consumed", () => {
  /*
   * THE BUG: `caches.open(CACHE).then((cache) => cache.put(k, response.clone()))`
   * clones INSIDE an async callback. By the time it runs, `return response` has
   * handed the body to the browser and it is spent — clone() throws "Response
   * body is already used", the worker rejects, and the page sees a network
   * failure caused by the proxy in front of it.
   *
   * Shipped 22 August, so it predates today's reports.
   */
  it("never calls .clone() inside a caches.open callback", () => {
    // The exact broken shape: a clone lexically inside `caches.open(...).then(`.
    const broken = /caches\.open\([^)]*\)\s*\.then\([^)]*\)\s*=>\s*[^)]*\.clone\(\)/.test(SW);
    expect(broken).toBe(false);
  });

  it("assigns the clone to a variable first, then caches that", () => {
    // Synchronous clone, async put. The put may resolve whenever it likes; the
    // clone must already exist.
    expect(SW).toContain("const copy = response.clone();");
    expect((SW.match(/const copy = response\.clone\(\);/g) ?? []).length).toBe(2);
    expect(SW).toContain("cache.put(request, copy)");
  });

  it("a failed cache write cannot reject into the page", () => {
    // caches.open can fail (quota, private mode). Without a catch that becomes
    // another unhandled rejection in the worker.
    expect((SW.match(/\.catch\(\(\) => \{\}\)/g) ?? []).length).toBe(2);
  });
});

describe("the cache name changes per build", () => {
  it("derives from BUILD_ID, which the build stamps", () => {
    // The other defect: BUILD_ID was the literal "__BUILD_ID__" because
    // publish.sh replaced it and Railway never ran publish.sh. The cache name
    // never changed, so the activate cleanup never matched and a visitor kept
    // their first-visit shell forever.
    expect(SW).toContain("runlocal-shell-${BUILD_ID}");
    expect(SW).toContain('key.startsWith("runlocal-shell-") && key !== CACHE');
  });
});

describe("API traffic is never intercepted", () => {
  it("bails out before touching /api/", () => {
    /*
     * Worth pinning. If the worker ever started caching API responses, a stale
     * admin payload or a cached 401 would be indistinguishable from a server
     * bug — and the last two days show how long that takes to find.
     */
    expect(SW).toContain('url.pathname.startsWith("/api/")');
    const bail = SW.indexOf('url.pathname.startsWith("/api/")');
    const firstRespond = SW.indexOf("event.respondWith");
    expect(bail).toBeLessThan(firstRespond);
  });
});

describe("a new worker takes over without closing every tab", () => {
  /*
   * Without skipWaiting, a reload is NOT enough: the tab stays alive, the old
   * worker keeps controlling the page, and the new one sits in `waiting`
   * indefinitely. That is why testing the clone fix took three rounds, and it
   * compounds every caching problem — the fix ships, the tester reloads, and
   * nothing changes.
   */
  it("skipWaiting on install and clients.claim on activate", () => {
    expect(SW).toContain("self.skipWaiting();");
    expect(SW).toContain("self.clients.claim()");
    // skipWaiting must be in INSTALL — in activate it is too late to matter.
    const install = SW.slice(SW.indexOf('addEventListener("install"'), SW.indexOf('addEventListener("activate"'));
    expect(install).toContain("self.skipWaiting();");
  });

  it("still honours an explicit SKIP_WAITING message", () => {
    // The Refresh button posts this. Redundant with skipWaiting on install, and
    // harmless — it covers a worker that installed before this change shipped.
    expect(SW).toContain('event.data?.type === "SKIP_WAITING"');
  });
});

describe("the client can tell it is running a stale bundle", () => {
  const UPDATE = readFileSync(new URL("../src/components/ServiceWorkerUpdate.tsx", import.meta.url).pathname, "utf8");
  const APP = readFileSync(new URL("../src/App.tsx", import.meta.url).pathname, "utf8");

  it("compares its own build against one the server answers fresh", () => {
    /*
     * The footer stamp comes from import.meta.env at BUILD time, so a stale
     * bundle honestly reports its own build — correct, and useless for the one
     * thing the stamp exists to do. Four rounds today across three reports.
     */
    expect(UPDATE).toContain("VITE_BUILD_ID");
    expect(UPDATE).toContain('fetch("/api/health"');
    expect(UPDATE).toContain("d.build !== mine");
  });

  it("does not flag staleness when the server cannot answer", () => {
    // A server that does not know its build must not make every client think
    // it is stale, and offline is not stale.
    expect(UPDATE).toContain("d?.build && d.build !== mine");
    expect(UPDATE).toContain("/* offline is not stale */");
  });

  it("is actually mounted", () => {
    // It was not. Nothing rendered it, which is the second reason the prompt
    // never appeared — the first being that the cache name never changed.
    expect(APP).toContain("<ServiceWorkerUpdate />");
  });
});
