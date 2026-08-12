/**
 * Regression tests for the desktop layout hardening branch
 * (feat/desktop-layout-hardening).
 *
 * Two layers, using the repo's existing node-environment patterns (no jsdom):
 *  - CSS source assertions (like tests/desktop-layout.test.ts) pin the
 *    desktop-* gating: hover affordances live ONLY inside the
 *    `(min-width: 1024px) and (hover: hover) and (pointer: fine)` gate,
 *    `.desktop-account-action` styling only inside `(min-width: 1024px)`, and
 *    the mobile-first gate (sidebar hidden by default; mobile header/bottom
 *    nav hidden only at the desktop breakpoint) stays intact.
 *  - renderToStaticMarkup of the REAL DesktopSidebar with only `useAccount`
 *    mocked (like tests/header-auth.test.tsx) pins the authenticated
 *    Profile / Settings / Sign out affordances and the guest Log in fallback.
 *
 * Auth stays honest: the UI tests only assert what signed-in users/guests
 * see, never client-side role powers.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DesktopSidebar } from "../src/components/DesktopSidebar";
import { CITIES } from "../src/data/cities";
import type { Me, PublicAccount } from "../src/lib/accounts";

const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));

function readCss(): string {
  return readFileSync(resolve(process.cwd(), "src/styles/app.css"), "utf8");
}
function readPage(name: string): string {
  return readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");
}

/** Split the stylesheet into the un-gated base chunk plus one chunk per @media block. */
function mediaChunks(cssText: string): { header: string; body: string }[] {
  const chunks = cssText.split("@media");
  return [
    { header: "", body: chunks[0] },
    ...chunks.slice(1).map((chunk) => {
      const open = chunk.indexOf("{");
      return { header: chunk.slice(0, open).trim(), body: chunk.slice(open + 1) };
    }),
  ];
}

function verifiedAccount(patch: Partial<PublicAccount> = {}): PublicAccount {
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
    roles: patch.roles ?? ["runner"],
  };
}

