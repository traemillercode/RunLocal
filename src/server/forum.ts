/**
 * Public city forum — server-persisted user posts and replies.
 *
 * Seed posts live in the client's city data (src/data/cities.ts) and are the
 * ONE source of truth for sample content; this module owns ONLY user-created
 * posts and replies, which are stored in the Db (persisted to db.json) and
 * rendered merged with the seed posts in the Forum UI.
 *
 * Authorization contract (server-authoritative, never client-decided):
 *  - POST (posts AND replies) requires a signed-in VERIFIED account
 *    (rejected/pending/guest denied with explicit errors), no active
 *    suspension, and a known home city.
 *  - The post's city is the author's home city — a verified member posts into
 *    their own community. The client can never pick another city, and replies
 *    may only target posts in the author's home city (cross-city access is
 *    denied, never silently redirected).
 *  - Public reads are city-scoped and exclude soft-deleted posts/replies and
 *    posts hidden/archived in the moderation registry (`post:<id>` content
 *    rows), so the existing admin moderation paths apply unchanged. A hidden
 *    or archived post hides its replies too — both from reads and from new
 *    replies.
 *  - The public payload carries only the author's public display name — never
 *    email, phone, or other account data.
 *
 * Replies attach to a post id that may name either a user-created post
 * (`ForumPostRecord`) or a seed post from the client's city data; the post id
 * is the single key, and the sample reply counts on seed posts stay in the
 * seed while persisted replies add to them (GET /api/forum returns the
 * persisted counts per post via `replyCounts`).
 */
import type { Db } from "./store";
import { newId } from "./store";
import type { AccountRecord } from "./types";
import type { ForumPostRecord, ForumReplyRecord } from "./types";
import { isSuspended } from "./store";
import { isCityAdminForCity, isGlobalAdmin } from "./roles";
import type { AdminCtx } from "./admin";
import { authorizeScoped } from "./admin";
import { cityExists } from "./cms";
import type { ForumSection } from "../types";
import { CITIES } from "../data/cities";

export const FORUM_SECTIONS = ["announcements", "community", "qa"] as const;
const MAX_TITLE = 120;
const MAX_BODY = 2000;
const MAX_REPLY = 1000;

/**
 * Server-computed moderation capabilities for ONE entity, consumed verbatim by
 * the client's action menu (src/lib/actionModel.ts — unknown keys are ignored,
 * an empty list renders no trigger). The server is the only authority: the
 * client never derives author/admin rights from emails or roles, it renders
 * exactly these lists, and every listed action maps to an endpoint that
 * re-validates the same rules server-side.
 */
export type ForumCapability = "edit" | "edit_own" | "delete_own" | "hide" | "restore" | "delete" | "report" | "tag" | "pin" | "unpin";

/** Verified + not deleted + not suspended — the gate for author and report actions. */
function verifiedActive(actor: AccountRecord | null | undefined, now: Date): boolean {
  return Boolean(actor && !actor.deletedAt && actor.status === "verified" && !isSuspended(actor, now));
}

/**
 * Capability list for a forum POST as seen by `actor`:
 *  - the author (verified, active) may Edit / Delete their own post;
 *  - Global Admins, and City Admins scoped to the post's city, may
 *    Hide / Restore / Delete via the existing contentAdmin routes
 *    (`/api/admin/content/post:<id>/…`), and may Pin / Unpin the post
 *    (PATCH /api/forum/:id/pin — the "pin" capability shows while unpinned,
 *    "unpin" while pinned);
 *  - any other verified, active runner may Report it
 *    (POST /api/content/post/:id/flag — self-report is blocked server-side).
 * Guests, pending/rejected accounts, and deleted/suspended accounts get [].
 */
export function forumPostCapabilities(actor: AccountRecord | null | undefined, post: { authorAccountId: string; cityId: string; pinned?: boolean }, now = new Date()): ForumCapability[] {
  if (!actor || actor.deletedAt) return [];
  const caps: ForumCapability[] = [];
  const isAuthor = post.authorAccountId === actor.id;
  // Verified authors may tag runners on their own posts (lightweight, no
  // approval — the tagged runner can self-hide; PATCH /api/tags/:id/self).
  if (isAuthor && verifiedActive(actor, now)) caps.push("edit_own", "delete_own", "tag");
  if (isGlobalAdmin(actor) || isCityAdminForCity(actor, post.cityId)) {
    // Admins can edit ANY post in their scope (published content is never
    // submitter-editable once approved — the admin is the edit authority).
    caps.push("edit", "hide", "restore", "delete");
    caps.push(post.pinned === true ? "unpin" : "pin");
  }
  if (!isAuthor && verifiedActive(actor, now)) caps.push("report");
  return caps;
}

