/**
 * SSR tests for the Phase 2b forum action-menu wiring (react-dom/server, no
 * jsdom — see runlocal-ui-tests-no-jsdom).
 *
 * The server sends per-account capability lists on every post/reply
 * (`ForumPostView.capabilities` / `ForumReplyView.capabilities`). PostCard and
 * ForumThread render the ActionMenu trigger ONLY when that list is non-empty:
 * guests, pending/rejected accounts, and empty lists render no trigger at all.
 *
 * Per-role menu CONTENT is pinned here through actionMenuItems():
 *  - author of own post/reply → Edit + Delete;
 *  - Global/City admin → Hide + Restore + Delete (posts; via the existing
 *    contentAdmin registry routes);
 *  - verified non-author → Report (the flag flow).
 * The full-page render pins the seed-post rule: admins get the admin-only
 * menu on seed posts (which have no server capabilities), everyone else gets
 * no trigger.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ForumPage, ForumThread, PostCard, type ForumPostRow } from "../src/pages/ForumPage";
import { actionMenuItems } from "../src/lib/actionModel";
import { CITIES } from "../src/data/cities";
import type { AccountRole, Me, PublicAccount } from "../src/lib/accounts";
import type { ForumReplyView } from "../src/lib/api";

const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));
const { useSelectedCityMock } = vi.hoisted(() => ({ useSelectedCityMock: vi.fn() }));
vi.mock("../src/state/city", () => ({ useSelectedCity: useSelectedCityMock }));

const city = CITIES[0];
const noop = () => {};

function postRow(capabilities: string[]): ForumPostRow {
  return {
    id: "p1",
    section: "community",
    title: "New group route",
    body: "We added a 5K loop along the river.",
    author: "Taylor Runner",
    createdAt: "Aug 1",
    replies: 2,
    capabilities,
  };
}

function replyRow(capabilities: string[]): ForumReplyView {
  return {
    id: "r1",
    postId: "p1",
    body: "See you at 6!",
    author: "Jordan Lee",
    createdAt: "Aug 3",
    authorId: "acc_2",
    capabilities,
  };
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

function auth(accountValue: PublicAccount | null, role: AccountRole) {
  const me: Me = accountValue ? { status: "signed_in", account: accountValue } : { status: "guest" };
  useAccountMock.mockReturnValue({
    me,
    backendAvailable: true,
    refresh: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    deleteMyAccount: vi.fn(async () => ({ ok: false, error: new Error("unavailable") })),
    role,
  });
}

function selectedCity() {
  useSelectedCityMock.mockReturnValue({
    city,
    cityId: city.id,
    signedIn: true,
    hasHomeCity: true,
    selectCity: vi.fn(async () => ({ ok: true })),
  });
}

describe("forum PostCard — action menu per role", () => {
  it("author of their own post gets Edit + Delete and an accessible trigger", () => {
    const caps = ["edit_own", "delete_own"];
    expect(actionMenuItems(caps).map((i) => i.label)).toEqual(["Edit", "Delete"]);
    const html = renderToStaticMarkup(
      <PostCard post={postRow(caps)} section="community" onReply={noop} verified onAction={noop} />,
    );
    expect(html).toContain('aria-label="Actions for New group route"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain('role="menu"'); // panel opens only on interaction (state)
  });

  it("Global/City admin gets Hide + Restore + Delete on any post", () => {
    const caps = ["hide", "restore", "delete"];
    expect(actionMenuItems(caps).map((i) => i.label)).toEqual(["Hide", "Restore", "Delete"]);
    const html = renderToStaticMarkup(
      <PostCard post={postRow(caps)} section="community" onReply={noop} verified onAction={noop} />,
    );
    expect(html).toContain('aria-label="Actions for New group route"');
  });

  it("verified non-author gets Report only", () => {
    const caps = ["report"];
    expect(actionMenuItems(caps).map((i) => i.label)).toEqual(["Report"]);
    const html = renderToStaticMarkup(
      <PostCard post={postRow(caps)} section="community" onReply={noop} verified onAction={noop} />,
    );
    expect(html).toContain('aria-label="Actions for New group route"');
  });

  it("guest (empty capability list) renders NO trigger at all", () => {
    const html = renderToStaticMarkup(<PostCard post={postRow([])} section="community" onReply={noop} verified={false} />);
    expect(html).not.toContain("Actions for");
    expect(html).not.toContain('aria-haspopup="menu"');
  });
});

describe("ForumThread — reply action menu per role", () => {
  it("reply author gets Edit + Delete with an accessible trigger", () => {
    const html = renderToStaticMarkup(
      <ForumThread role="verified" replies={[replyRow(["edit_own", "delete_own"])]} draft="" onDraftChange={noop} onSubmit={noop} />,
    );
    expect(html).toContain('aria-label="Actions for Reply by Jordan Lee"');
  });

  it("verified non-author gets Report on a reply", () => {
    const html = renderToStaticMarkup(
      <ForumThread role="verified" replies={[replyRow(["report"])]} draft="" onDraftChange={noop} onSubmit={noop} />,
    );
    expect(html).toContain('aria-label="Actions for Reply by Jordan Lee"');
  });

  it("empty reply capabilities render no trigger", () => {
    const html = renderToStaticMarkup(
      <ForumThread role="verified" replies={[replyRow([])]} draft="" onDraftChange={noop} onSubmit={noop} />,
    );
    expect(html).not.toContain("Actions for");
    expect(html).not.toContain('aria-haspopup="menu"');
  });
});

describe("ForumPage — seed posts carry admin-only menu items", () => {
  it("owner (global admin) sees the action menu on seed posts", () => {
    auth(account({ isOwner: true }), "verified");
    selectedCity();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ForumPage city={city} />
      </MemoryRouter>,
    );
    // Seed announcements render in the default tab; admins get Hide/Restore/Delete.
    expect(html).toContain('aria-label="Actions for Welcome to Run Local — Columbia is live!"');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("in-scope city admin sees the action menu on seed posts", () => {
    auth(account({ role: "city_admin", adminCityId: "columbia-mo" }), "verified");
    selectedCity();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ForumPage city={city} />
      </MemoryRouter>,
    );
    expect(html).toContain('aria-label="Actions for Welcome to Run Local — Columbia is live!"');
  });

  it("guest sees NO action menu on seed posts", () => {
    auth(null, "guest");
    selectedCity();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ForumPage city={city} />
      </MemoryRouter>,
    );
    expect(html).not.toContain("Actions for");
    expect(html).not.toContain('aria-haspopup="menu"');
  });
});
