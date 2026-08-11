/**
 * Task 8 — live-surface copy truthfulness guards.
 *
 * The app has moved past MVP/preview framing: RSVPs are server-backed
 * (My Runs), identity verification is live, group memberships and community
 * submissions ship, and the public entry must link into the functional /app
 * experience without promising features that do not exist (social feeds,
 * provider calendar sync, etc.).
 *
 * These tests pin the REMOVED stale claims (source-level, like the repo's
 * other hardening tests) and the REPLACEMENT truthful copy (render-level for
 * the public MarketingPage and the verified ProfilePage, data-level for the
 * seeded welcome post).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { MarketingPage } from "../src/pages/MarketingPage";
import { ProfilePage } from "../src/pages/ProfilePage";
import { CITIES } from "../src/data/cities";
import type { Me, PublicAccount } from "../src/lib/accounts";

const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));
function auth(account: PublicAccount | null) {
  const me: Me = account ? { status: "signed_in", account } : { status: "guest" };
  useAccountMock.mockReturnValue({
    me,
    backendAvailable: true,
    refresh: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    deleteMyAccount: vi.fn(async () => ({ ok: false, error: new Error("unavailable") })),
    role: account?.status === "verified" ? "verified" : account ? "pending" : "guest",
  });
}
function account(patch: Partial<PublicAccount> = {}): PublicAccount {
  return {
    id: "acc_1",
    name: "Taylor Runner",
    email: "taylor@example.com",
    username: "taylor_runs",
    cityId: "columbia-mo",
    status: "verified",
    phase: null,
    badge: "verified",
    role: "runner",
    isOwner: false,
    suspended: false,
    underReview: false,
    profilePhotoUrl: null,
    ...patch,
  };
}
const city = CITIES[0];
const noop = () => {};
const store = { state: { cityId: city.id, rsvped: {} }, setCityId: noop, toggleRsvp: noop };

describe("MarketingPage — truthful public landing copy", () => {
  it("links into the app without stale preview/MVP claims", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MarketingPage />
      </MemoryRouter>,
    );
    expect(html).toContain("Columbia, MO");
    expect(html).toContain("/events");
    expect(html).toContain("/login?mode=signup");
    // Shipped features are described as live; not-yet-shipped ones are not overstated.
    expect(html).toContain("Strava connection is supported");
    expect(html).toContain("Verified-member posting is the next step");
    expect(html).toContain("Matching and discovery are planned");
    // No stale preview/MVP framing or unverifiable claims.
    expect(html).not.toContain("Live preview");
    expect(html).not.toContain("browse the public preview");
    expect(html).not.toContain("Strava is active today");
    expect(html).not.toContain("Seeded listings are clearly marked");
  });
});

describe("ProfilePage — no fake sample memberships", () => {
  it("never renders sample group memberships or preview captions for verified users", () => {
    auth(account());
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProfilePage city={city} store={store} />
      </MemoryRouter>,
    );
    expect(html).toContain("My groups");
    expect(html).toContain("View my groups");
    expect(html).not.toContain("Sample — group membership");
    expect(html).not.toContain("+ 2 more");
    expect(html).not.toContain("client-side in this preview");
  });
});

describe("seeded welcome post — truthful launch copy", () => {
  it("no longer claims verification/posting launch in a later phase", () => {
    const columbia = CITIES.find((c) => c.id === "columbia-mo")!;
    const welcome = columbia.forum.find((p) => p.id === "p1")!;
    expect(welcome.body).toContain("Verification is live");
    expect(welcome.body).not.toContain("preview build");
    expect(welcome.body).not.toContain("later phase");
  });
});

describe("source-level copy guards (Task 8)", () => {
  const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
  const cases: [string, string[]][] = [
    ["src/pages/MarketingPage.tsx", ["Live preview", "Strava is active today", "browse the public preview", "Seeded listings are clearly marked"]],
    ["src/pages/ProfilePage.tsx", ["Sample — group membership", "client-side in this preview"]],
    ["src/pages/ForumPage.tsx", ["Preview build", "preview build", "Coming with verification"]],
    ["src/pages/RacesPage.tsx", ["for the MVP"]],
    ["src/data/cities.ts", ["preview build", "launch in a later phase"]],
    ["README.md", ["Zero backend", "not in this MVP"]],
  ];
  it("does not contain stale MVP/preview claims", () => {
    for (const [file, phrases] of cases) {
      const text = read(file);
      for (const phrase of phrases) {
        expect(text, `${file} should not contain ${JSON.stringify(phrase)}`).not.toContain(phrase);
      }
    }
  });
});