/**
 * Capability list for a forum REPLY as seen by `actor`:
 *  - the author (verified, active) may Edit / Delete their own reply;
 *  - any other verified, active runner (admins included) may Report it —
 *    replies have no content-registry row, so the existing contentAdmin
 *    hide/restore/delete routes cannot act on them; the flag is the escalation
 *    path (resolved from the admin dashboard, which can hide via the flag).
 */
export function forumReplyCapabilities(actor: AccountRecord | null | undefined, reply: { authorAccountId: string }, now = new Date()): ForumCapability[] {
  if (!actor || actor.deletedAt) return [];
  const caps: ForumCapability[] = [];
  const isAuthor = reply.authorAccountId === actor.id;
  if (isAuthor && verifiedActive(actor, now)) caps.push("edit_own", "delete_own");
  if (!isAuthor && verifiedActive(actor, now)) caps.push("report");
  return caps;
}

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
  /** Author account id — null for seed posts (never an "own" target). */
  authorId: string | null;
  /** Server-computed action capabilities for the requesting account. */
  capabilities: ForumCapability[];
}

export interface PublicForumReply {
  id: string;
  postId: string;
  body: string;
  author: string;
  createdAt: string;
  /** Author account id — always set for persisted replies. */
  authorId: string;
  /** Server-computed action capabilities for the requesting account. */
  capabilities: ForumCapability[];
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
 * `replies` is the persisted visible reply count for the post (seed posts'
 * sample counts stay in the seed; GET /api/forum also returns `replyCounts`
 * so the client can add persisted replies to seed counts).
 */
export function publicForumPosts(db: Db, cityId: string, actor?: AccountRecord | null, now = db.now()): PublicForumPost[] {
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
        createdAt: forumDateLabel(f.createdAt, now),
        replies: visibleReplyCount(db, f.id),
        pinned: f.pinned === true,
        authorId: f.authorAccountId,
        capabilities: forumPostCapabilities(actor, f, now),
      };
    });
}

/**
 * Count of persisted, visible replies for a post (seed or user-created).
 * Replies to moderation-hidden/archived posts never count — the post is not
 * publicly rendered either, so the count can never leak hidden content.
 */
export function visibleReplyCount(db: Db, postId: string): number {
  if (postModerated(db, postId)) return 0;
  return db.listForumReplies(postId).filter((r) => r.state === "visible").length;
}

/**
 * Persisted visible reply counts per post id for a whole city, including seed
 * posts. Used by GET /api/forum so the client can show sample-count + real
 * replies on seed posts and the real count on user posts.
 */
export function forumReplyCounts(db: Db, cityId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const post of allCityPostIds(db, cityId)) counts[post] = visibleReplyCount(db, post);
  return counts;
}

interface ResolvedPost {
  id: string;
  cityId: string;
  section: ForumSection;
  title: string;
  authorLabel: string;
}

/** Post ids that exist in a city: user-created records + seed posts. */
function allCityPostIds(db: Db, cityId: string): string[] {
  const ids = new Set(db.listForumPosts(cityId).map((f) => f.id));
  const city = CITIES.find((c) => c.id === cityId);
  for (const p of city?.forum ?? []) ids.add(p.id);
  return [...ids];
}

/** Resolve a post in a specific city (user record or seed post). */
function resolvePostInCity(db: Db, cityId: string, postId: string): ResolvedPost | null {
  const user = db.getForumPost(postId);
  if (user && user.state === "visible" && user.cityId === cityId) {
    return {
      id: user.id,
      cityId,
      section: user.section,
      title: user.title,
      authorLabel: db.getAccount(user.authorAccountId)?.name ?? "Runner",
    };
  }
  const city = CITIES.find((c) => c.id === cityId);
  const seed = city?.forum.find((p) => p.id === postId);
  if (seed) {
    return { id: seed.id, cityId, section: seed.section, title: seed.title, authorLabel: seed.author };
  }
  return null;
}

