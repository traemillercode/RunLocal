/**
 * Public city forum — server-persisted user posts.
 *
 * Seed posts live in the client's city data (src/data/cities.ts) and are the
 * ONE source of truth for sample content; this module owns ONLY user-created
 * posts, which are stored in the Db (persisted to db.json) and rendered merged
 * with the seed posts in the Forum UI.
 *
 * Authorization contract (server-authoritative, never client-decided):
 *  - POST requires a signed-in VERIFIED account (rejected/pending/guest denied
 *    with explicit errors), no active suspension, and a known home city.
 *  - The post's city is the author's home city — a verified member posts into
 *    their own community. The client can never pick another city.
 *  - Public reads are city-scoped and exclude soft-deleted posts and posts
 *    hidden/archived in the moderation registry (`post:<id>` content rows), so
 *    the existing admin moderation paths apply unchanged.
 *  - The public payload carries only the author's public display name — never
 *    email, phone, or other account data.
 *
 * Replies/threading are NOT part of this slice: the seed model only carries a
 * numeric reply count, and there is no persisted reply tree yet. The UI keeps
 * the Reply affordance honestly gated ("replies are not open yet") until a
 * dedicated reply slice lands.
 */
import type { Db } from "./store";
import { newId } from "./store";
import type { AccountRecord } from "./types";
import type { ForumPostRecord } from "./types";
import { isSuspended } from "./store";
import { cityExists } from "./cms";
import type { ForumSection } from "../types";

export const FORUM_SECTIONS = ["announcements", "community", "qa"] as const;
const MAX_TITLE = 120;
const MAX_BODY = 2000;

export interface PublicForumPost {
  id: string;
  section: ForumSection;
  title: string;
  body: string;
  author: string;
  /** Extra author label (seed posts use e.g. "Columbia Track Club"); user posts have none. */
  authorNote: string | null;
  createdAt: string;
  replies: number;
  pinned: boolean;
}

/** Compact "Aug 4" style label for the post list (same year) or "Aug 4, 2025". */
export function forumDateLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return sameYear ? label : `${label}, ${d.getUTCFullYear()}`;
}

/**
 * Public forum posts for a city: user-created posts only (seed posts are
 * rendered from the client's city data). Visible + not moderation-hidden.
 */
export function publicForumPosts(db: Db, cityId: string): PublicForumPost[] {
  return db
    .listForumPosts(cityId)
    .filter((f) => f.state === "visible")
    .filter((f) => {
      const mod = db.getContent(`post:${f.id}`);
      return !mod?.hidden && !mod?.archived;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((f) => {
      const author = db.getAccount(f.authorAccountId);
      return {
        id: f.id,
        section: f.section,
        title: f.title,
        body: f.body,
        author: author?.name ?? "Runner",
        authorNote: null,
        createdAt: forumDateLabel(f.createdAt, db.now()),
        replies: 0,
        pinned: false,
      };
    });
}

export type ForumCreateResult =
  | { ok: true; data: { post: PublicForumPost; record: ForumPostRecord } }
  | { ok: false; status: number; error: string; message?: string };

/**
 * Create a user forum post. Server-authoritative: session identity comes from
 * the caller; only verified, non-suspended accounts with a known home city may
 * post, and the post always lands in the author's home city. The post is also
 * registered in the moderation registry (`post:<id>`) so the existing admin
 * hide/archive tooling applies to it like any other content.
 */
export function createForumPost(
  db: Db,
  accountId: string,
  input: { section?: unknown; title?: unknown; body?: unknown },
  now = new Date(),
): ForumCreateResult {
  const rec: AccountRecord | undefined = db.getAccount(accountId);
  if (!rec || rec.deletedAt) return { ok: false, status: 401, error: "sign_in_required" };
  if (rec.status !== "verified") {
    return {
      ok: false,
      status: 403,
      error: "verification_required",
      message: "Only verified runners can post — finish verification first.",
    };
  }
  if (isSuspended(rec, now)) {
    return { ok: false, status: 403, error: "suspended", message: "Your account is suspended and can't post right now." };
  }
  const cityId = rec.cityId ?? "";
  if (!cityId || !cityExists(db, cityId)) {
    return {
      ok: false,
      status: 400,
      error: "city_required",
      message: "Choose your home city before posting — Run Local is city-scoped.",
    };
  }
  const section = typeof input.section === "string" && (FORUM_SECTIONS as readonly string[]).includes(input.section) ? (input.section as ForumSection) : null;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!section) return { ok: false, status: 400, error: "invalid_section" };
  if (!title || title.length > MAX_TITLE) {
    return { ok: false, status: 400, error: "invalid_title", message: `Give your post a title (1-${MAX_TITLE} characters).` };
  }
  if (!body || body.length > MAX_BODY) {
    return { ok: false, status: 400, error: "invalid_body", message: `Write a post (1-${MAX_BODY} characters).` };
  }
  if (!db.consumeDiscussionRate(accountId, now.getTime())) {
    return { ok: false, status: 429, error: "rate_limited", message: "You've posted a lot recently — try again in a bit." };
  }
  const post: ForumPostRecord = {
    id: newId(),
    cityId,
    section,
    title: title.slice(0, MAX_TITLE),
    body: body.slice(0, MAX_BODY),
    authorAccountId: accountId,
    state: "visible",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  db.addForumPost(post);
  // Register in the moderation registry so existing admin hide/archive paths
  // (content registry rows) apply to user posts exactly like seed posts.
  db.upsertContent({
    id: `post:${post.id}`,
    cityId,
    kind: "post",
    refId: post.id,
    title: post.title,
    authorLabel: rec.name,
    authorAccountId: accountId,
    featured: false,
    pinned: false,
    hidden: false,
    hiddenAt: null,
    archived: false,
    archivedAt: null,
  });
  const author = db.getAccount(accountId);
  return {
    ok: true,
    data: {
      post: {
        id: post.id,
        section: post.section,
        title: post.title,
        body: post.body,
        author: author?.name ?? "Runner",
        authorNote: null,
        createdAt: forumDateLabel(post.createdAt, now),
        replies: 0,
        pinned: false,
      },
      record: post,
    },
  };
}
