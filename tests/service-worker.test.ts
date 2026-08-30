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