/** Resolve a post anywhere (all cities) — used only for cross-city denial. */
function resolvePostAnywhere(db: Db, postId: string): ResolvedPost | null {
  for (const c of CITIES) {
    const found = resolvePostInCity(db, c.id, postId);
    if (found) return found;
  }
  const user = db.getForumPost(postId);
  if (user && user.state === "visible") {
    return {
      id: user.id,
      cityId: user.cityId,
      section: user.section,
      title: user.title,
      authorLabel: db.getAccount(user.authorAccountId)?.name ?? "Runner",
    };
  }
  return null;
}

function postModerated(db: Db, postId: string): boolean {
  const mod = db.getContent(`post:${postId}`);
  return Boolean(mod?.hidden || mod?.archived);
}

/**
 * Public, moderation-aware post handle for reads: the post must exist in the
 * given city and must not be hidden/archived. Returns null for unknown posts,
 * posts in another city, and moderated posts (404 — never leak hidden posts).
 */
export function forumPostPublic(db: Db, cityId: string, postId: string): ResolvedPost | null {
  const post = resolvePostInCity(db, cityId, postId);
  if (!post || postModerated(db, postId)) return null;
  return post;
}

/**
 * Public replies for a post: visible replies only, oldest first (conversation
 * order). Replies inherit the parent post's moderation visibility — a hidden
 * or archived post returns no replies (the caller 404s on the post first).
 */
export function publicForumReplies(db: Db, postId: string, now = new Date(), actor?: AccountRecord | null): PublicForumReply[] {
  if (postModerated(db, postId)) return [];
  return db
    .listForumReplies(postId)
    .filter((r) => r.state === "visible")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((r) => {
      const author = db.getAccount(r.authorAccountId);
      return {
        id: r.id,
        postId: r.postId,
        body: r.body,
        author: author?.name ?? "Runner",
        createdAt: forumDateLabel(r.createdAt, now),
        authorId: r.authorAccountId,
        capabilities: forumReplyCapabilities(actor, r, now),
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
    pinned: false,
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
        authorId: post.authorAccountId,
        capabilities: forumPostCapabilities(rec, post, now),
      },
      record: post,
    },
  };
}

export type ForumReplyCreateResult =
  | { ok: true; data: { reply: PublicForumReply; record: ForumReplyRecord } }
  | { ok: false; status: number; error: string; message?: string };

/**
 * Create a user reply to a forum post. Same verified-only authorization as
 * posting, plus:
 *  - the target post must exist and be visible (user post or seed post);
 *  - the post must live in the author's home city — replies to posts in other
 *    cities are denied with an explicit cross-city error, never redirected;
 *  - a moderation-hidden or archived post is unavailable for new replies;
 *  - the body is validated (1..MAX_REPLY) and replies share the posting
 *    rate limit. The reply is persisted and the parent post's public reply
 *    count reflects it immediately.
 */
export function createForumReply(
  db: Db,
  accountId: string,
  input: { postId?: unknown; body?: unknown },
  now = new Date(),
): ForumReplyCreateResult {
  const rec: AccountRecord | undefined = db.getAccount(accountId);
  if (!rec || rec.deletedAt) return { ok: false, status: 401, error: "sign_in_required" };
  if (rec.status !== "verified") {
    return {
      ok: false,
      status: 403,
      error: "verification_required",
      message: "Only verified runners can reply — finish verification first.",
    };
  }
  if (isSuspended(rec, now)) {
    return { ok: false, status: 403, error: "suspended", message: "Your account is suspended and can't reply right now." };
  }
  const cityId = rec.cityId ?? "";
  if (!cityId || !cityExists(db, cityId)) {
    return {
      ok: false,
      status: 400,
      error: "city_required",
      message: "Choose your home city before replying — Run Local is city-scoped.",
    };
  }
  const postId = typeof input.postId === "string" ? input.postId.trim() : "";
  if (!postId) return { ok: false, status: 400, error: "invalid_post" };
  const target = resolvePostAnywhere(db, postId);
  if (!target) {
    return { ok: false, status: 404, error: "post_not_found", message: "That post isn't available." };
  }
  if (target.cityId !== cityId) {
    return {
      ok: false,
      status: 403,
      error: "cross_city_denied",
      message: "Replies stay within your home city's forum — switch cities to reply there.",
    };
  }
  if (postModerated(db, postId)) {
    return { ok: false, status: 403, error: "post_unavailable", message: "This post is no longer available for replies." };
  }
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body || body.length > MAX_REPLY) {
    return { ok: false, status: 400, error: "invalid_body", message: `Write a reply (1-${MAX_REPLY} characters).` };
  }
  if (!db.consumeDiscussionRate(accountId, now.getTime())) {
    return { ok: false, status: 429, error: "rate_limited", message: "You've replied a lot recently — try again in a bit." };
  }
  const reply: ForumReplyRecord = {
    id: newId(),
    postId,
    cityId,
    authorAccountId: accountId,
    body: body.slice(0, MAX_REPLY),
    state: "visible",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  db.addForumReply(reply);
  const author = db.getAccount(accountId);
  return {
    ok: true,
    data: {
      reply: {
        id: reply.id,
        postId: reply.postId,
        body: reply.body,
        author: author?.name ?? "Runner",
        createdAt: forumDateLabel(reply.createdAt, now),
        authorId: reply.authorAccountId,
        capabilities: forumReplyCapabilities(rec, reply, now),
      },
      record: reply,
    },
  };
}

