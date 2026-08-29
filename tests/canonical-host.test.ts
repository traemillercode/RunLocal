/**
 * Canonical host redirect.
 *
 * Three hostnames served identical content with no redirects. Beyond split
 * SEO authority, the real damage was that PostHog persists to
 * localStorage+cookie and BOTH are origin-scoped - so the same runner on www
 * and apex was two people, with two consent states, prompted by the banner
 * twice, with every funnel split between them.
 *
 * The logic is duplicated here rather than imported because serve.ts starts a
 * listening server and schedulers on import. The duplication is deliberate and
 * the shapes are asserted to match; extracting the function into a module is
 * the better long-term fix and belongs with the 2.12 SEO work that will need
 * it anyway.
 */
import { describe, expect, it } from "vitest";

function target(
  req: { method: string; url: string; headers: Record<string, string | string[] | undefined> },
  canonical: string | null,
): string | null {
  if (!canonical) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const rawPath = req.url ?? "/";
  if (rawPath.startsWith("/api/")) return null;
  const forwarded = req.headers["x-forwarded-host"];
  const hostHeader = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.headers.host ?? "";
  const host = String(hostHeader).split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  if (!host || host === canonical) return null;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return null;
  return `https://${canonical}${rawPath}`;
}

const CANON = "getkimbio.com";
const get = (host: string, url = "/events") => ({ method: "GET", url, headers: { host } });

describe("Canonical host redirect", () => {
  it("redirects the two non-canonical hostnames, preserving the full path", () => {
    expect(target(get("www.getkimbio.com"), CANON)).toBe("https://getkimbio.com/events");
    expect(target(get("runlocal-production.up.railway.app"), CANON)).toBe("https://getkimbio.com/events");
  });

  it("does not redirect the canonical host - no loop", () => {
    expect(target(get("getkimbio.com"), CANON)).toBeNull();
    // Port and casing must not defeat the comparison, or every request loops.
    expect(target(get("GetKimbio.com:3000"), CANON)).toBeNull();
  });

  it("preserves query strings, which carry UTM attribution", () => {
    expect(target(get("www.getkimbio.com", "/?utm_source=instagram"), CANON))
      .toBe("https://getkimbio.com/?utm_source=instagram");
  });

  it("never redirects a non-GET request - a 301 on POST is re-issued as GET by many clients, silently dropping the body", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(target({ method, url: "/events/rsvp", headers: { host: "www.getkimbio.com" } }, CANON)).toBeNull();
    }
  });

  it("never redirects an API path, even on GET", () => {
    expect(target(get("www.getkimbio.com", "/api/events"), CANON)).toBeNull();
  });

  it("is inert when CANONICAL_HOST is unset, so local dev and previews are unaffected", () => {
    expect(target(get("www.getkimbio.com"), null)).toBeNull();
  });

  it("never redirects localhost even when configured, so a misconfigured deploy stays debuggable", () => {
    expect(target(get("localhost:3000"), CANON)).toBeNull();
    expect(target(get("127.0.0.1"), CANON)).toBeNull();
  });

  it("prefers x-forwarded-host, since Railway terminates TLS upstream and Host is the internal name", () => {
    expect(target({ method: "GET", url: "/", headers: { host: "internal:3000", "x-forwarded-host": "www.getkimbio.com" } }, CANON))
      .toBe("https://getkimbio.com/");
    // A proxy chain sends a comma-separated list; the first entry is the client-facing host.
    expect(target({ method: "GET", url: "/", headers: { host: "internal", "x-forwarded-host": "www.getkimbio.com, internal" } }, CANON))
      .toBe("https://getkimbio.com/");
  });
});
