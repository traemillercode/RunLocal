import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { HomeCityBanner } from "../components/HomeCityBanner";
import { ProfileCompletionBanner } from "../components/ProfileCompletionBanner";
import { VerifiedGateSheet } from "../components/VerifiedGateSheet";
import { ActionMenu } from "../components/ActionMenu";
import { ModerationConfirmSheet } from "../components/ModerationConfirmSheet";
import { Chip, Icon, PillButton, Sheet } from "../components/ui";
import { useToast } from "../lib/toast";
import { useAccount } from "../state/account";
import { getActivityFeed, type PublicActivityCard } from "../lib/api";
import { usePublicContent } from "../state/content";
import { useModerated } from "../state/moderated";
import { canDo, type AccountRole } from "../lib/accounts";
import { actionMenuItems, type ActionKey } from "../lib/actionModel";
import { PostTags, TagRunnerSheet } from "../components/Tagging";
import * as api from "../lib/api";
import { FORUM_SECTIONS, FORUM_CATEGORIES, type City, type ForumSection, type ForumCategory, type QaSort } from "../types";
import { RailCard, RailItemLink, RailSeeAll, RailStack } from "../components/RailCard";
import { WEEKDAY_LABELS } from "../lib/calendar";
import { formatRaceDate, DAY_NAMES } from "../lib/dates";
import { isPastCalendarDate } from "../lib/activityDates";

/**
 * Reply-button intent. Verified members are past the verification gate: they
 * may post NEW threads AND reply (the thread with a live composer opens
 * inline — no toast, no gate). Guests, pending, and rejected users keep the
 * honest verified-profile gate (rejected shows denial + private reason inside
 * the sheet). Pure so SSR tests can pin the behavior.
 */
export function replyIntent(role: AccountRole, title: string): { toast: string | null; opensGate: boolean } {
  if (canDo(role, "post")) {
    // Verified: the live thread + composer opens instead of a toast.
    return { toast: null, opensGate: false };
  }
  return { toast: `Replies need a verified profile — "${title}"`, opensGate: true };
}

const SECTION_META: Record<ForumSection, { icon: string; active: string; badge: string; dot: string }> = {
  announcements: { icon: "megaphone", active: "bg-[#14171C] text-white", badge: "bg-slate-100 text-slate-600", dot: "bg-[#FF5741]" },
  community: { icon: "chat", active: "bg-[#14171C] text-white", badge: "bg-slate-100 text-slate-600", dot: "bg-[#FF5741]" },
  qa: { icon: "help", active: "bg-[#14171C] text-white", badge: "bg-slate-100 text-slate-600", dot: "bg-[#FF5741]" },
};

/**
 * Forum section tabs — presentational (no hooks) so UI tests can render the
 * real markup. Tabs size to their content instead of a rigid 3-equal-column
 * grid: at 390px a fixed third (≈106px) cannot fit "Announcements" (≈118px at
 * 13px) plus its icon, which is what made that pill overflow while Community
 * and Q&A looked fine. Content-sized pills give every tab the same comfortable
 * horizontal padding (`px-3`) without truncating or wrapping any label.
 */