// ------------------------------------------------------- author edit/delete
// Author-owned moderation: the person who wrote a post/reply may correct or
// retract it. The same verified-runner identity gate applies, plus:
//  - ONLY the author may touch the record (non-authors get 404 — the record is
//    never leaked), and the target must live in the author's home city;
//  - a moderation-hidden/archived post is unavailable for author edits too
//    (mirrors the reply gate's `post_unavailable` semantics);
//  - edits re-validate exactly like creation (title 1-120, body 1-2000 for
//    posts, 1-1000 for replies) and stamp updatedAt;
//  - delete is a SOFT delete: state "deleted", body/title blanked, row
//    preserved for the trail, and the moderation registry row is marked
//    archived so hidden replies and reply counts stop rendering.
// Every mutation is audited (forum.post_edit / forum.post_delete /
// forum.reply_edit / forum.reply_delete) with the author identity, city, and a
// change summary.

export type ForumAuthorEditResult =
  | { ok: true; data: { post: PublicForumPost; record: ForumPostRecord } }
  | { ok: false; status: number; error: string; message?: string };

/** Identity + ownership gate shared by the author edit/delete handlers. */
function authorizeForumAuthor(db: Db, accountId: string, now = new Date()): { ok: true; rec: AccountRecord } | { ok: false; status: number; error: string; message?: string } {
  const rec: AccountRecord | undefined = db.getAccount(accountId);
  if (!rec || rec.deletedAt) return { ok: false, status: 401, error: "sign_in_required" };
  if (rec.status !== "verified") {
    return {
      ok: false,
      status: 403,
      error: "verification_required",
      message: "Only verified runners can edit forum content — finish verification first.",
    };
  }
  if (isSuspended(rec, now)) {
    return { ok: false, status: 403, error: "suspended", message: "Your account is suspended and can't edit right now." };
  }
  const cityId = rec.cityId ?? "";
  if (!cityId || !cityExists(db, cityId)) {
    return {
      ok: false,
      status: 400,
      error: "city_required",
      message: "Choose your home city before editing — Run Local is city-scoped.",
    };
  }
  return { ok: true, rec };
}

/**
 * Author edit of a user-created forum post. Author-only (404 for non-authors —
 * the post is never leaked), same-city required, and a moderation-hidden or
 * archived post is unavailable for editing (`post_unavailable`, mirroring the
 * reply gate). Title (1-120) and body (1-2000) are re-validated; the registry
 * title follows the corrected title so admin surfaces stay in sync. Audited.
 */
