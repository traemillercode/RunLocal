import { useMemo, useState } from "react";
import { SignInSheet } from "../components/SignInSheet";
import { Chip, Icon, PillButton, Sheet } from "../components/ui";
import type { AppStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { FORUM_SECTIONS, type City, type ForumPost, type ForumSection, type QaSort } from "../types";

const SECTION_META: Record<ForumSection, { icon: string; active: string; badge: string; dot: string }> = {
  announcements: { icon: "megaphone", active: "bg-amber-500 text-white", badge: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  community: { icon: "chat", active: "bg-emerald-600 text-white", badge: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-600" },
  qa: { icon: "help", active: "bg-sky-600 text-white", badge: "bg-sky-100 text-sky-800", dot: "bg-sky-600" },
};

function PostCard({
  post,
  section,
  onReply,
}: {
  post: ForumPost;
  section: ForumSection;
  onReply: () => void;
}) {
  const initials = post.author
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
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
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-4 text-[13px] font-semibold text-slate-700 active:bg-slate-200"
        >
          <Icon name="lock" className="h-3.5 w-3.5" /> Reply
        </button>
      </div>
    </article>
  );
}

export function ForumPage({ city, store }: { city: City; store: AppStore }) {
  const toast = useToast();
  const [section, setSection] = useState<ForumSection>("announcements");
  const [qaSort, setQaSort] = useState<QaSort>("newest");
  const [signInOpen, setSignInOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const posts = useMemo(() => {
    let list = city.forum.filter((p) => p.section === section);
    if (section === "qa") {
      const sorted = [...list];
      if (qaSort === "newest") sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (qaSort === "unanswered") sorted.sort((a, b) => Number(!!a.answered) - Number(!!b.answered));
      if (qaSort === "top") sorted.sort((a, b) => b.replies - a.replies);
      return sorted;
    }
    return [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  }, [city.forum, section, qaSort]);

  const onReply = (title: string) => {
    toast(`Replies need a verified profile — "${title}"`, "info");
    setSignInOpen(true);
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Forum</h1>
          <p className="mt-0.5 text-sm font-medium text-slate-500">
            {city.name}, {city.state} · browse freely, posting needs verification
          </p>
        </div>
        <PillButton variant="secondary" onClick={() => setCreateOpen(true)} className="min-h-11 px-4">
          <Icon name="plus" className="h-4 w-4" /> New
        </PillButton>
      </div>

      {/* Section tabs — visually distinct per section */}
      <div role="tablist" aria-label="Forum sections" className="mt-4 grid grid-cols-3 gap-1.5 rounded-2xl bg-slate-100 p-1.5">
        {FORUM_SECTIONS.map((s) => {
          const active = section === s.id;
          const meta = SECTION_META[s.id];
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={active}
              onClick={() => setSection(s.id)}
              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-[13px] font-semibold transition-colors ${
                active ? `${meta.active} shadow-sm` : "text-slate-500 active:bg-white"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Icon name={meta.icon} className="h-4 w-4" />
                {s.label}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">{FORUM_SECTIONS.find((s) => s.id === section)?.blurb}</p>

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
        {posts.map((p) => (
          <li key={p.id}>
            <PostCard post={p} section={section} onReply={() => onReply(p.title)} />
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
          <Icon name="shield" className="h-5 w-5" />
        </span>
        <p className="text-[13px] leading-relaxed text-slate-600">
          <span className="font-semibold text-slate-800">Guests can browse everything.</span> Posting &amp; replying require a
          verified runner profile — verification launches in a later phase.
        </p>
      </div>

      {/* New post — create-sheet affordance, gated */}
      <Sheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Start a conversation"
        subtitle="Posting requires a verified runner profile"
      >
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3.5 text-[13px] leading-relaxed text-amber-900">
            <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
            Posts open to verified runners in a later phase. Add your email and we'll notify you when posting launches.
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
              placeholder="Coming with verification"
              className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-[16px] text-slate-400 outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Details</span>
            <textarea
              disabled
              rows={3}
              placeholder="Coming with verification"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[16px] text-slate-400 outline-none"
            />
          </label>
          <PillButton
            variant="primary"
            className="w-full"
            onClick={() => {
              setCreateOpen(false);
              setSignInOpen(true);
            }}
          >
            <Icon name="mail" className="h-4 w-4" /> Notify me when posting launches
          </PillButton>
          <p className="text-center text-xs text-slate-400">Preview build — this form is disabled on purpose.</p>
        </div>
      </Sheet>

      <SignInSheet
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        store={store}
        reason="Posting and replying are verified-runner actions. Sign-in & verification launch in a later phase — add your email and we'll let you know."
      />
    </div>
  );
}
