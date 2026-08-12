/**
 * SSR tests for the tagging UI (part C2, owner requirement 4): the "Tag a
 * runner" action entry (actionModel + server capability for verified
 * authors), the composer sheet (search + submit -> createTag with the exact
 * payload the POST contract takes), chips rendered from getTags, and the
 * self-hide affordance (selfHideTag, optimistic + revert).
 *
 * Rendered with react-dom/server (no jsdom); wiring contracts are pinned on
 * source like the other UI tests.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { actionMenuItems, ACTION_META } from "../src/lib/actionModel";
import { forumPostCapabilities } from "../src/server/forum";
import { TagChips, TagRunnerSheetBody } from "../src/components/Tagging";
import { PostCard, type ForumPostRow } from "../src/pages/ForumPage";
import type { PeopleSearchResult, RunnerProfileView, TagView } from "../src/lib/api";

function profile(over: Partial<RunnerProfileView>): RunnerProfileView {
  return {
    id: "u1", name: "Taylor Jones", username: "taylorj", profilePhotoUrl: null, cityName: "Columbia, MO",
    isVerified: true, isTrustedMember: false, isLeader: false, ...over,
  };
}
function tag(over: Partial<TagView> = {}): TagView {
  return {
    id: "t1", contentType: "post", contentId: "p1", taggedUserId: "u1", taggedByUserId: "u9",
    hiddenByTaggedUser: false, createdAt: "2026-08-01T00:00:00Z", taggedUser: profile({ id: "u1", name: "Taylor Jones" }),
    ...over,
  };
}
const person = (over: Partial<PeopleSearchResult> = {}): PeopleSearchResult => ({
  ...profile({ id: "p1", name: "Ava Chen", username: "avac" }),
  connectionState: "none",
  ...over,
});

describe("actionModel + server capability — 'Tag a runner' entry", () => {
  it("maps the tag capability to 'Tag a runner' with the tag icon (not danger)", () => {
    expect(ACTION_META.tag.label).toBe("Tag a runner");
    expect(ACTION_META.tag.icon).toBe("tag");
    expect(ACTION_META.tag.danger).toBe(false);
    expect(actionMenuItems(["tag"]).map((m) => m.key)).toEqual(["tag"]);
    expect(actionMenuItems(["edit_own", "delete_own", "tag"]).map((m) => m.label)).toEqual(["Edit", "Delete", "Tag a runner"]);
  });
  it("server grants 'tag' to the verified author of their own post and to nobody else", () => {
    const author = { id: "author", deletedAt: null, status: "verified" } as never;
    const now = new Date("2026-08-01T00:00:00Z");
    const post = { authorAccountId: "author", cityId: "columbia-mo", pinned: false };
    const authorCaps = forumPostCapabilities(author, post, now);
    expect(authorCaps).toContain("tag");
    // A verified non-author gets Report only — never 'tag'.
    const other = { id: "other", deletedAt: null, status: "verified" } as never;
    expect(forumPostCapabilities(other, post, now)).not.toContain("tag");
    // Pending author gets nothing.
    const pending = { id: "author", deletedAt: null, status: "pending" } as never;
    expect(forumPostCapabilities(pending, post, now)).not.toContain("tag");
  });
});

describe("TagRunnerSheetBody — composer", () => {
  const bodyProps = {
    query: "ava",
    onQueryChange: () => {},
    results: [person()],
    loading: false,
    selectedId: "p1",
    onSelect: () => {},
    submitting: false,
    error: null,
    onSubmit: () => {},
  };
  it("renders the search field, pickable results, and a submit button gated on selection", () => {
    const html = renderToStaticMarkup(<TagRunnerSheetBody {...bodyProps} />);
    expect(html).toContain("Find a runner to tag");
    expect(html).toContain('role="listbox"');
    expect(html).toContain("Ava Chen");
    expect(html).toContain("@avac");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Tag runner");
  });
  it("shows an honest no-results message and a disabled submit before any selection", () => {
    const none = renderToStaticMarkup(<TagRunnerSheetBody {...bodyProps} query="zzz" results={[]} selectedId={null} />);
    expect(none).toContain("No runners found");
    expect(none).toContain("disabled");
    const error = renderToStaticMarkup(<TagRunnerSheetBody {...bodyProps} error="That didn't work." />);
    expect(error).toContain("That didn&#x27;t work.");
  });
  it("locks the create payload contract: searchPeople + createTag with contentType/contentId/taggedUserId", async () => {
    const source = await readFileSync(resolve(process.cwd(), "src/components/Tagging.tsx"), "utf8");
    expect(source).toContain("api.searchPeople(trimmed)");
    expect(source).toContain("api.createTag({ contentType, contentId, taggedUserId: selected.id })");
  });
  it("ForumPage opens the composer from the ActionMenu 'tag' branch and refetches chips on success", async () => {
    const source = await readFileSync(resolve(process.cwd(), "src/pages/ForumPage.tsx"), "utf8");
    expect(source).toContain('case "tag":');
    expect(source).toContain("setTagPost(post)");
    expect(source).toContain('<TagRunnerSheet');
    expect(source).toContain('contentType="post"');
    expect(source).toContain("setTagsReload((n) => n + 1)");
    expect(source).toContain('<PostTags postId={p.id}');
  });
});

describe("TagChips — display + self-hide", () => {
  const chipsProps = {
    tags: [tag(), tag({ id: "t2", taggedUserId: "u2", taggedUser: profile({ id: "u2", name: "Morgan Lee" }) })],
    viewerId: null,
    busyTagId: null,
    onToggleHide: () => {},
  };
  it("renders chips from getTags data with links to each runner's profile", () => {
    const html = renderToStaticMarkup(<MemoryRouter><TagChips {...chipsProps} /></MemoryRouter>);
    expect(html).toContain("Taylor Jones");
    expect(html).toContain("Morgan Lee");
    expect(html).toContain('href="/runners/u1"');
    expect(html).toContain('href="/runners/u2"');
    expect(html).toContain("bg-sky-100"); // Chip tone="sky"
  });
  it("renders NOTHING for an empty tag list", () => {
    const html = renderToStaticMarkup(<MemoryRouter><TagChips {...chipsProps} tags={[]} /></MemoryRouter>);
    expect(html).toBe("");
  });
  it("shows the hide affordance only on the viewer's OWN chip", () => {
    const own = renderToStaticMarkup(
      <MemoryRouter><TagChips {...chipsProps} viewerId="u1" /></MemoryRouter>,
    );
    // One own chip (u1) → one affordance; the other chip has none.
    expect(own).toContain("Hide me");
    expect(own.match(/Hide me/g)?.length ?? 0).toBe(1);
    const other = renderToStaticMarkup(
      <MemoryRouter><TagChips {...chipsProps} viewerId="u9" /></MemoryRouter>,
    );
    expect(other).not.toContain("Hide me");
  });
  it("flips the affordance label for a hidden chip and locks the selfHideTag wiring (optimistic + revert)", async () => {
    const hidden = renderToStaticMarkup(
      <MemoryRouter><TagChips {...chipsProps} viewerId="u1" tags={[tag({ hiddenByTaggedUser: true })]} /></MemoryRouter>,
    );
    expect(hidden).toContain("Show me");
    const source = await readFileSync(resolve(process.cwd(), "src/components/Tagging.tsx"), "utf8");
    expect(source).toContain("api.selfHideTag(tag.id, hidden)");
    expect(source).toContain("hiddenByTaggedUser: hidden"); // optimistic flip
    expect(source).toContain("if (!r.ok) setTags(prev)"); // revert on error
  });
  it("PostCard renders the tags slot under the post body (chips from getTags)", () => {
    const post: ForumPostRow = {
      id: "p1", section: "community", title: "Long run", body: "Body copy", author: "Taylor Jones",
      authorId: "u1", createdAt: "Aug 1", replies: 0, capabilities: ["tag"],
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PostCard post={post} section="community" onReply={noop} verified tags={<span data-testid="tag-slot">chips here</span>} />
      </MemoryRouter>,
    );
    expect(html).toContain("chips here");
    // tags slot sits after the body paragraph inside the card body.
    const body = html.indexOf("Body copy");
    const slot = html.indexOf("chips here");
    expect(body).toBeGreaterThan(-1);
    expect(slot).toBeGreaterThan(body);
  });
});

const noop = () => {};