export function editForumPost(
  db: Db,
  accountId: string,
  postId: string,
  input: { title?: unknown; body?: unknown },
  now = new Date(),
): ForumAuthorEditResult {
  const auth = authorizeForumAuthor(db, accountId, now);
  if (!auth.ok) return auth;
  const post = db.getForumPost(postId);
  if (!post || post.state !== "visible") return { ok: false, status: 404, error: "post_not_found", message: "That post isn't available." };
  if (post.authorAccountId !== auth.rec.id) return { ok: false, status: 404, error: "post_not_found", message: "That post isn't available." };
  if (post.cityId !== auth.rec.cityId) {
    return { ok: false, status: 403, error: "cross_city_denied", message: "Edits stay within your home city's forum — switch cities to edit there." };
  }
  if (postModerated(db, postId)) {
    return { ok: false, status: 403, error: "post_unavailable", message: "This post is no longer available for edits." };
  }
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!title || title.length > MAX_TITLE) {
    return { ok: false, status: 400, error: "invalid_title", message: `Give your post a title (1-${MAX_TITLE} characters).` };
  }
  if (!body || body.length > MAX_BODY) {
    return { ok: false, status: 400, error: "invalid_body", message: `Write a post (1-${MAX_BODY} characters).` };
  }
  const updated = db.updateForumPost(postId, { title: title.slice(0, MAX_TITLE), body: body.slice(0, MAX_BODY) })!;
  // Keep the moderation registry title in sync with the author's correction.
  const content = db.getContent(`post:${postId}`);
  if (content) db.upsertContent({ ...content, title: updated.title });
  const change = title !== post.title ? `title: "${post.title.slice(0, 60)}" -> "${updated.title.slice(0, 60)}"` : `body edited (${body.length} chars)`;
  db.appendAudit({ admin: auth.rec.email, action: "forum.post_edit", reason: "Author edited their forum post", targetId: postId, ip: "author-action", cityId: post.cityId, owner: auth.rec.email, change }, now);
  return {
    ok: true,
    data: {
      post: {
        id: updated.id,
        section: updated.section,
        title: updated.title,
        body: updated.body,
        author: auth.rec.name,
        authorNote: null,
        createdAt: forumDateLabel(updated.createdAt, now),
        replies: visibleReplyCount(db, updated.id),
        pinned: updated.pinned === true,
        authorId: updated.authorAccountId,
        capabilities: forumPostCapabilities(auth.rec, updated, now),
      },
      record: updated,
    },
  };
}

/**
 * Author soft-delete of a user-created forum post. Same author-only gate as
 * edit. The post row flips to state "deleted" with body/title blanked and its
 * moderation registry row is marked archived, so replies and reply counts stop
 * rendering everywhere. Audited.
 */
export function deleteForumPost(
  db: Db,
  accountId: string,
  postId: string,
  now = new Date(),
): ForumAuthorEditResult {
  const auth = authorizeForumAuthor(db, accountId, now);
  if (!auth.ok) return auth;
  const post = db.getForumPost(postId);
  if (!post || post.state !== "visible") return { ok: false, status: 404, error: "post_not_found", message: "That post isn't available." };
  if (post.authorAccountId !== auth.rec.id) return { ok: false, status: 404, error: "post_not_found", message: "That post isn't available." };
  if (post.cityId !== auth.rec.cityId) {
    return { ok: false, status: 403, error: "cross_city_denied", message: "Removals stay within your home city's forum — switch cities to remove there." };
  }
  if (postModerated(db, postId)) {
    return { ok: false, status: 403, error: "post_unavailable", message: "This post is no longer available for removal." };
  }
  const updated = db.updateForumPost(postId, { state: "deleted", body: "", title: "" })!;
  // Archive the registry row so hidden replies + counts stop rendering.
  const content = db.getContent(`post:${postId}`);
  if (content) db.upsertContent({ ...content, archived: true, archivedAt: now.toISOString() });
  db.appendAudit({ admin: auth.rec.email, action: "forum.post_delete", reason: "Author removed their forum post", targetId: postId, ip: "author-action", cityId: post.cityId, owner: auth.rec.email, change: `soft-deleted by author: "${post.title.slice(0, 60)}"` }, now);
  return {
    ok: true,
    data: {
      post: {
        id: updated.id,
        section: updated.section,
        title: updated.title,
        body: updated.body,
        author: auth.rec.name,
        authorNote: null,
        createdAt: forumDateLabel(updated.createdAt, now),
        replies: 0,
        pinned: updated.pinned === true,
        authorId: updated.authorAccountId,
        capabilities: forumPostCapabilities(auth.rec, updated, now),
      },
      record: updated,
    },
  };
}

export type ForumPinResult =
  | { ok: true; data: { post: PublicForumPost; record: ForumPostRecord } }
  | { ok: false; status: number; error: string; message?: string };

/**
 * Admin pin/unpin of a user-created forum post (PATCH /api/forum/:id/pin).
 *
 * Authorization mirrors the capability computation: Global Admins and City
 * Admins scoped to the post's city may pin; everyone else is denied (401 for
 * guests, 403 for signed-in non-admins). Only user-created post records can
 * be pinned — seed posts live in the client city data and resolve to 404 here.
 * The change is persisted on the record (survives restarts via db.json) and
 * mirrored onto the post's content-registry row so admin surfaces stay in
 * sync. Every mutation is audited (forum.pin / forum.unpin) with the acting
 * admin's identity, city, and a change summary. Pin state never affects
 * moderation visibility — a pinned post can still be hidden/archived.
 */
