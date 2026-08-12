/**
 * SSR tests for forum pinning UI + the invisible-menu fix (react-dom/server,
 * no jsdom — see runlocal-ui-tests-no-jsdom).
 *
 * Pin/unpin menu content is pinned through actionMenuItems(): an admin sees
 * "Pin" on an unpinned post and "Unpin" on a pinned post; non-admins never
 * see either. PostCard renders the Pinned chip from the server's `pinned`
 * flag, and the card no longer carries `overflow-hidden`, which is what was
 * clipping the absolutely-positioned ActionMenu dropdown out of view.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PostCard, type ForumPostRow } from "../src/pages/ForumPage";
import { actionMenuItems } from "../src/lib/actionModel";

function postRow(capabilities: string[], pinned = false): ForumPostRow {
  return {
    id: "p1",
    section: "community",
    title: "New group route",
    body: "We added a 5K loop along the river.",
    author: "Taylor Runner",
    createdAt: "Aug 1",
    replies: 2,
    pinned,
    capabilities,
  };
}
const noop = () => {};

describe("forum pin/unpin — action menu model", () => {
  it("admin sees Pin on an unpinned post and Unpin on a pinned post", () => {
    expect(actionMenuItems(["hide", "restore", "delete", "pin"]).map((i) => i.label)).toEqual(["Hide", "Restore", "Delete", "Pin"]);
    expect(actionMenuItems(["hide", "restore", "delete", "unpin"]).map((i) => i.label)).toEqual(["Hide", "Restore", "Delete", "Unpin"]);
  });
  it("non-admin capability lists never include pin/unpin", () => {
    const author = actionMenuItems(["edit_own", "delete_own"]);
    expect(author.some((i) => i.key === "pin" || i.key === "unpin")).toBe(false);
    const reporter = actionMenuItems(["report"]);
    expect(reporter.some((i) => i.key === "pin" || i.key === "unpin")).toBe(false);
    expect(actionMenuItems([])).toEqual([]);
  });
});

describe("PostCard — pinned chip and menu visibility", () => {
  it("renders the Pinned chip for a pinned post and no chip when unpinned", () => {
    const pinnedHtml = renderToStaticMarkup(
      <PostCard post={postRow(["hide", "restore", "delete", "unpin"], true)} section="community" onReply={noop} verified onAction={noop} />,
    );
    expect(pinnedHtml).toContain("Pinned");
    const plainHtml = renderToStaticMarkup(
      <PostCard post={postRow(["hide", "restore", "delete", "pin"])} section="community" onReply={noop} verified onAction={noop} />,
    );
    expect(plainHtml).not.toContain("Pinned");
  });
  it("admin view of an unpinned post renders the action trigger (Pin available)", () => {
    const html = renderToStaticMarkup(
      <PostCard post={postRow(["hide", "restore", "delete", "pin"])} section="community" onReply={noop} verified onAction={noop} />,
    );
    expect(html).toContain('aria-label="Actions for New group route"');
    expect(html).toContain('aria-haspopup="menu"');
  });
  it("admin view of a pinned post renders the action trigger (Unpin available)", () => {
    const html = renderToStaticMarkup(
      <PostCard post={postRow(["hide", "restore", "delete", "unpin"], true)} section="community" onReply={noop} verified onAction={noop} />,
    );
    expect(html).toContain('aria-label="Actions for New group route"');
  });
  it("PostCard article carries no overflow-hidden, so the ActionMenu dropdown is never clipped", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PostCard post={postRow(["hide", "restore", "delete", "pin"])} section="community" onReply={noop} verified onAction={noop} />
      </MemoryRouter>,
    );
    expect(html).not.toContain("overflow-hidden");
    expect(html).toContain("desktop-forum-card");
  });
});