describe("desktop hardening CSS gating", () => {
  it("keeps Profile/Settings/Admin mobile max-width/padding while adding desktop-reading", () => {
    for (const file of ["ProfilePage.tsx", "SettingsPage.tsx"]) {
      const page = readPage(file);
      // The mobile-first column classes are retained verbatim...
      expect(page).toContain("mx-auto w-full max-w-md px-4 pb-32 pt-4");
      // ...and desktop-reading is an addition on the SAME element, not a replacement.
      expect(page).toContain("mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading");
    }
    const admin = readPage("AdminPage.tsx");
    expect(admin).toContain("mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading");
    expect(admin).toContain("mx-auto w-full max-w-md px-4 pb-32 pt-6 desktop-reading");
    // No Admin branch lost the mobile shell while gaining the reading class.
    expect(admin.match(/mx-auto w-full max-w-md px-4/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("widens the reading column only at the desktop breakpoint", () => {
    const cssText = readCss();
    const desktop = cssText.slice(cssText.indexOf("@media (min-width: 1024px)"));
    expect(desktop).toContain(".desktop-main > .desktop-reading { max-width: 1240px !important; }");
  });

  it("keeps the mobile-first gate: sidebar hidden by default, mobile header/nav hidden only at 1024px", () => {
    const cssText = readCss();
    const firstDesktop = cssText.indexOf("@media (min-width: 1024px)");
    // Sidebar is out of the mobile document flow entirely (pre-1024 base CSS)...
    expect(cssText.slice(0, firstDesktop)).toContain(".desktop-sidebar { display: none; }");
    const desktop = cssText.slice(firstDesktop);
    // ...and the mobile chrome (sticky header, bottom nav) is hidden only at the desktop breakpoint.
    expect(desktop).toContain(".app-shell-header, .app-shell-nav { display: none; }");
    expect(desktop).toContain(".desktop-sidebar { position: fixed; inset: 0 auto 0 0;");
  });

  it("keeps every hardening hover selector inside the (min-width:1024px)+(hover:hover)+(pointer:fine) gate", () => {
    const chunks = mediaChunks(readCss());
    // No hover behavior outside a media query — touch devices never get hover-only affordances.
    expect(chunks[0].body).not.toContain(":hover");
    // Every hover affordance added by the hardening commit must live ONLY inside
    // the full pointer gate (pre-existing desktop nav hover states are base behavior).
    const hardeningHovers = [
      ".desktop-event-card:hover",
      ".desktop-race-card:hover",
      ".desktop-forum-card:hover",
      ".desktop-group-card:hover",
      ".desktop-detail-card:hover",
      ".desktop-detail-panel:hover",
    ];
    for (const sel of hardeningHovers) {
      const owners = chunks.filter((c) => c.body.includes(sel));
      expect(owners, sel).toHaveLength(1);
      expect(owners[0].header).toBe("(min-width: 1024px) and (hover: hover) and (pointer: fine)");
    }
    // The gate also carries the matching transitions — nothing transition-related
    // leaks outside it.
    const hoverBlock = chunks.find(
      (c) => c.header === "(min-width: 1024px) and (hover: hover) and (pointer: fine)" && c.body.includes("desktop-event-card"),
    );
    expect(hoverBlock).toBeDefined();
    expect(hoverBlock!.body).toContain("transform: translateY(-2px)");
    expect(hoverBlock!.body).toContain("transition: transform 160ms ease, box-shadow 160ms ease;");
  });

  it("does not leak the new desktop rules outside their media gates", () => {
    const chunks = mediaChunks(readCss());
    const newSelectors = [
      "desktop-event-card",
      "desktop-race-card",
      "desktop-forum-card",
      "desktop-group-card",
      "desktop-detail-card",
      "desktop-account-action",
    ];
    // None of the hardening selectors appear in the un-gated base CSS.
    for (const sel of newSelectors) {
      expect(chunks[0].body).not.toContain(`.${sel}`);
    }
    // The card classes are defined ONLY inside the hover gate (as hover/transition rules).
    for (const sel of newSelectors.filter((s) => s !== "desktop-account-action")) {
      const owners = chunks.filter((c) => c.body.includes(`.${sel}`));
      expect(owners).toHaveLength(1);
      expect(owners[0].header).toBe("(min-width: 1024px) and (hover: hover) and (pointer: fine)");
    }
    // The Sign out button styling is a functional control: it lives in the plain
    // 1024px block so ≥1024px touch screens get it too — never in the hover-only gate.
    const actionOwners = chunks.filter((c) => c.body.includes(".desktop-account-action"));
    expect(actionOwners).toHaveLength(1);
    expect(actionOwners[0].header).toBe("(min-width: 1024px)");
    const hoverGate = chunks.find((c) => c.header === "(min-width: 1024px) and (hover: hover) and (pointer: fine)");
    expect(hoverGate!.body).not.toContain(".desktop-account-action");
  });
});

describe("DesktopSidebar authenticated account affordances (UI)", () => {
  function renderSidebar(): string {
    return renderToStaticMarkup(
      <MemoryRouter>
        <DesktopSidebar city={CITIES[0]} onOpenCitySheet={() => {}} />
      </MemoryRouter>,
    );
  }

  it("renders Profile, Settings and Sign out for signed-in users", () => {
    useAccountMock.mockReturnValue({
      me: { status: "signed_in", account: verifiedAccount() } satisfies Me,
      backendAvailable: true,
      refresh: async () => {},
      signOut: async () => {},
      deleteMyAccount: async () => ({ ok: false, error: new Error("unavailable") }),
      role: "verified",
    });
    const html = renderSidebar();
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('class="desktop-sidebar"');
    // Profile link appears in the main nav AND as the account row entry.
    expect(html.match(/href="\/profile"/g)).toHaveLength(2);
    // Settings and Sign out exist only in the authenticated account area.
    expect(html).toContain('href="/settings"');
    expect(html).toContain('<button type="button" class="desktop-account-action"');
    expect(html).toContain("Sign out");
    expect(html).not.toContain('href="/login"');
  });

  it("wires the Sign out button to the account store's signOut", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/DesktopSidebar.tsx"), "utf8");
    expect(source).toContain("const { me, signOut } = useAccount();");
    expect(source).toContain("onClick={() => void signOut()}");
  });

  it("falls back to a Log in link for guests (no account affordances)", () => {
    useAccountMock.mockReturnValue({
      me: { status: "guest" } satisfies Me,
      backendAvailable: true,
      refresh: async () => {},
      signOut: async () => {},
      deleteMyAccount: async () => ({ ok: false, error: new Error("unavailable") }),
      role: "guest",
    });
    const html = renderSidebar();
    expect(html).toContain('href="/login"');
    expect(html).toContain(">Log in<");
    expect(html).not.toContain("Sign out");
    expect(html).not.toContain('href="/settings"');
    expect(html).not.toContain("desktop-account-action");
    // The nav still links to Profile for guests, but there is no account row for it.
    expect(html.match(/href="\/profile"/g)).toHaveLength(1);
  });
});
