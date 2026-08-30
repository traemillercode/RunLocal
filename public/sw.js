/* Run Local service worker. BUILD_ID is replaced by publish.sh. */
const BUILD_ID = "__BUILD_ID__";
const CACHE = `runlocal-shell-${BUILD_ID}`;
const BASE = new URL("/", self.location.origin).pathname;
const SHELL = [BASE, `${BASE}index.html`, `${BASE}manifest.webmanifest`, `${BASE}favicon.svg`];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("runlocal-shell-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (event) => { if (event.data?.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          /*
           * CLONE SYNCHRONOUSLY, BEFORE RETURNING.
           *
           * This used to clone INSIDE the caches.open().then() callback. That
           * callback runs asynchronously — by the time it fires, `return
           * response` has already handed the body to the browser and it is
           * spent, so clone() throws "Response body is already used". The throw
           * is an unhandled rejection inside the worker, and from the page's
           * side the fetch simply rejects: a real network failure, caused by
           * the proxy in front of it.
           *
           * Shipped 22 August, so it predates today and is a candidate for the
           * earlier reports that could not be reproduced — a fetch failing
           * intermittently depending on which paths the worker intercepts looks
           * exactly like "things aren't showing".
           */
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(`${BASE}index.html`, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(`${BASE}index.html`)),
    );
    return;
  }
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          // Same ordering rule as the navigate branch above: clone before the
          // body can be consumed, never inside an async callback.
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        }),
    ),
  );
});