export function setForumPostPinned(
  db: Db,
  accountId: string,
  postId: string,
  pinned: boolean,
  now = new Date(),
): ForumPinResult {
  const rec: AccountRecord | undefined = db.getAccount(accountId);
  if (!rec || rec.deletedAt) return { ok: false, status: 401, error: "sign_in_required" };
  const post = db.getForumPost(postId);
  if (!post || post.state !== "visible") {
    return { ok: false, status: 404, error: "post_not_found", message: "That post isn't available." };
  }
  if (!isGlobalAdmin(rec) && !isCityAdminForCity(rec, post.cityId)) {
    return {
      ok: false,
      status: 403,
      error: "admin_required",
      message: "Only a Global Admin or the post's City Admin can pin forum posts.",
    };
  }
  if (post.pinned === pinned) {
    return {
      ok: false,
      status: 400,
      error: "already_in_state",
      message: pinned ? "This post is already pinned." : "This post isn't pinned.",
    };
  }
  const updated = db.updateForumPost(postId, { pinned })!;
  // Mirror the pin state onto the content-registry row so admin surfaces
  // (overview/CMS) reflect the forum's pin state.
  const content = db.getContent(`post:${postId}`);
  if (content) db.upsertContent({ ...content, pinned });
  db.appendAudit(
    {
      admin: rec.email,
      action: pinned ? "forum.pin" : "forum.unpin",
      reason: pinned ? "Pinned forum post" : "Unpinned forum post",
      targetId: postId,
      ip: "admin-action",
      cityId: post.cityId,
      owner: rec.email,
      change: pinned ? `pinned: "${post.title.slice(0, 60)}"` : `unpinned: "${post.title.slice(0, 60)}"`,
    },
    now,
  );
  return {
    ok: true,
    data: {
      post: {
        id: updated.id,
        section: updated.section,
        title: updated.title,
        body: updated.body,
        author: rec.name,
        authorNote: null,
        createdAt: forumDateLabel(updated.createdAt, now),
        replies: visibleReplyCount(db, updated.id),
        pinned: updated.pinned === true,
        authorId: updated.authorAccountId,
        capabilities: forumPostCapabilities(rec, updated, now),
      },
      record: updated,
    },
  };
}

export type ForumReplyAuthorEditResult =
  | { ok: true; data: { reply: PublicForumReply; record: ForumReplyRecord } }
  | { ok: false; status: number; error: string; message?: string };

/** Author-only gate shared by the reply edit/delete handlers. */
function authorizeForumReplyAuthor(db: Db, accountId: string, replyId: string, now = new Date()): { ok: true; rec: AccountRecord; reply: ForumReplyRecord } | { ok: false; status: number; error: string; message?: string } {
  const auth = authorizeForumAuthor(db, accountId, now);
  if (!auth.ok) return auth;
  const reply = db.getForumReply(replyId);
  if (!reply || reply.state !== "visible") return { ok: false, status: 404, error: "reply_not_found", message: "That reply isn't available." };
  if (reply.authorAccountId !== auth.rec.id) return { ok: false, status: 404, error: "reply_not_found", message: "That reply isn't available." };
  if (reply.cityId !== auth.rec.cityId) {
    return { ok: false, status: 403, error: "cross_city_denied", message: "Reply edits stay within your home city's forum." };
  }
  return { ok: true, rec: auth.rec, reply };
}

/**
 * Author edit of a forum reply. Author-only (404 for non-authors), same-city,
 * body re-validated (1-1000). Audited.
 */
export function editForumReply(
  db: Db,
  accountId: string,
  replyId: string,
  input: { body?: unknown },
  now = new Date(),
): ForumReplyAuthorEditResult {
  const auth = authorizeForumReplyAuthor(db, accountId, replyId, now);
  if (!auth.ok) return auth;
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body || body.length > MAX_REPLY) {
    return { ok: false, status: 400, error: "invalid_body", message: `Write a reply (1-${MAX_REPLY} characters).` };
  }
  const updated = db.updateForumReply(replyId, { body: body.slice(0, MAX_REPLY) })!;
  db.appendAudit({ admin: auth.rec.email, action: "forum.reply_edit", reason: "Author edited their forum reply", targetId: replyId, ip: "author-action", cityId: auth.reply.cityId, owner: auth.rec.email, change: `reply body edited (${body.length} chars)` }, now);
  return {
    ok: true,
    data: {
      reply: {
        id: updated.id,
        postId: updated.postId,
        body: updated.body,
        author: auth.rec.name,
        createdAt: forumDateLabel(updated.createdAt, now),
        authorId: updated.authorAccountId,
        capabilities: forumReplyCapabilities(auth.rec, updated, now),
      },
      record: updated,
    },
  };
}

