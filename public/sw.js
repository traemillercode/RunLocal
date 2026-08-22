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
    event.respondWith(fetch(request).then((response) => { caches.open(CACHE).then((cache) => cache.put(`${BASE}index.html`, response.clone())); return response; }).catch(() => caches.match(`${BASE}index.html`)));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => { if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone())); return response; })));
});
