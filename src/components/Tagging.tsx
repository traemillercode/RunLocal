/**
 * Lightweight runner tagging on content (v1: forum posts). No approval
 * needed; the tagged runner can self-hide any time (PATCH /api/tags/:id/self).
 *
 * - `TagRunnerSheet`: composer (Sheet, title "Tag a runner") — server search
 *   (searchPeople) + pick + submit → createTag({ contentType, contentId,
 *   taggedUserId }). The POST contract takes NO free-text label (server
 *   validates contentType/contentId/taggedUserId only), so the composer stays
 *   minimal: search, pick, tag.
 * - `TagChips`: chips under content bodies (Chip tone="sky", icon "tag",
 *   runner name → profile link). Data comes from getTags(contentType,
 *   contentId) — the server already excludes hidden-by-tagged-user rows
 *   (unless the viewer IS the tagged user) and blocked pairs. When the viewer
 *   is a tagged user on a chip, a small "Hide me"/"Show me" affordance toggles
 *   selfHideTag optimistically with revert.
 * - `PostTags`: fetch wrapper for forum post bodies.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { Chip, Icon, PillButton, Sheet } from "./ui";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "R";
}

/**
 * Presentational chip list for one content item. Renders nothing for an empty
 * list. Every chip links to the tagged runner's public profile; when the
 * viewer IS the tagged user, a small self-hide affordance appears next to
 * their own chip (only the server ever tells us who is hidden).
 */