/**
 * Author soft-delete of a forum reply (state "deleted", body blanked, row
 * preserved). Audited.
 */
export function deleteForumReply(
  db: Db,
  accountId: string,
  replyId: string,
  now = new Date(),
): ForumReplyAuthorEditResult {
  const auth = authorizeForumReplyAuthor(db, accountId, replyId, now);
  if (!auth.ok) return auth;
  const updated = db.updateForumReply(replyId, { state: "deleted", body: "" })!;
  db.appendAudit({ admin: auth.rec.email, action: "forum.reply_delete", reason: "Author removed their forum reply", targetId: replyId, ip: "author-action", cityId: auth.reply.cityId, owner: auth.rec.email, change: "reply soft-deleted by author" }, now);
  return {
    ok: true,
    data: {
      reply: {
        id: updated.id,
        postId: updated.postId,
        body: updated.body,
        author: auth.rec.name,
        createdAt: forumDateLabel(updated.createdAt, now),
        authorId: updated.authorAccountId,
        capabilities: forumReplyCapabilities(auth.rec, updated, now),
      },
      record: updated,
    },
  };
}

// ------------------------------------------------------------------ admin edit

/**
 * PATCH /api/admin/forum/post/:id — admin edit of ANY user forum post in the
 * admin's scope (Global Admin anywhere; City Admin exactly for the post's
 * city). This is the "admins can edit published content" path: author edits
 * go through `editForumPost`; this route exists so a scoped admin can correct
 * any post. Title (1-120) and body (1-2000) re-validated; the registry title
 * stays in sync. Audited as `admin.forum_post_edit` with the operator reason.
 */
export function editForumPostAdmin(
  db: Db,
  ctx: AdminCtx,
  postId: string,
  input: { title?: unknown; body?: unknown },
  now = new Date(),
): ForumAuthorEditResult {
  const post = db.getForumPost(postId);
  if (!post || post.state !== "visible") return { ok: false, status: 404, error: "post_not_found", message: "That post isn't available." };
  if (postModerated(db, postId)) {
    return { ok: false, status: 403, error: "post_unavailable", message: "This post is no longer available for edits." };
  }
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!title || title.length > MAX_TITLE) {
    return { ok: false, status: 400, error: "invalid_title", message: `Give your post a title (1-${MAX_TITLE} characters).` };
  }
  if (!body || body.length > MAX_BODY) {
    return { ok: false, status: 400, error: "invalid_body", message: `Write a post (1-${MAX_BODY} characters).` };
  }
  const auth = authorizeScoped(db, ctx, "admin.forum_post_edit", postId, now, {
    enforceCity: post.cityId,
    auditCity: post.cityId,
    owner: post.authorAccountId ? db.getAccount(post.authorAccountId)?.email ?? null : null,
    change: title !== post.title ? `title: "${post.title.slice(0, 60)}" -> "${title.slice(0, 60)}"` : `body edited (${body.length} chars)`,
  });
  if (!auth.ok) return auth;
  const updated = db.updateForumPost(postId, { title: title.slice(0, MAX_TITLE), body: body.slice(0, MAX_BODY) })!;
  const content = db.getContent(`post:${postId}`);
  if (content) db.upsertContent({ ...content, title: updated.title });
  const actor = db.getAccount(auth.data.accountId ?? "");
  return {
    ok: true,
    data: {
      post: {
        id: updated.id,
        section: updated.section,
        title: updated.title,
        body: updated.body,
        author: actor?.name ?? "Runner",
        authorNote: null,
        createdAt: forumDateLabel(updated.createdAt, now),
        replies: visibleReplyCount(db, updated.id),
        pinned: updated.pinned === true,
        authorId: updated.authorAccountId,
        capabilities: forumPostCapabilities(actor ?? undefined, updated, now),
      },
      record: updated,
    },
  };
}
