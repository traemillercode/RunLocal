import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "../src/components/BottomNav";
import { MyRunsPage } from "../src/pages/MyRunsPage";
import type { Me, PublicAccount } from "../src/lib/accounts";

const { useAccountMock, getMyRunsMock } = vi.hoisted(() => ({ useAccountMock: vi.fn(), getMyRunsMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));
vi.mock("../src/lib/api", async () => { const actual = await vi.importActual<typeof import("../src/lib/api")>("../src/lib/api"); return { ...actual, getMyRuns: getMyRunsMock }; });

const account: PublicAccount = { id: "a1", name: "Runner", email: "runner@example.com", username: "runner", cityId: "columbia-mo", status: "verified", phase: null, badge: "verified", role: "runner", isOwner: false, suspended: false, underReview: false, profilePhotoUrl: null };
const auth = (me: Me | null) => useAccountMock.mockReturnValue({ me, backendAvailable: true, refresh: async () => {}, signOut: async () => {}, deleteMyAccount: async () => ({ ok: false, error: new Error("unavailable") }), role: me?.status === "signed_in" ? "verified" : "guest" });
const render = () => renderToStaticMarkup(<MemoryRouter><MyRunsPage /></MemoryRouter>);

describe("My Runs SSR UI", () => {
  it("prompts guests to sign in and links to login", () => { auth({ status: "guest" }); const html = render(); expect(html).toContain("Sign in to see your private RSVP list."); expect(html).toContain('href="/login"'); });
  it("renders the signed-in loading state without exposing public-sharing language", () => { auth({ status: "signed_in", account }); getMyRunsMock.mockReturnValue(new Promise(() => {})); const html = render(); expect(html).toContain("Loading your RSVPs"); expect(html).toContain("My Runs"); expect(html).toContain("Private"); expect(html).not.toContain("Share"); });
  it("keeps empty, error, upcoming ordering, and remove-RSVP copy in the SSR page contract", async () => { const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/pages/MyRunsPage.tsx", import.meta.url), "utf8")); expect(source).toContain("No RSVPs yet"); expect(source).toContain("We couldn't load your runs."); expect(source).toContain("Upcoming runs"); expect(source).toContain("Remove RSVP for"); expect(source).toContain("Only you can see it."); expect(source).toContain("runs.map"); });
  it("shows My Runs in primary navigation with the dedicated route", () => { const html = renderToStaticMarkup(<MemoryRouter><BottomNav /></MemoryRouter>); expect(html).toContain('href="/my-runs"'); expect(html).toContain("My Runs"); });
});
