import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { staticHeaders } from "../src/server/static";

const root = resolve(process.cwd());
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("service worker freshness (/app mount)", () => {
  it("keeps a stamped build placeholder that publish.sh replaces", () => {
    const sw = read("public/sw.js");
    expect(sw).toContain('const BUILD_ID = "__BUILD_ID__"');
    expect(sw).toContain("runlocal-shell-${BUILD_ID}");
  });

  it("precaches the /app shell paths, not the root-scope shell", () => {
    const sw = read("public/sw.js");
    expect(sw).toContain('new URL("/app/", self.location.origin)');
    expect(sw).toContain("${BASE}index.html");
    expect(sw).toContain("${BASE}manifest.webmanifest");
    expect(sw).toContain("${BASE}favicon.svg");
    expect(sw).toContain("cache.addAll(SHELL)");
    // Identity endpoints are never cached — state must always be fresh.
    expect(sw).toContain('url.pathname.startsWith("/api/")');
    expect(sw).toContain('url.pathname.startsWith("/uploads/")');
  });

  it("deletes stale runlocal-shell caches on activate and claims clients", () => {
    const sw = read("public/sw.js");
    expect(sw).toContain('key.startsWith("runlocal-shell-")');
    expect(sw).toContain("key !== CACHE");
    expect(sw).toContain("caches.delete(key)");
    expect(sw).toContain("self.clients.claim()");
  });

  it("only skip-waits in response to an explicit SKIP_WAITING message", () => {
    const sw = read("public/sw.js");
    // The install handler must not force activation — a new worker waits for
    // the update banner's user consent instead of hijacking open tabs.
    const install = sw.slice(sw.indexOf('self.addEventListener("install"'), sw.indexOf('self.addEventListener("activate"'));
    expect(install).not.toContain("skipWaiting");
    // skipWaiting is gated behind the banner's SKIP_WAITING message.
    const message = sw.slice(sw.indexOf('self.addEventListener("message"'), sw.indexOf('self.addEventListener("fetch"'));
    expect(message).toContain('event.data?.type === "SKIP_WAITING"');
    expect(message).toContain("self.skipWaiting()");
  });
});

describe("service worker registration (updateViaCache none)", () => {
  it("mounts the update banner only in production builds", () => {
    const main = read("src/main.tsx");
    expect(main).toContain('import { ServiceWorkerUpdate } from "./components/ServiceWorkerUpdate"');
    expect(main).toContain("import.meta.env.PROD && <ServiceWorkerUpdate />");
  });

  it("registers /app/sw.js with updateViaCache none", () => {
    const updater = read("src/components/ServiceWorkerUpdate.tsx");
    expect(updater).toContain('new URL("/app/", window.location.origin).pathname}sw.js');
    expect(updater).toContain('updateViaCache: "none"');
  });

  it("keeps the registration path aligned with the vite app base", () => {
    const viteConfig = read("vite.config.ts");
    expect(viteConfig).toMatch(/base: "\/app\/"/);
    const updater = read("src/components/ServiceWorkerUpdate.tsx");
    expect(updater).toContain('new URL("/app/", window.location.origin)');
  });
});

describe("update banner markup", () => {
  it("exposes accessible status text with Refresh and Dismiss controls", () => {
    const src = read("src/components/ServiceWorkerUpdate.tsx");
    expect(src).toContain('role="status"');
    expect(src).toContain("A new version is available");
    expect(src).toContain(">Refresh</button>");
    expect(src).toContain(">Dismiss</button>");
    expect(src).toContain('type="button"');
    // Refresh asks the waiting worker to skip waiting; Dismiss clears the banner.
    expect(src).toContain('waiting.postMessage({ type: "SKIP_WAITING" })');
    expect(src).toContain("setWaiting(null)");
  });
});

describe("web app manifest (/app scope)", () => {
  it("points id/start_url/scope at /app and ships /app icon paths", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
      id: string;
      start_url: string;
      scope: string;
      icons: Array<{ src: string; sizes: string; type: string }>;
    };
    expect(manifest.id).toBe("/app/");
    expect(manifest.start_url).toBe("/app/");
    expect(manifest.scope).toBe("/app/");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/app/icons/icon-192.png", sizes: "192x192" }),
        expect.objectContaining({ src: "/app/icons/icon-512.png", sizes: "512x512" }),
        expect.objectContaining({ src: "/app/favicon.svg", sizes: "any" }),
      ]),
    );
  });
});

describe("publish build verification", () => {
  it("stamps a per-deployment BUILD_ID into the built sw.js", () => {
    const publish = read("publish.sh");
    expect(publish).toContain('BUILD_ID="$(git rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M%S)"');
    expect(publish).toContain('export VITE_BUILD_ID="$BUILD_ID"');
    expect(publish).toContain('sed -i "s/__BUILD_ID__/$BUILD_ID/g" dist/sw.js');
  });

  it("verifies the live SW marker, MIME type, and manifest cache headers", () => {
    const publish = read("publish.sh");
    expect(publish).toContain("curl -sf http://localhost:3000/app/sw.js | grep -q 'runlocal-shell-'");
    expect(publish).toContain("curl -sfI http://localhost:3000/app/sw.js | grep -qi 'content-type: text/javascript'");
    expect(publish).toContain("curl -sfI http://localhost:3000/app/manifest.webmanifest | grep -qi 'cache-control: no-cache'");
    expect(publish).toContain("exit 1");
  });
});

describe("static cache headers for freshness-critical files", () => {
  it("serves sw.js, manifest, and documents with no-cache", () => {
    expect(staticHeaders("/sw.js")["cache-control"]).toBe("no-cache");
    expect(staticHeaders("/manifest.webmanifest")["cache-control"]).toBe("no-cache");
    expect(staticHeaders("/index.html")["cache-control"]).toBe("no-cache");
  });

  it("keeps cache lifetimes for non-script static assets", () => {
    expect(staticHeaders("/icons/icon-192.png")["cache-control"]).toBe("public, max-age=3600");
    expect(staticHeaders("/styles/app.css")["cache-control"]).toBe("public, max-age=3600");
  });
});