export function TagChips({
  tags,
  viewerId,
  busyTagId,
  onToggleHide,
}: {
  tags: api.TagView[];
  viewerId: string | null;
  busyTagId: string | null;
  onToggleHide: (tag: api.TagView) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => {
        const isSelf = viewerId !== null && tag.taggedUserId === viewerId;
        return (
          <li key={tag.id} className="flex items-center gap-1">
            <Link to={`/runners/${tag.taggedUserId}`} className="inline-flex">
              <Chip tone="sky">
                <Icon name="tag" className="h-3 w-3" />
                {tag.taggedUser?.name ?? "Runner"}
              </Chip>
            </Link>
            {isSelf ? (
              <button
                type="button"
                aria-label={tag.hiddenByTaggedUser ? "Show my name on this tag" : "Hide my name on this tag"}
                aria-pressed={!tag.hiddenByTaggedUser}
                disabled={busyTagId === tag.id}
                onClick={() => onToggleHide(tag)}
                className="min-h-11 rounded-full px-2.5 text-[11px] font-bold text-slate-500 active:bg-slate-100 disabled:text-slate-300"
              >
                {busyTagId === tag.id ? "Saving…" : tag.hiddenByTaggedUser ? "Show me" : "Hide me"}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Fetch wrapper for the chips under one forum post body. Refetches when
 * `reloadKey` changes (e.g. right after a tag is created). The server is the
 * only authority on visibility; self-hide is optimistic with revert.
 */
export function PostTags({
  postId,
  viewerId,
  reloadKey = 0,
}: {
  postId: string;
  viewerId: string | null;
  reloadKey?: number;
}) {
  const [tags, setTags] = useState<api.TagView[]>([]);
  const [busyTagId, setBusyTagId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void api.getTags("post", postId).then((r) => {
      if (alive && r.ok) setTags(r.data.tags);
    });
    return () => { alive = false; };
  }, [postId, reloadKey]);
  const toggleHide = (tag: api.TagView) => {
    if (busyTagId) return;
    const prev = tags;
    const hidden = !tag.hiddenByTaggedUser;
    setBusyTagId(tag.id);
    setTags((cur) => cur.map((t) => (t.id === tag.id ? { ...t, hiddenByTaggedUser: hidden } : t)));
    void api.selfHideTag(tag.id, hidden).then((r) => {
      setBusyTagId(null);
      if (!r.ok) setTags(prev);
    });
  };
  return <TagChips tags={tags} viewerId={viewerId} busyTagId={busyTagId} onToggleHide={toggleHide} />;
}

/**
 * Presentational composer body — search field, pickable results (role=
 * listbox/option), honest empty/loading/error states, and the submit button
 * (disabled until a runner is picked). SSR-testable with props.
 */
export function TagRunnerSheetBody({
  query,
  onQueryChange,
  results,
  loading,
  selectedId,
  onSelect,
  submitting,
  error,
  onSubmit,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  results: api.PeopleSearchResult[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (p: api.PeopleSearchResult) => void;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-xl bg-sky-50 p-3.5 text-[13px] leading-relaxed text-sky-900">
        <Icon name="tag" className="mt-0.5 h-4 w-4 shrink-0" />
        Tags point to a runner on this post. No approval needed — they can hide themselves from a tag at any time.
      </p>
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          inputMode="search"
          aria-label="Find a runner to tag"
          placeholder="Search verified runners by name"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="h-12 w-full appearance-none rounded-full border border-slate-200 bg-white pl-11 pr-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60 [&::-webkit-search-cancel-button]:appearance-none"
        />
      </div>
      {loading ? <p className="text-sm text-slate-500">Searching…</p> : null}
      {!loading && query.trim() !== "" && results.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-500">
          No runners found — results are limited to people who've chosen to be found.
        </p>
      ) : null}
      {results.length > 0 ? (
        <ul role="listbox" aria-label="Runner results" className="divide-y divide-slate-100 overflow-hidden rounded-2xl ring-1 ring-slate-200/70">
          {results.map((p) => {
            const selected = p.id === selectedId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelect(p)}
                  className={`flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${selected ? "bg-sky-50" : "bg-white active:bg-slate-50"}`}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                    {initials(p.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold text-slate-900">{p.name}</span>
                    {p.username ? <span className="block truncate text-xs text-slate-500">@{p.username}</span> : null}
                  </span>
                  {selected ? <Icon name="check" className="ml-auto h-4 w-4 shrink-0 text-sky-700" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-[13px] font-semibold text-rose-800">{error}</p> : null}
      <PillButton variant="primary" className="w-full" disabled={submitting || selectedId === null} onClick={onSubmit}>
        <Icon name="tag" className="h-4 w-4" /> {submitting ? "Tagging…" : "Tag runner"}
      </PillButton>
      <p className="text-center text-xs text-slate-400">The tag shows under the post with a link to their profile.</p>
    </div>
  );
}

/**
 * Composer Sheet — holds the search/selection state and submits
 * createTag({ contentType, contentId, taggedUserId }) on confirmation.
 * `onTagged` fires after a successful create so callers can refresh chips.
 */
export function TagRunnerSheet({
  open,
  onClose,
  contentType,
  contentId,
  onTagged,
}: {
  open: boolean;
  onClose: () => void;
  contentType: api.TagContentType;
  contentId: string;
  onTagged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<api.PeopleSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setLoading(false);
      setSelectedId(null);
      setSubmitting(false);
      setError(null);
      seq.current = 0;
    }
  }, [open]);
  const runSearch = (q: string) => {
    setQuery(q);
    setError(null);
    const trimmed = q.trim();
    const s = ++seq.current;
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void api.searchPeople(trimmed).then((r) => {
      if (s !== seq.current) return;
      setLoading(false);
      if (r.ok) setResults(r.data.people);
      else setError(r.error.message ?? "Couldn't search runners. Try again.");
    });
  };
  const submit = () => {
    if (submitting || selectedId === null) return;
    const selected = results.find((p) => p.id === selectedId);
    if (!selected) {
      setError("Pick a runner from the results first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    void api.createTag({ contentType, contentId, taggedUserId: selected.id }).then((r) => {
      setSubmitting(false);
      if (r.ok) {
        onTagged();
        onClose();
      } else {
        setError(r.error.message ?? "Couldn't create the tag. Try again.");
      }
    });
  };
  return (
    <Sheet open={open} onClose={onClose} title="Tag a runner" subtitle="Connect a runner to this post — they can hide themselves anytime">
      <TagRunnerSheetBody
        query={query}
        onQueryChange={runSearch}
        results={results}
        loading={loading}
        selectedId={selectedId}
        onSelect={(p) => setSelectedId(p.id)}
        submitting={submitting}
        error={error}
        onSubmit={submit}
      />
    </Sheet>
  );
}
