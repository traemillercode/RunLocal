import { useEffect, useMemo, useState, type ReactNode } from "react";
import { HomeCityBanner } from "../components/HomeCityBanner";
import { VerifiedGateSheet } from "../components/VerifiedGateSheet";
import { Chip, Icon, PillButton, Sheet } from "../components/ui";
import { useToast } from "../lib/toast";
import { useAccount } from "../state/account";
import { getActivityFeed, type PublicActivityCard } from "../lib/api";
import { useModerated } from "../state/moderated";
import { canDo, type AccountRole } from "../lib/accounts";
import * as api from "../lib/api";
import { FORUM_SECTIONS, type City, type ForumPost, type ForumSection, type QaSort } from "../types";

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
  announcements: { icon: "megaphone", active: "bg-amber-500 text-white", badge: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  community: { icon: "chat", active: "bg-emerald-600 text-white", badge: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-600" },
  qa: { icon: "help", active: "bg-sky-600 text-white", badge: "bg-sky-100 text-sky-800", dot: "bg-sky-600" },
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
  title: string;
  body: string;
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
  onOpenGate,
  onSubmit,
  submitting = false,
  postError = null,
}: {
  role: AccountRole;
  onClose: () => void;
  onOpenGate: () => void;
  onSubmit?: (draft: ForumPostDraft) => void;
  submitting?: boolean;
  postError?: string | null;
}) {
  const verified = role === "verified";
  const [section, setSection] = useState<ForumSection>("community");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const cta: { label: string; icon: string; onClick: () => void } = verified
    ? { label: "Post to forum", icon: "check", onClick: () => onSubmit?.({ section, title, body }) }
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
          {FORUM_SECTIONS.map((s) => {
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
      {postError ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-[13px] font-semibold text-rose-800">{postError}</p> : null}
      <PillButton variant="primary" className="w-full" disabled={submitting} onClick={cta.onClick}>
        <Icon name={cta.icon} className="h-4 w-4" /> {submitting ? "Posting…" : cta.label}
      </PillButton>
      <p className="text-center text-xs text-slate-400">Your post appears in the selected section for your city.</p>
    </div>
  );
}

/**
 * Inline reply thread for one post — presentational (no data hooks) so SSR
 * tests can render the real markup per role. Verified members get the live
 * composer (submitted via `onSubmit`); guests / pending / rejected users see
 * the existing replies plus honest read-only copy — the verified-profile gate
 * with denial copy is driven by the page's Reply-button flow (replyIntent).
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
}: {
  role: AccountRole;
  replies: api.ForumReplyView[];
  onDraftChange: (value: string) => void;
  draft: string;
  onSubmit: () => void;
  submitting?: boolean;
  replyError?: string | null;
  loading?: boolean;
}) {
  const verified = role === "verified";
  return (
    <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3" data-testid={`thread-${""}`} aria-label="Replies">
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
                <p className="text-xs font-semibold text-slate-700">
                  {r.author} <span className="font-normal text-slate-400">· {r.createdAt}</span>
                </p>
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

function PostCard({
  post,
  section,
  onReply,
  replyExpanded = false,
  thread = null,
  verified,
}: {
  post: ForumPost;
  section: ForumSection;
  onReply: () => void;
  replyExpanded?: boolean;
  thread?: ReactNode;
  verified: boolean;
}) {
  const initials = post.author
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <article className="desktop-forum-card overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <div className="flex gap-3 p-4 pb-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-[13px] font-bold text-slate-600">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[15px] font-bold leading-snug text-slate-900">{post.title}</h3>
            {post.pinned ? (
              <Chip tone={section === "announcements" ? "amber" : "neutral"}>
                <Icon name="pin" className="h-3 w-3" /> Pinned
              </Chip>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600 line-clamp-3">{post.body}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5">
        <p className="min-w-0 truncate text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{post.author}</span>
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
        <button
          type="button"
          onClick={onReply}
          aria-expanded={replyExpanded}
          className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold active:bg-slate-200 ${
            replyExpanded ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-700"
          }`}
        >
          <Icon name={verified ? "chat" : "lock"} className="h-3.5 w-3.5" /> Reply
        </button>
      </div>
      {replyExpanded ? thread : null}
    </article>
  );
}

export function ForumPage({ city }: { city: City }) {
  const toast = useToast();
  const { role, me } = useAccount();
  const { hidden } = useModerated();
  const [section, setSection] = useState<ForumSection>("announcements");
  const [qaSort, setQaSort] = useState<QaSort>("newest");
  const [gateOpen, setGateOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [serverPosts, setServerPosts] = useState<api.ForumPostView[]>([]);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [repliesByPost, setRepliesByPost] = useState<Record<string, api.ForumReplyView[]>>({});
  const [threadLoading, setThreadLoading] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
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

  const posts = useMemo(() => {
    // Owner-hidden posts are excluded from public rendering (seed + user posts
    // share the `post:<id>` moderation registry; the server also filters).
    // Seed posts keep their sample reply counts and add persisted replies;
    // user posts carry the server-computed persisted count already.
    const visible = city.forum
      .filter((p) => !hidden.has(`post:${p.id}`))
      .map((p) => ({ ...p, replies: p.replies + (replyCounts[p.id] ?? 0) }));
    const userPosts: ForumPost[] = serverPosts
      .filter((p) => !hidden.has(`post:${p.id}`))
      .map((p) => ({
        id: p.id,
        section: p.section,
        title: p.title,
        body: p.body,
        author: p.author,
        authorNote: p.authorNote ?? undefined,
        createdAt: p.createdAt,
        answered: false,
        pinned: p.pinned,
        replies: p.replies,
      }));
    let list = [...visible, ...userPosts].filter((p) => p.section === section);
    if (section === "qa") {
      const sorted = [...list];
      if (qaSort === "newest") sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (qaSort === "unanswered") sorted.sort((a, b) => Number(!!a.answered) - Number(!!b.answered));
      if (qaSort === "top") sorted.sort((a, b) => b.replies - a.replies);
      return sorted;
    }
    return [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  }, [city.forum, hidden, section, qaSort, serverPosts, replyCounts]);

  const [activityCards, setActivityCards] = useState<PublicActivityCard[]>([]);
  useEffect(() => { let live = true; void getActivityFeed(city.id).then((r) => { if (live && r.ok) setActivityCards(r.data.cards); }); return () => { live = false; }; }, [city.id]);
  const onReply = (postId: string, title: string) => {
    const intent = replyIntent(role, title);
    if (intent.opensGate) {
      if (intent.toast) toast(intent.toast, "info");
      setGateOpen(true);
      return;
    }
    // Verified: toggle the inline thread + live composer.
    setOpenThreadId((cur) => (cur === postId ? null : postId));
    if (openThreadId !== postId) openThread(postId);
    else setReplyDraft("");
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

  const onSubmitPost = (draft: { section: ForumSection; title: string; body: string }) => {
    if (submitting) return;
    const title = draft.title.trim();
    const body = draft.body.trim();
    if (!title || !body) { setPostError("Add a title and some details before posting."); return; }
    setSubmitting(true);
    setPostError(null);
    void api.createForumPost({ section: draft.section, title, body }).then((r) => {
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

      <HomeCityBanner />
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
                  qaSort === o.id ? "bg-sky-600 text-white" : "text-slate-500 active:bg-slate-100"
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

      </div>
      <aside className="desktop-forum-context" aria-label="Forum guidance">
        <p className="text-[11px] font-extrabold uppercase tracking-[.12em] text-[#FF5741]">Community guidelines</p>
        <h2 className="mt-2 text-lg font-extrabold tracking-tight text-slate-900">A useful local forum</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-600">Browse announcements, community notes, and runner questions. Posting and replying are open to verified members.</p>
        <div className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500"><strong className="text-slate-700">Keep it local.</strong> Share route details and event context that help fellow runners.</div>
      </aside>
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