export function ForumSectionTabs({ section, onSelect }: { section: ForumSection; onSelect: (s: ForumSection) => void }) {
  return (
    <div role="tablist" aria-label="Forum sections" className="mt-4 flex justify-between gap-1.5 rounded-2xl bg-slate-100 p-1.5">
      {FORUM_SECTIONS.map((s) => {
        const active = section === s.id;
        const meta = SECTION_META[s.id];
        return (
          <button
            key={s.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(s.id)}
            className={`flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13px] font-semibold transition-colors ${
              active ? `${meta.active} shadow-sm` : "text-slate-500 active:bg-white"
            }`}
          >
            <Icon name={meta.icon} className="h-4 w-4 shrink-0" />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

export interface ForumPostDraft {
  section: ForumSection;
  category: ForumCategory;
  title: string;
  body: string;
  linkedEventId?: string;
}

/**
 * "New post" sheet body — presentational (hooks only for the verified form's
 * own field state) so SSR tests can render the real markup per role. Verified
 * members get the LIVE posting form (submitted via `onSubmit`); guests,
 * pending, and rejected users keep the gate CTA that routes through
 * VerifiedGateSheet.
 */
export function ForumCreateSheetBody({
  role,
  canPostAnnouncements = false,
  events = [],
  onOpenGate,
  onSubmit,
  submitting = false,
  postError = null,
}: {
  role: AccountRole;
  canPostAnnouncements?: boolean;
  /** Real, currently-published events the author could link this post to — passed down from the parent so this component stays presentational/testable rather than fetching its own data. */
  events?: import("../lib/api").PublicUserEvent[];
  onClose: () => void;
  onOpenGate: () => void;
  onSubmit?: (draft: ForumPostDraft) => void;
  submitting?: boolean;
  postError?: string | null;
}) {
  const verified = role === "verified";
  const [section, setSection] = useState<ForumSection>("community");
  const [category, setCategory] = useState<ForumCategory>("general");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkedEventId, setLinkedEventId] = useState<string | undefined>(undefined);
  const cta: { label: string; icon: string; onClick: () => void } = verified
    ? { label: "Post to forum", icon: "check", onClick: () => onSubmit?.({ section, category, title, body, linkedEventId }) }
    : role === "rejected"
      ? { label: "View my verification status", icon: "shield", onClick: onOpenGate }
      : role === "pending"
        ? { label: "Continue verification", icon: "chevronRight", onClick: onOpenGate }
        : { label: "Get verified", icon: "shield", onClick: onOpenGate };
  if (!verified) {
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3.5 text-[13px] leading-relaxed text-amber-900">
          <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
          Posting is open to verified runners. Finish verification now so you can join the conversation.
        </p>
        <div>
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Section</span>
          <div className="grid grid-cols-3 gap-1.5">
            {FORUM_SECTIONS.map((s) => {
              const meta = SECTION_META[s.id];
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled
                  className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl text-[12px] font-semibold opacity-60 ${meta.badge}`}
                >
                  <Icon name={meta.icon} className="h-4 w-4" />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Title</span>
          <input
            type="text"
            disabled
            placeholder="Requires a verified profile"
            className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-[16px] text-slate-400 outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Details</span>
          <textarea
            disabled
            rows={3}
            placeholder="Requires a verified profile"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[16px] text-slate-400 outline-none"
          />
        </label>
        <PillButton variant="primary" className="w-full" onClick={cta.onClick}>
          <Icon name={cta.icon} className="h-4 w-4" /> {cta.label}
        </PillButton>
        <p className="text-center text-xs text-slate-400">Posting is open to verified runner profiles.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3.5 text-[13px] leading-relaxed text-emerald-900">
        <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />
        Posting and replying are live for verified members.
      </p>
      <div>
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Section</span>
        <div className="grid grid-cols-3 gap-1.5">
          {FORUM_SECTIONS.filter((s) => s.id !== "announcements" || canPostAnnouncements).map((s) => {
            const meta = SECTION_META[s.id];
            const active = section === s.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSection(s.id)}
                className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl text-[12px] font-semibold ${active ? `${meta.active} shadow-sm` : `${meta.badge} opacity-80`}`}
              >
                <Icon name={meta.icon} className="h-4 w-4" />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Category</span>
        <div className="flex flex-wrap gap-1.5">
          {FORUM_CATEGORIES.map((c) => {
            const active = category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(c.id)}
                className={`min-h-9 rounded-full px-3.5 text-[13px] font-semibold ${active ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Title</span>
        <input
          type="text"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What's this about?"
          className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Details</span>
        <textarea
          value={body}
          rows={4}
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Share route details, questions, or local running news…"
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
        />
      </label>
      {events.length > 0 ? (
        <div>
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Link a run <span className="font-normal text-slate-400">(optional)</span></span>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1.5">
            <button
              type="button"
              onClick={() => setLinkedEventId(undefined)}
              className={`flex min-h-10 w-full items-center rounded-lg px-2.5 text-left text-[13px] font-semibold ${!linkedEventId ? "bg-slate-100 text-slate-900" : "text-slate-400"}`}
            >
              None
            </button>
            {events.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setLinkedEventId(e.id)}
                className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] ${linkedEventId === e.id ? "bg-[#14171C] text-white" : "text-slate-700 hover:bg-slate-50"}`}
              >
                <span className="truncate font-semibold">{e.title}</span>
                <span className={`shrink-0 text-[11px] ${linkedEventId === e.id ? "text-white/70" : "text-slate-400"}`}>{e.time}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {postError ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-[13px] font-semibold text-rose-800">{postError}</p> : null}
      <PillButton variant="primary" className="w-full" disabled={submitting} onClick={cta.onClick}>
        <Icon name={cta.icon} className="h-4 w-4" /> {submitting ? "Posting…" : cta.label}
      </PillButton>
      <p className="text-center text-xs text-slate-400">Your post appears in the selected section for your city.</p>
    </div>
  );
}

/**
 * "Edit post" sheet body — presentational (no data hooks) so SSR tests can
 * render the real markup. Reuses the create sheet's field styling; the section
 * is a static label because author edits re-validate title/body only
 * (PATCH /api/forum/:id).
 */
export function ForumEditPostSheetBody({
  section,
  title,
  body,
  onTitleChange,
  onBodyChange,
  submitting = false,
  error = null,
  admin = false,
  onSubmit,
}: {
  section: ForumSection;
  title: string;
  body: string;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  submitting?: boolean;
  error?: string | null;
  /** Admin edit of ANY post in scope — audited with the operator identity. */
  admin?: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className={`flex items-start gap-2 rounded-xl p-3.5 text-[13px] leading-relaxed ${admin ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}>
        <Icon name={admin ? "lock" : "check"} className="mt-0.5 h-4 w-4 shrink-0" />
        {admin ? "You're editing this post as an admin — the change is recorded in the audit log." : "Only you can edit your own post. Changes are saved to your city's forum."}
      </p>
      <div>
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Section</span>
        <span className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold text-slate-600 ring-1 ring-slate-200">
          <Icon name={SECTION_META[section].icon} className="h-4 w-4" /> {FORUM_SECTIONS.find((s) => s.id === section)?.label}
        </span>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Title</span>
        <input
          type="text"
          value={title}
          maxLength={120}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="What's this about?"
          className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Details</span>
        <textarea
          value={body}
          rows={4}
          maxLength={2000}
          onChange={(e) => onBodyChange(e.target.value)}
          placeholder="Share route details, questions, or local running news…"
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
        />
      </label>
      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-[13px] font-semibold text-rose-800">{error}</p> : null}
      <PillButton variant="primary" className="w-full" disabled={submitting} onClick={onSubmit}>
        <Icon name="check" className="h-4 w-4" /> {submitting ? "Saving…" : "Save changes"}
      </PillButton>
      <p className="text-center text-xs text-slate-400">Your edits update the post everywhere it appears.</p>
    </div>
  );
}

/**
 * "Edit reply" sheet body — presentational. Author edits re-validate the body
 * only (PATCH /api/forum/replies/:id).
 */
export function ForumEditReplySheetBody({
  body,
  onBodyChange,
  submitting = false,
  error = null,
  onSubmit,
}: {
  body: string;
  onBodyChange: (value: string) => void;
  submitting?: boolean;
  error?: string | null;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-slate-700">Reply</span>
        <textarea
          value={body}
          maxLength={1000}
          rows={4}
          onChange={(e) => onBodyChange(e.target.value)}
          placeholder="Add a reply for your city's forum…"
          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
        />
      </label>
      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-[13px] font-semibold text-rose-800">{error}</p> : null}
      <PillButton variant="primary" className="w-full" disabled={submitting} onClick={onSubmit}>
        <Icon name="check" className="h-4 w-4" /> {submitting ? "Saving…" : "Save changes"}
      </PillButton>
      <p className="text-center text-xs text-slate-400">Your edit updates the reply in the thread.</p>
    </div>
  );
}

/**
 * Inline reply thread for one post — presentational (no data hooks) so SSR
 * tests can render the real markup per role. Verified members get the live
 * composer (submitted via `onSubmit`); guests / pending / rejected users see
 * the existing replies plus honest read-only copy — the verified-profile gate
 * with denial copy is driven by the page's Reply-button flow (replyIntent).
 *
 * Each reply row carries the server-computed capability list; the ActionMenu
 * renders a trigger only when the actor has actions (author edit/delete,
 * verified non-author report) and nothing at all for empty lists.
 */
export function ForumThread({
  role,
  replies,
  onDraftChange,
  draft,
  onSubmit,
  submitting = false,
  replyError = null,
  loading = false,
  onReplyAction,
}: {
  role: AccountRole;
  replies: api.ForumReplyView[];
  onDraftChange: (value: string) => void;
  draft: string;
  onSubmit: () => void;
  submitting?: boolean;
  replyError?: string | null;
  loading?: boolean;
  /** Menu action dispatcher for a reply (author edit/delete, verified report). */
  onReplyAction?: (reply: api.ForumReplyView, key: ActionKey) => void;
}) {
  const verified = role === "verified";
  return (
    <div className="rounded-b-2xl border-t border-slate-100 bg-slate-50/60 px-4 py-3" data-testid={`thread-${""}`} aria-label="Replies">
      {loading ? (
        <p className="text-xs font-medium text-slate-400">Loading replies…</p>
      ) : replies.length === 0 ? (
        <p className="text-xs font-medium text-slate-400">No replies yet.</p>
      ) : (
        <ul className="space-y-3">
          {replies.map((r) => (
            <li key={r.id} className="flex gap-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                {r.author
                  .split(/\s+/)
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
              <div className="min-w-0 flex-1 rounded-xl bg-white p-3 ring-1 ring-slate-200/70">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-xs font-semibold text-slate-700">
                    {r.authorId ? (
                      <Link to={`/runners/${r.authorId}`} className="font-semibold text-slate-700 hover:underline underline-offset-2">
                        {r.author}
                      </Link>
                    ) : (
                      r.author
                    )}{" "}
                    <span className="font-normal text-slate-400">· {r.createdAt}</span>
                  </p>
                  <ActionMenu
                    entityTitle={`Reply by ${r.author}`}
                    items={actionMenuItems(r.capabilities)}
                    onSelect={(key) => onReplyAction?.(r, key)}
                  />
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">{r.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {verified ? (
        <div className="mt-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Reply as yourself</span>
            <textarea
              value={draft}
              maxLength={1000}
              rows={2}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder="Add a reply for your city's forum…"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
            />
          </label>
          {replyError ? <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-2.5 text-[12px] font-semibold text-rose-800">{replyError}</p> : null}
          <div className="mt-2 flex justify-end">
            <PillButton variant="primary" className="min-h-10 px-4 text-[13px]" disabled={submitting} onClick={onSubmit}>
              <Icon name="chat" className="h-3.5 w-3.5" /> {submitting ? "Posting…" : "Reply"}
            </PillButton>
          </div>
        </div>
      ) : (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900">
          <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Replies are open to verified runner profiles — you can read them, and joining in only takes a few minutes.
        </p>
      )}
    </div>
  );
}

/**
 * One forum card row. Presentational (no data hooks) so SSR tests can render
 * the real markup per role. The action menu is driven ENTIRELY by the
 * server-computed capability list (user posts) or the admin-only list (seed
 * posts): the author sees Edit/Delete, admins see Hide/Restore/Delete, any
 * verified non-author sees Report, and an empty list renders no trigger at
 * all — the client never derives rights from emails or roles.
 */
export function PostCard({
  post,
  section,
  onReply,
  replyExpanded = false,
  thread = null,
  verified,
  onAction,
  onVote,
  tags,
}: {
  post: ForumPostRow;
  section: ForumSection;
  onReply: () => void;
  replyExpanded?: boolean;
  thread?: ReactNode;
  verified: boolean;
  /** Menu action dispatcher — the page maps each key to an edit sheet or confirm flow. */
  onAction?: (key: ActionKey) => void;
  /** Toggles the viewer's upvote — omitted for guests/pending (button still shows the count, just isn't clickable). */
  onVote?: () => void;
  /** Tag chips under the post body (PostTags) — renders nothing when empty. */
  tags?: ReactNode;
}) {
  const initials = post.author
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <article className="desktop-forum-card rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <div className="flex gap-3 p-4 pb-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-[13px] font-bold text-slate-600">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 text-[15px] font-bold leading-snug text-slate-900">
              <button type="button" onClick={onReply} className="text-left hover:underline underline-offset-2">
                {post.title}
              </button>
            </h3>
            <span className="flex shrink-0 items-center gap-1.5">
              {post.pinned ? (
                <Chip tone={section === "announcements" ? "amber" : "neutral"}>
                  <Icon name="pin" className="h-3 w-3" /> Pinned
                </Chip>
              ) : null}
              <ActionMenu entityTitle={post.title} items={actionMenuItems(post.capabilities)} onSelect={(key) => onAction?.(key)} />
            </span>
          </div>
          {verified ? (
            <>
              <p className={`mt-1 text-[13px] leading-relaxed text-slate-600 ${replyExpanded ? "" : "line-clamp-3"}`}>{post.body}</p>
              {post.linkedEvent ? (
                <Link
                  to="/"
                  className="mt-2 flex items-center gap-2.5 rounded-xl bg-slate-50 p-2.5 hover:bg-slate-100"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#14171C] text-white"><Icon name="calendar" className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-bold text-slate-900">{post.linkedEvent.title}</span>
                    <span className="block text-[12px] text-slate-500">{DAY_NAMES[post.linkedEvent.dayOfWeek]}s, {post.linkedEvent.time} · {post.linkedEvent.location}</span>
                  </span>
                </Link>
              ) : null}
            </>
          ) : (
            <button type="button" onClick={onReply} className="relative mt-1.5 block w-full text-left">
              <p aria-hidden="true" className="line-clamp-2 select-none text-[13px] leading-relaxed text-slate-500 blur-[5px]">
                {post.body}
              </p>
              <span className="mt-1.5 flex items-center gap-1.5 text-[12px] font-bold text-[#14171C]">
                <Icon name="lock" className="h-3.5 w-3.5" /> Verify your account to read this
              </span>
            </button>
          )}
          {tags}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5">
        <p className="min-w-0 truncate text-xs text-slate-500">
          {post.authorId ? (
            <Link to={`/runners/${post.authorId}`} className="font-semibold text-slate-700 hover:underline underline-offset-2">
              {post.author}
            </Link>
          ) : (
            <span className="font-semibold text-slate-700">{post.author}</span>
          )}
          {post.authorNote ? <span className="ml-1.5 text-slate-400">· {post.authorNote}</span> : null}
          <span className="text-slate-300"> · </span>
          {post.createdAt}
          <span className="ml-2 inline-flex items-center gap-1 font-semibold text-slate-500">
            <Icon name="chat" className="h-3.5 w-3.5" /> {post.replies}
          </span>
          {section === "qa" ? (
            <span className="ml-2">
              {post.answered ? <Chip tone="emerald">Answered</Chip> : <Chip tone="sky">Open question</Chip>}
            </span>
          ) : null}
        </p>
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onVote}
            disabled={!onVote}
            aria-pressed={post.hasVoted}
            aria-label={post.hasVoted ? "Remove your helpful vote" : "Mark this post as helpful"}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold disabled:opacity-50 ${
              post.hasVoted ? "bg-[#FF5741] text-[#14171C]" : "bg-slate-100 text-slate-700 active:bg-slate-200"
            }`}
          >
            <Icon name="spark" className="h-3.5 w-3.5" /> {post.voteCount ?? 0}
          </button>
          <button
            type="button"
            onClick={onReply}
            aria-expanded={replyExpanded}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold active:bg-slate-200 ${
              replyExpanded ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-700"
            }`}
          >
            <Icon name={verified ? "chat" : "lock"} className="h-3.5 w-3.5" /> Reply
          </button>
        </span>
      </div>
      {replyExpanded ? thread : null}
    </article>
  );
}

/**
 * Merged forum row: seed posts (from the city data) plus server-persisted user
 * posts, each carrying the capability list that drives its action menu. Seed
 * posts get the admin-only list when the signed-in account is a Global Admin
 * or an in-scope City Admin; user posts carry the server-computed list
 * verbatim. An empty list renders no trigger.
 */
export interface ForumPostRow {
  id: string;
  section: ForumSection;
  /** Topic filter — null/absent for seed posts and posts created before categories existed. */
  category?: ForumCategory | null;
  title: string;
  body: string;
  author: string;
  authorNote?: string;
  /** Author account id — null/absent for seed posts (no profile link). */
  authorId?: string | null;
  createdAt: string;
  answered?: boolean;
  pinned?: boolean;
  replies: number;
  /** "Was this helpful" upvote count and whether the viewer has voted — absent/0/false for seed posts and posts loaded before voting existed. */
  voteCount?: number;
  hasVoted?: boolean;
  /** Real, currently-published run this post references — absent/null for seed posts and posts with no link. */
  linkedEvent?: { id: string; title: string; dayOfWeek: number; time: string; location: string } | null;
  /** Server-computed action capabilities (user posts) or the admin-only list (seed posts). */
  capabilities: string[];
}

/** A moderation/author action awaiting confirmation in the sheet. */
type ConfirmAction =
  | { kind: "delete_own_post"; postId: string; title: string }
  | { kind: "hide_own_post"; postId: string; title: string }
  | { kind: "restore_own_post"; postId: string; title: string }
  | { kind: "hide_post"; postId: string; title: string }
  | { kind: "restore_post"; postId: string; title: string }
  | { kind: "delete_post"; postId: string; title: string }
  | { kind: "report_post"; postId: string; title: string }
  | { kind: "pin_post"; postId: string; title: string }
  | { kind: "unpin_post"; postId: string; title: string }
  | { kind: "delete_own_reply"; postId: string; replyId: string; author: string }
  | { kind: "report_reply"; postId: string; replyId: string; author: string };

/**
 * Desktop forum rail — guidance card + cross links to the week's group runs
 * and upcoming races, using the shared rail primitives (hidden below lg).
 */
export function upcomingGroupRunRows(city: City, now = new Date(), limit = 3): { id: string; title: string; meta: string }[] {
  const todayIdx = (now.getDay() + 6) % 7;
  return city.events
    .map((e) => ({ e, days: (e.dayOfWeek - todayIdx + 7) % 7 }))
    .sort((a, b) => a.days - b.days)
    .slice(0, limit)
    .map(({ e, days }) => {
      const when = days === 0 ? "Today" : days === 1 ? "Tomorrow" : WEEKDAY_LABELS[e.dayOfWeek];
      return { id: e.id, title: e.title, meta: `${when} · ${e.time}` };
    });
}

export function ForumRailCrossLinks({ city }: { city: City }) {
  const runs = upcomingGroupRunRows(city);
  const races = city.races
    .filter((r) => !isPastCalendarDate(r.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 2);
  return (
    <>
      <RailCard kicker="Upcoming group runs" footer={<RailSeeAll to="/events">See all →</RailSeeAll>}>
        {runs.length === 0 ? (
          <p className="mt-2 text-[13px] text-slate-500">No upcoming group runs listed yet.</p>
        ) : (
          runs.map((r) => <RailItemLink key={r.id} to="/events" title={r.title} meta={r.meta} />)
        )}
      </RailCard>
      <RailCard kicker="Upcoming races" footer={<RailSeeAll to="/races">See all →</RailSeeAll>}>
        {races.length === 0 ? (
          <p className="mt-2 text-[13px] text-slate-500">No upcoming races listed yet.</p>
        ) : (
          races.map((r) => <RailItemLink key={r.id} to="/races" title={r.name} meta={`${formatRaceDate(r.date)} · ${r.distance}`} />)
        )}
      </RailCard>
      <RailCard kicker="Your city" title={`${city.name}, ${city.state}`}>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">Local runs, races, and community — everything here is scoped to {city.name}.</p>
      </RailCard>
    </>
  );
}

export function ForumRail({ city }: { city: City }) {
  return (
    <RailStack ariaLabel="Forum guidance">
      <RailCard kicker="Community guidelines" title="A useful local forum">
        <p className="mt-1 text-[13px] leading-relaxed text-slate-600">Browse announcements, community notes, and runner questions. Posting and replying are open to verified members.</p>
        <div className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500"><strong className="text-slate-700">Keep it local.</strong> Share route details and event context that help fellow runners.</div>
      </RailCard>
      <ForumRailCrossLinks city={city} />
    </RailStack>
  );
}

export function ForumPage({ city }: { city: City }) {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { role, me } = useAccount();
  const { events: linkableEvents } = usePublicContent();
  const { hidden } = useModerated();
  const [section, setSection] = useState<ForumSection>("announcements");
  const [categoryFilter, setCategoryFilter] = useState<ForumCategory | null>(null);
  const [qaSort, setQaSort] = useState<QaSort>("newest");
  const [gateOpen, setGateOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // Arrived via the unified "+" create menu - open the same compose sheet
  // directly, then clean the param so it doesn't reopen on a later revisit.
  useEffect(() => {
    if (searchParams.get("compose") === "1") {
      setCreateOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("compose");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [serverPosts, setServerPosts] = useState<api.ForumPostView[]>([]);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  /** Optimistic overlay for votes — applies to both seed and server posts uniformly, since seed posts aren't tracked in serverPosts state at all. */
  const [voteOverrides, setVoteOverrides] = useState<Record<string, { voteCount: number; hasVoted: boolean }>>({});
  const [repliesByPost, setRepliesByPost] = useState<Record<string, api.ForumReplyView[]>>({});
  const [threadLoading, setThreadLoading] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  // Phase 2b moderation UI state: author edit sheets, the shared confirm
  // sheet, and the local hidden overlay so admin Hide/Delete removes seed
  // posts (which live in the client city data) immediately — user posts are
  // re-filtered by the server on the next loadForum().
  const [localHidden, setLocalHidden] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [editPost, setEditPost] = useState<{ id: string; title: string; body: string; admin?: boolean } | null>(null);
  const [editPostBusy, setEditPostBusy] = useState(false);
  const [editPostError, setEditPostError] = useState<string | null>(null);
  const [editReply, setEditReply] = useState<{ postId: string; replyId: string; body: string } | null>(null);
  const [editReplyBusy, setEditReplyBusy] = useState(false);
  const [editReplyError, setEditReplyError] = useState<string | null>(null);
  // Tagging (v1): composer targets one forum post; successful tags bump
  // tagsReload so every post's chip list refetches (small N, keeps chips
  // honest without per-post bookkeeping).
  const [tagPost, setTagPost] = useState<ForumPostRow | null>(null);
  const [tagsReload, setTagsReload] = useState(0);
  const viewerId = me?.status === "signed_in" ? me.account.id : null;

  const loadForum = () => {
    void api.getForumPosts(city.id).then((r) => {
      if (r.ok) {
        setServerPosts(r.data.posts);
        setReplyCounts((prev) => ({ ...prev, ...r.data.replyCounts }));
      }
    });
  };
  useEffect(() => { loadForum(); }, [city.id]);

  const openThread = (postId: string) => {
    setOpenThreadId(postId);
    setReplyDraft("");
    setReplyError(null);
    if (!repliesByPost[postId]) {
      setThreadLoading(postId);
      void api.getForumReplies(city.id, postId).then((r) => {
        setThreadLoading(null);
        if (r.ok) setRepliesByPost((prev) => ({ ...prev, [postId]: r.data.replies }));
      });
    }
  };

  const reloadThread = (postId: string) => {
    void api.getForumReplies(city.id, postId).then((r) => {
      if (r.ok) setRepliesByPost((prev) => ({ ...prev, [postId]: r.data.replies }));
    });
  };

  // Deep link: ?post=<id> opens that thread directly, switching to its
  // section first if needed. Runs once serverPosts have loaded so
  // server-created posts (not just seed posts) are found too.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    const targetId = searchParams.get("post");
    if (!targetId || deepLinkHandled.current) return;
    const seedMatch = city.forum.find((p) => p.id === targetId);
    const serverMatch = serverPosts.find((p) => p.id === targetId);
    const match = seedMatch ?? serverMatch;
    if (!match) return;
    deepLinkHandled.current = true;
    if (match.section !== section) setSection(match.section);
    openThread(targetId);
  }, [searchParams, city.forum, serverPosts]);

  // Admin capability list for SEED posts (the server only computes
  // capabilities for user-created posts it serves; seed posts live in the
  // client city data and are moderated through the same content registry).
  const account = me?.status === "signed_in" ? me.account : null;
  const adminCaps: string[] =
    account && (account.isOwner === true || (account.role === "city_admin" && account.adminCityId === city.id))
      ? ["hide", "restore", "delete"]
      : [];

  const posts = useMemo<ForumPostRow[]>(() => {
    // Owner-hidden posts are excluded from public rendering (seed + user posts
    // share the `post:<id>` moderation registry; the server also filters).
    // Seed posts keep their sample reply counts and add persisted replies;
    // user posts carry the server-computed persisted count already.
    const isHidden = (id: string) => hidden.has(`post:${id}`) || localHidden.has(`post:${id}`);
    const visible: ForumPostRow[] = city.forum
      .filter((p) => !isHidden(p.id))
      .map((p) => ({ ...p, replies: p.replies + (replyCounts[p.id] ?? 0), capabilities: adminCaps }));
    const userPosts: ForumPostRow[] = serverPosts
      .filter((p) => !isHidden(p.id))
      .map((p) => ({
        id: p.id,
        section: p.section,
        category: p.category,
        title: p.title,
        body: p.body,
        author: p.author,
        authorNote: p.authorNote ?? undefined,
        authorId: p.authorId,
        createdAt: p.createdAt,
        answered: false,
        pinned: p.pinned,
        replies: p.replies,
        voteCount: p.voteCount ?? 0,
        hasVoted: p.hasVoted ?? false,
        linkedEvent: p.linkedEvent,
        capabilities: p.capabilities,
      }));
    let list = [...visible, ...userPosts]
      .filter((p) => p.section === section)
      .map((p) => (voteOverrides[p.id] ? { ...p, ...voteOverrides[p.id] } : p));
    if (categoryFilter) list = list.filter((p) => p.category === categoryFilter);
    if (section === "qa") {
      const sorted = [...list];
      if (qaSort === "newest") sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (qaSort === "unanswered") sorted.sort((a, b) => Number(!!a.answered) - Number(!!b.answered));
      if (qaSort === "top") sorted.sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0));
      return sorted;
    }
    return [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  }, [city.forum, hidden, localHidden, section, categoryFilter, qaSort, serverPosts, replyCounts, adminCaps, voteOverrides]);

  const [activityCards, setActivityCards] = useState<PublicActivityCard[]>([]);
  useEffect(() => { let live = true; void getActivityFeed(city.id).then((r) => { if (live && r.ok) setActivityCards(r.data.cards); }); return () => { live = false; }; }, [city.id]);
  const onReply = (postId: string, title: string) => {
    const intent = replyIntent(role, title);
    if (intent.opensGate) {
      if (intent.toast) toast(intent.toast, "info");
      setGateOpen(true);
      return;
    }
    // Verified: toggle the inline thread + live composer. The open post is
    // synced to ?post=<id> so a thread has a real, shareable, reloadable URL —
    // the "click a post and see the full thing" behavior.
    const closing = openThreadId === postId;
    setOpenThreadId(closing ? null : postId);
    if (!closing) {
      openThread(postId);
      setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("post", postId); return next; }, { replace: true });
    } else {
      setReplyDraft("");
      setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("post"); return next; }, { replace: true });
    }
  };

  const onVote = (postId: string, currentVoteCount: number, currentlyVoted: boolean) => {
    if (role !== "verified") {
      setGateOpen(true);
      return;
    }
    // Optimistic — flip immediately, reconcile with the server's real count on response.
    setVoteOverrides((prev) => ({ ...prev, [postId]: { hasVoted: !currentlyVoted, voteCount: currentVoteCount + (currentlyVoted ? -1 : 1) } }));
    void api.toggleForumVote(postId).then((r) => {
      if (r.ok) setVoteOverrides((prev) => ({ ...prev, [postId]: { hasVoted: r.data.voted, voteCount: r.data.voteCount } }));
      else {
        setVoteOverrides((prev) => ({ ...prev, [postId]: { hasVoted: currentlyVoted, voteCount: currentVoteCount } }));
        toast(r.error.message ?? "Couldn't record your vote.", "info");
      }
    });
  };

  const onSubmitReply = (postId: string) => {
    if (replySubmitting) return;
    const body = replyDraft.trim();
    if (!body) { setReplyError("Write a reply before posting."); return; }
    setReplySubmitting(true);
    setReplyError(null);
    void api.createForumReply({ postId, body }).then((r) => {
      setReplySubmitting(false);
      if (r.ok) {
        setRepliesByPost((prev) => ({ ...prev, [postId]: [...(prev[postId] ?? []), r.data.reply] }));
        setReplyCounts((prev) => ({ ...prev, [postId]: (prev[postId] ?? 0) + 1 }));
        setReplyDraft("");
        toast("Your reply is live.", "success");
      } else {
        setReplyError(r.error.message ?? "Couldn't reply — try again.");
      }
    });
  };

  const onSubmitPost = (draft: { section: ForumSection; category: ForumCategory; title: string; body: string }) => {
    if (submitting) return;
    const title = draft.title.trim();
    const body = draft.body.trim();
    if (!title || !body) { setPostError("Add a title and some details before posting."); return; }
    setSubmitting(true);
    setPostError(null);
    void api.createForumPost({ section: draft.section, category: draft.category, title, body }).then((r) => {
      setSubmitting(false);
      if (r.ok) {
        setCreateOpen(false);
        setSection(draft.section);
        loadForum();
        toast("Your post is live.", "success");
      } else {
        setPostError(r.error.message ?? "Couldn't post — try again.");
      }
    });
  };

  // ---------------------------------------------- Phase 2b moderation wiring
  // The ActionMenu dispatches a capability key here; the page maps each key to
  // an edit sheet (author edit_own) or the shared confirm sheet. Every action
  // maps to an endpoint that re-validates the same rules server-side — the
  // menu is only ever a convenience affordance, never a rights grant.

  const handlePostAction = (post: ForumPostRow) => (key: ActionKey) => {
    switch (key) {
      case "edit_own":
        setEditPost({ id: post.id, title: post.title, body: post.body });
        break;
      case "edit":
        // Scoped admin edit of ANY post (global or exact city scope) — the
        // server re-validates the scope and audits the operator.
        setEditPost({ id: post.id, title: post.title, body: post.body, admin: true });
        break;
      case "delete_own":
        setConfirm({ kind: "delete_own_post", postId: post.id, title: post.title });
        break;
      case "hide_own":
        // Author self-service hide — reversible, audited with the author
        // identity; the server re-validates the same author gate.
        setConfirm({ kind: "hide_own_post", postId: post.id, title: post.title });
        break;
      case "restore_own":
        setConfirm({ kind: "restore_own_post", postId: post.id, title: post.title });
        break;
      case "hide":
        setConfirm({ kind: "hide_post", postId: post.id, title: post.title });
        break;
      case "restore":
        setConfirm({ kind: "restore_post", postId: post.id, title: post.title });
        break;
      case "delete":
        setConfirm({ kind: "delete_post", postId: post.id, title: post.title });
        break;
      case "report":
        setConfirm({ kind: "report_post", postId: post.id, title: post.title });
        break;
      case "tag":
        // Verified authors only (server capability) — open the tag composer
        // for this post; createTag re-validates server-side.
        setTagPost(post);
        break;
      case "pin":
        setConfirm({ kind: "pin_post", postId: post.id, title: post.title });
        break;
      case "unpin":
        setConfirm({ kind: "unpin_post", postId: post.id, title: post.title });
        break;
      default:
        // Unknown capability — the actionModel already filters these out, so
        // this branch is defensive only.
        break;
    }
  };

  const handleReplyAction = (postId: string) => (reply: api.ForumReplyView, key: ActionKey) => {
    switch (key) {
      case "edit_own":
        setEditReply({ postId, replyId: reply.id, body: reply.body });
        break;
      case "delete_own":
        setConfirm({ kind: "delete_own_reply", postId, replyId: reply.id, author: reply.author });
        break;
      case "report":
        setConfirm({ kind: "report_reply", postId, replyId: reply.id, author: reply.author });
        break;
      default:
        break;
    }
  };

  /** Display config for the shared confirm sheet, derived from the pending action. */
  const confirmMeta: { title: string; entity: string; impact: string; confirmLabel: string; requireReason: boolean; note?: string; tone?: "danger" | "neutral" } | null = useMemo(() => {
    if (!confirm) return null;
    switch (confirm.kind) {
      case "delete_own_post":
        return {
          title: "Delete your post?",
          entity: confirm.title,
          impact: "Your post and its replies will be removed from the forum. This can't be undone.",
          confirmLabel: "Delete post",
          requireReason: false,
        };
      case "hide_own_post":
        // Author self-service: plain confirm, no reason — the audit trail
        // records the author identity. Reversible by the author anytime.
        return {
          title: "Hide your post?",
          entity: confirm.title,
          impact: "Your post will disappear from the forum for everyone else. You can restore it anytime — this isn't a delete.",
          confirmLabel: "Hide post",
          requireReason: false,
          tone: "neutral",
        };
      case "restore_own_post":
        return {
          title: "Restore your post?",
          entity: confirm.title,
          impact: "Your post will be visible in the forum again, replies included.",
          confirmLabel: "Restore post",
          requireReason: false,
          tone: "neutral",
        };
      case "hide_post":
        return {
          title: "Hide this post?",
          entity: confirm.title,
          impact: "The post will disappear from public listings until an admin restores it. The reason is recorded in the audit log.",
          confirmLabel: "Hide post",
          requireReason: true,
        };
      case "restore_post":
        return {
          title: "Restore this post?",
          entity: confirm.title,
          impact: "The post will be visible in the forum again. The reason is recorded in the audit log.",
          confirmLabel: "Restore post",
          requireReason: true,
        };
      case "delete_post":
        return {
          title: "Delete this post?",
          entity: confirm.title,
          impact: "This permanently removes the post from public view — there is no restore path. The row and audit trail are preserved.",
          confirmLabel: "Delete post",
          requireReason: true,
        };
      case "report_post":
        return {
          title: "Report this post?",
          entity: confirm.title,
          impact: "Kimbio admins will review it against the community guidelines.",
          confirmLabel: "Report post",
          requireReason: true,
          note: "Only Kimbio admins see your report and your name.",
        };
      case "pin_post":
        return {
          title: "Pin this post?",
          entity: confirm.title,
          impact: "It will stay at the top of its forum section so more runners see it.",
          confirmLabel: "Pin post",
          requireReason: false,
          tone: "neutral",
        };
      case "unpin_post":
        return {
          title: "Unpin this post?",
          entity: confirm.title,
          impact: "It will sort with the other posts again instead of staying at the top.",
          confirmLabel: "Unpin post",
          requireReason: false,
          tone: "neutral",
        };
      case "delete_own_reply":
        return {
          title: "Delete your reply?",
          entity: `Reply by ${confirm.author}`,
          impact: "Your reply will be removed from the thread. This can't be undone.",
          confirmLabel: "Delete reply",
          requireReason: false,
        };
      case "report_reply":
        return {
          title: "Report this reply?",
          entity: `Reply by ${confirm.author}`,
          impact: "Kimbio admins will review it against the community guidelines.",
          confirmLabel: "Report reply",
          requireReason: true,
          note: "Only Kimbio admins see your report and your name.",
        };
    }
  }, [confirm]);

  const closeConfirm = () => {
    if (confirmBusy) return;
    setConfirm(null);
    setConfirmError(null);
  };

  /** Execute the confirmed action; every call re-validates server-side. */
  const runConfirm = (reason: string) => {
    if (!confirm || confirmBusy) return;
    const action = confirm;
    setConfirmBusy(true);
    setConfirmError(null);
    const call: Promise<api.ApiResult<unknown>> =
      action.kind === "delete_own_post" ? api.deleteForumPost(action.postId)
      : action.kind === "hide_own_post" ? api.setForumPostHidden(action.postId, true)
      : action.kind === "restore_own_post" ? api.setForumPostHidden(action.postId, false)
      : action.kind === "hide_post" ? api.adminTransitionContent(`post:${action.postId}`, "hide", reason)
      : action.kind === "restore_post" ? api.adminTransitionContent(`post:${action.postId}`, "restore", reason)
      : action.kind === "delete_post" ? api.adminTransitionContent(`post:${action.postId}`, "delete", reason)
      : action.kind === "report_post" ? api.flagContent("post", action.postId, reason)
      : action.kind === "pin_post" ? api.pinForumPost(action.postId, true)
      : action.kind === "unpin_post" ? api.pinForumPost(action.postId, false)
      : action.kind === "delete_own_reply" ? api.deleteForumReply(action.replyId)
      : api.flagContent("reply", action.replyId, reason);
    void call.then((r) => {
      setConfirmBusy(false);
      if (r.ok) {
        setConfirm(null);
        setConfirmError(null);
        // Keep seed-post visibility honest without a round-trip: registry
        // hides/deletes overlay the client city data; restores lift them.
        if (action.kind === "hide_post" || action.kind === "delete_post") {
          setLocalHidden((s) => { const n = new Set(s); n.add(`post:${action.postId}`); return n; });
        } else if (action.kind === "restore_post") {
          setLocalHidden((s) => { const n = new Set(s); n.delete(`post:${action.postId}`); return n; });
        }
        if (action.kind === "delete_own_reply") reloadThread(action.postId);
        if (action.kind === "delete_own_post" || action.kind === "hide_post" || action.kind === "restore_post" || action.kind === "delete_post") {
          loadForum();
        }
        // Pin/unpin: apply the server's returned post immediately so the chip
        // appears/disappears and the menu flips without a full reload.
        if (action.kind === "pin_post" || action.kind === "unpin_post") {
          const updated = (r.data as { post?: api.ForumPostView } | undefined)?.post;
          if (updated) {
            setServerPosts((cur) => cur.map((p) => (p.id === updated.id ? { ...p, pinned: updated.pinned, capabilities: updated.capabilities } : p)));
          }
        }
        // Author hide/restore: keep the post in the author's list with the
        // server's flipped capability (hide_own <-> restore_own) and reply
        // count (0 while hidden), so the restore affordance stays reachable
        // in-session. Everyone else's reads already exclude it server-side.
        if (action.kind === "hide_own_post" || action.kind === "restore_own_post") {
          const updated = (r.data as { post?: api.ForumPostView } | undefined)?.post;
          if (updated) {
            setServerPosts((cur) => cur.map((p) => (p.id === updated.id ? { ...p, pinned: updated.pinned, capabilities: updated.capabilities, replies: updated.replies } : p)));
          }
          // Drop any open thread state so hidden replies stop rendering locally
          // too; reopening refetches from the server (404 while hidden).
          setOpenThreadId((cur) => (cur === action.postId ? null : cur));
          setRepliesByPost((prev) => {
            if (!(action.postId in prev)) return prev;
            const n = { ...prev };
            delete n[action.postId];
            return n;
          });
        }
        toast(
          action.kind === "report_post" || action.kind === "report_reply"
            ? "Thanks — an admin will review your report."
            : "Done.",
          "success",
        );
      } else {
        setConfirmError(r.error.message ?? "That didn't work — try again.");
      }
    });
  };

  const submitEditPost = () => {
    if (!editPost || editPostBusy) return;
    const title = editPost.title.trim();
    const body = editPost.body.trim();
    if (!title || !body) { setEditPostError("Add a title and some details before saving."); return; }
    setEditPostBusy(true);
    setEditPostError(null);
    const call = editPost.admin ? api.adminUpdateForumPost(editPost.id, { title, body }) : api.updateForumPost(editPost.id, { title, body });
    void call.then((r) => {
      setEditPostBusy(false);
      if (r.ok) {
        setEditPost(null);
        loadForum();
        toast(editPost.admin ? "Post updated as admin." : "Your post is updated.", "success");
      } else {
        setEditPostError(r.error.message ?? "Couldn't update — try again.");
      }
    });
  };

  /** Section of the post being edited — always a server-persisted user post. */
  const editPostSection: ForumSection = editPost
    ? (serverPosts.find((p) => p.id === editPost.id)?.section ?? "community")
    : "community";

  const submitEditReply = () => {
    if (!editReply || editReplyBusy) return;
    const body = editReply.body.trim();
    if (!body) { setEditReplyError("Write a reply before saving."); return; }
    const { postId, replyId } = editReply;
    setEditReplyBusy(true);
    setEditReplyError(null);
    void api.updateForumReply(replyId, { body }).then((r) => {
      setEditReplyBusy(false);
      if (r.ok) {
        setEditReply(null);
        reloadThread(postId);
        toast("Your reply is updated.", "success");
      } else {
        setEditReplyError(r.error.message ?? "Couldn't update — try again.");
      }
    });
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading">
      <div className="desktop-forum-layout">
      <div>
      <div className="flex items-end justify-between gap-3" data-tour-target="forum-compose">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Forum</h1>
          <p className="mt-0.5 text-sm font-medium text-slate-500">
            {city.name}, {city.state} · browse freely — posting and replying are open to verified members
          </p>
        </div>
        <PillButton variant="secondary" onClick={() => setCreateOpen(true)} className="min-h-11 px-4">
          <Icon name="plus" className="h-4 w-4" /> New
        </PillButton>
      </div>

      {/* Section tabs — visually distinct per section */}
      <ForumSectionTabs section={section} onSelect={setSection} />
      <p className="mt-2 text-xs text-slate-500">{FORUM_SECTIONS.find((s) => s.id === section)?.blurb}</p>

      {/* Category filter — topic, independent of section. "All" clears the filter. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={categoryFilter === null}
          onClick={() => setCategoryFilter(null)}
          className={`min-h-9 rounded-full px-3.5 text-[13px] font-semibold ${categoryFilter === null ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}
        >
          All
        </button>
        {FORUM_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={categoryFilter === c.id}
            onClick={() => setCategoryFilter(categoryFilter === c.id ? null : c.id)}
            className={`min-h-9 rounded-full px-3.5 text-[13px] font-semibold ${categoryFilter === c.id ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <HomeCityBanner />
      <ProfileCompletionBanner />
      {activityCards.length > 0 ? <section aria-label="Community activity" className="mt-4 space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Community activity</h2>
        {activityCards.map((card) => <article key={card.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70"><div className="flex items-center justify-between"><strong className="text-slate-900">{card.type} · {(card.distanceMeters / 1000).toFixed(1)} km</strong><span className="text-xs font-semibold text-slate-500">{card.attribution}</span></div><p className="mt-1 text-xs text-slate-500">{Math.round(card.durationSeconds / 60)} min · shared activity</p></article>)}
      </section> : null}


      {/* Q&A sorting controls — visible only on the Q&A tab */}
      {section === "qa" ? (
        <div className="mt-3 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
            <Icon name="sort" className="h-4 w-4" /> Sort:
          </span>
          <div className="flex flex-1 gap-1 rounded-full bg-white p-1 ring-1 ring-slate-200">
            {(
              [
                { id: "newest", label: "Newest" },
                { id: "unanswered", label: "Unanswered" },
                { id: "top", label: "Top" },
              ] as { id: QaSort; label: string }[]
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setQaSort(o.id)}
                aria-pressed={qaSort === o.id}
                className={`min-h-9 flex-1 rounded-full text-[12px] font-semibold transition-colors ${
                  qaSort === o.id ? "bg-[#14171C] text-white" : "text-slate-500 active:bg-slate-100"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ul className="mt-4 space-y-3">
        {posts.map((p) => {
          const expanded = openThreadId === p.id;
          return (
            <li key={p.id}>
              <PostCard
                post={p}
                section={section}
                verified={role === "verified"}
                replyExpanded={expanded}
                onReply={() => onReply(p.id, p.title)}
                onVote={() => onVote(p.id, p.voteCount ?? 0, p.hasVoted ?? false)}
                onAction={handlePostAction(p)}
                tags={<PostTags postId={p.id} viewerId={viewerId} reloadKey={tagsReload} />}
                thread={
                  expanded ? (
                    <ForumThread
                      role={role}
                      replies={repliesByPost[p.id] ?? []}
                      loading={threadLoading === p.id}
                      draft={replyDraft}
                      onDraftChange={setReplyDraft}
                      onSubmit={() => onSubmitReply(p.id)}
                      submitting={replySubmitting}
                      replyError={replyError}
                      onReplyAction={handleReplyAction(p.id)}
                    />
                  ) : null
                }
              />
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
          <Icon name="shield" className="h-5 w-5" />
        </span>
        <p className="text-[13px] leading-relaxed text-slate-600">
          <span className="font-semibold text-slate-800">Everyone can browse.</span> Posting and replying are open to
          verified runner profiles; guests, pending, and denied profiles stay read-only.
        </p>
      </div>

      {/* New post — create-sheet affordance, live form for verified members */}
      <Sheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Start a conversation"
        subtitle={role === "verified" ? "Post to the forum" : "Posting requires a verified runner profile"}
      >
        <ForumCreateSheetBody
          role={role}
          canPostAnnouncements={me?.status === "signed_in" && me.account.role !== "runner"}
          events={linkableEvents}
          onClose={() => setCreateOpen(false)}
          onOpenGate={() => {
            setCreateOpen(false);
            setGateOpen(true);
          }}
          onSubmit={onSubmitPost}
          submitting={submitting}
          postError={postError}
        />
      </Sheet>

      {/* Author edit post — reuses the create-sheet fields (section is static; edits are title/body only) */}
      <Sheet
        open={editPost !== null}
        onClose={() => !editPostBusy && setEditPost(null)}
        title={editPost?.admin ? "Edit post (admin)" : "Edit your post"}
        subtitle={editPost ? FORUM_SECTIONS.find((s) => s.id === editPostSection)?.label : undefined}
      >
        {editPost ? (
          <ForumEditPostSheetBody
            section={editPostSection}
            title={editPost.title}
            body={editPost.body}
            onTitleChange={(title) => setEditPost((cur) => (cur ? { ...cur, title } : cur))}
            onBodyChange={(body) => setEditPost((cur) => (cur ? { ...cur, body } : cur))}
            submitting={editPostBusy}
            error={editPostError}
            admin={editPost.admin === true}
            onSubmit={submitEditPost}
          />
        ) : null}
      </Sheet>

      {/* Author edit reply */}
      <Sheet
        open={editReply !== null}
        onClose={() => !editReplyBusy && setEditReply(null)}
        title="Edit your reply"
      >
        {editReply ? (
          <ForumEditReplySheetBody
            body={editReply.body}
            onBodyChange={(body) => setEditReply((cur) => (cur ? { ...cur, body } : cur))}
            submitting={editReplyBusy}
            error={editReplyError}
            onSubmit={submitEditReply}
          />
        ) : null}
      </Sheet>

      {/* Tag a runner on a forum post (verified author capability only) */}
      <TagRunnerSheet
        open={tagPost !== null}
        onClose={() => setTagPost(null)}
        contentType="post"
        contentId={tagPost?.id ?? ""}
        onTagged={() => setTagsReload((n) => n + 1)}
      />

      {/* Shared confirmation sheet — author delete (variant B), admin hide/restore/
          delete (variant A, reason-required), verified report (reason + privacy note) */}
      {confirmMeta ? (
        <ModerationConfirmSheet
          open={confirm !== null}
          onClose={closeConfirm}
          title={confirmMeta.title}
          entity={confirmMeta.entity}
          impact={confirmMeta.impact}
          confirmLabel={confirmMeta.confirmLabel}
          requireReason={confirmMeta.requireReason}
          note={confirmMeta.note}
          tone={confirmMeta.tone}
          busy={confirmBusy}
          error={confirmError}
          onConfirm={(reason) => runConfirm(reason)}
        />
      ) : null}

      </div>
      <ForumRail city={city} />
      </div>
      <VerifiedGateSheet
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        role={role}
        actionLabel="posting and replying"
        pendingLabel="Your profile is still in review."
        rejectionReason={me?.status === "signed_in" ? me.account.rejectionReason ?? null : null}
      />
    </div>
  );
}
