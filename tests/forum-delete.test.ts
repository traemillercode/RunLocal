/**
 * "That's not here — it may have been removed", on a post plainly on screen.
 *
 * Reported as an annoying status update. It was three things.
 */
import { describe, expect, it } from "vitest";
import { readCode } from "./helpers/source";

const FORUM = readCode(new URL("../src/pages/ForumPage.tsx", import.meta.url));

describe("the delete actually deletes", () => {
  it("uses the author endpoint, not the moderation one", () => {
    /*
     * It called adminTransitionContent against `post:<id>` — a content-registry
     * row that only exists for posts the SERVER serves. Seed posts live in
     * client data and have no such row, so the call returned not_found.
     *
     * The message was not the bug; it was the shape the failure took. Deleting
     * your own post is not a moderation action and should not use the
     * moderation path.
     */
    expect(FORUM).toContain("api.deleteForumPost(action.postId)");
    expect(FORUM).not.toContain('adminTransitionContent(`post:${action.postId}`, "delete"');
  });

  it("asks for no reason", () => {
    /*
     * A reason is an AUDIT concept — it exists so a moderator acting on someone
     * else's content leaves a record of why. Demanding one to delete your own
     * post asks a person to justify themselves to nobody, and the screenshot
     * that prompted this had someone typing "Delete" into a 500-character box.
     */
    const at = FORUM.indexOf('case "delete_post":');
    expect(FORUM.slice(at, at + 900)).toContain("requireReason: false");
  });
});

/*
 * NOT ASSERTED YET: that COLUMBIA_FORUM is empty.
 *
 * Emptying it is right — nine posts invented by "Kimbio Team" render as real
 * content — but SEVEN TEST FILES use those seed posts as fixtures, so removing
 * them breaks content-flag, dashboard, moderation-menu, own-hide, pinning,
 * replies-api and seed.
 *
 * That coupling is the actual finding: production seed data is doing duty as
 * test fixtures, so the content cannot change without the suite changing with
 * it. Fixing it means each of those files building its own posts, which is a
 * deliberate pass rather than a line in this one.
 */

describe("the empty forum explains itself", () => {
  it("renders an empty state", () => {
    // An empty list with no explanation reads as broken rather than early, and
    // that is the difference between a bug report and an opinion.
    expect(FORUM).toContain("posts.length === 0 ?");
    expect(FORUM).toContain("Nothing here yet");
  });

  it("says what goes here rather than apologising", () => {
    expect(FORUM).toContain("Be the first.");
  });
});
