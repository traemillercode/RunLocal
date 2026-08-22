import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { TrustedBadge } from "../components/TrustedBadge";
import { RunnerFeedbackSheet } from "../components/RunnerFeedbackSheet";
import { Chip, Icon } from "../components/ui";
import { ModerationConfirmSheet } from "../components/ModerationConfirmSheet";
import { VerifiedGateSheet } from "../components/VerifiedGateSheet";
import { TrustSummary } from "../components/TrustProfileSection";
import { useToast } from "../lib/toast";
import { useAccount } from "../state/account";
import type { AccountRole } from "../lib/accounts";
import {
  getRunnerProfile,
  type RecognitionView,
  type RunnerActivityRow,
  type RunnerProfileResponse,
  type RunnerProfileView,
  type RunnerTaggedRow,
} from "../lib/api";
import * as api from "../lib/api";
function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "R"
  );
}
/**
 * Identity card for ANOTHER runner (or a guest viewing anyone, including
 * themselves via /runners/:id). Deliberately public-safe: the server sends
 * only id/name/username/photo/city/badges — never email, phone, suspension,
 * rejection reasons, or under-review state.
 */
export function RunnerProfileHeader({ profile }: { profile: RunnerProfileView }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-[#14171C] text-white shadow-sm">
      <div className="flex items-center gap-4 p-5">
        {profile.profilePhotoUrl ? (
          <img
            src={profile.profilePhotoUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-white/20"
          />
        ) : (
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[10px] bg-[#FF5741] text-xl font-extrabold text-[#14171C]">
            {initials(profile.name)}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-lg font-bold leading-tight">{profile.name}</p>
          {profile.username ? (
            <p className="truncate text-[13px] font-semibold leading-tight text-[#FF5741]">@{profile.username}</p>
          ) : null}
          <p className="mt-0.5 text-[13px] text-white/70">
            {profile.cityName ? `Home: ${profile.cityName}` : "Home city: not set"}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {profile.isVerified ? <VerifiedBadge /> : null}
            {profile.isTrustedMember ? <TrustedBadge size="sm" /> : null}
            {profile.customTitle ? (
              <Chip tone="outline">
                <Icon name="flag" className="h-3 w-3" /> {profile.customTitle}
              </Chip>
            ) : profile.isLeader ? (
              <Chip tone="outline">
                <Icon name="flag" className="h-3 w-3" /> Group Leader
              </Chip>
            ) : null}
          </div>
          {profile.bio ? <p className="mt-2 text-[13px] leading-relaxed text-white/80">{profile.bio}</p> : null}
        </div>
      </div>
      {(profile.paceLabel || profile.runningGoal || profile.trainingBlock || profile.upcomingRaces) ? (
        <div className="mt-4 space-y-2 border-t border-white/10 pt-4 text-[13px]">
          {profile.paceLabel ? <p><span className="font-semibold text-white/60">Pace</span> · {profile.paceLabel}</p> : null}
          {profile.runningGoal ? <p><span className="font-semibold text-white/60">Goal</span> · {profile.runningGoal}</p> : null}
          {profile.trainingBlock ? <p><span className="font-semibold text-white/60">Training block</span> · {profile.trainingBlock}</p> : null}
          {profile.upcomingRaces ? <p><span className="font-semibold text-white/60">Upcoming races</span> · {profile.upcomingRaces}</p> : null}
        </div>
      ) : null}
      {(profile.instagramUrl || profile.facebookUrl || profile.tiktokUrl) ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
          {profile.instagramUrl ? (
            <a href={profile.instagramUrl} target="_blank" rel="noopener noreferrer" className="rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white active:bg-white/20">
              Instagram
            </a>
          ) : null}
          {profile.facebookUrl ? (
            <a href={profile.facebookUrl} target="_blank" rel="noopener noreferrer" className="rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white active:bg-white/20">
              Facebook
            </a>
          ) : null}
          {profile.tiktokUrl ? (
            <a href={profile.tiktokUrl} target="_blank" rel="noopener noreferrer" className="rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white active:bg-white/20">
              TikTok
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Connect / Requested / Accept Request / Connected affordance under the
 * identity card. Presentational (no hooks) so SSR tests render the real
 * markup per state.
 *
 * State comes ENTIRELY from the server's `connectionState` on the profile:
 *  - connected → emerald "Connected" (tap → remove-connection confirm);
 *  - requested_by_me → non-actionable ghost "Requested" + honest helper text
 *    (withdrawing is not offered here; the addressee decides with
 *    Accept/Decline and a cancelled request would only re-queue confusion);
 *  - requested_to_me → volt "Accept Request" (resolved from the inbox);
 *  - none → volt "Connect" (sends a request);
 *  - pending/rejected viewers → volt "Connect" that opens the
 *    VerifiedGateSheet on tap (same as RSVP);
 *  - guests → NO button at all.
 *
 * Mutual line: rendered ONLY when the server says the count is visible
 * (mutualVisible) AND it is > 0 — never "0 mutual connections".
 */
export function RunnerConnectBlock({
  profile,
  viewerRole,
  busy = false,
  onConnect,
  onAcceptRequest,
  onOpenGate,
  onOpenRemove,
  onMessage,
}: {
  profile: RunnerProfileView;
  viewerRole: AccountRole;
  busy?: boolean;
  onConnect: () => void;
  onAcceptRequest: () => void;
  onOpenGate: () => void;
  onOpenRemove: () => void;
  onMessage?: () => void;
}) {
  if (viewerRole === "guest") return null;
  const state = profile.connectionState ?? null;
  const mutualCount = profile.mutualVisible === true ? (profile.mutualConnectionsCount ?? 0) : 0;
  const base = "mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold";
  return (
    <div>
      {viewerRole === "verified" && state === "connected" ? (
        <div className="flex gap-2">
          <button type="button" onClick={onMessage} className={`${base} bg-[#14171C] text-white active:opacity-90`}>
            <Icon name="chat" className="h-4 w-4" /> Message
          </button>
          <button type="button" onClick={onOpenRemove} disabled={busy} className={`${base} bg-emerald-100 text-emerald-800 active:opacity-90`}>
            <Icon name="check" className="h-4 w-4" /> {busy ? "Removing…" : "Connected"}
          </button>
        </div>
      ) : viewerRole === "verified" && state === "requested_by_me" ? (
        <div>
          <button type="button" disabled aria-disabled="true" className={`${base} bg-transparent text-slate-700 ring-1 ring-slate-200`}>
            Requested
          </button>
          <p className="mt-1.5 text-center text-xs leading-relaxed text-slate-500">
            Request sent — waiting on their reply. You can ask again later if it lapses.
          </p>
        </div>
      ) : viewerRole === "verified" && state === "requested_to_me" ? (
        <button type="button" onClick={onAcceptRequest} disabled={busy} className={`${base} bg-[#FF5741] text-[#14171C] active:bg-[#e94735]`}>
          <Icon name="check" className="h-4 w-4" /> {busy ? "Accepting…" : "Accept Request"}
        </button>
      ) : (
        <button
          type="button"
          onClick={viewerRole === "verified" ? onConnect : onOpenGate}
          disabled={busy}
          className={`${base} bg-[#FF5741] text-[#14171C] active:bg-[#e94735]`}
        >
          <Icon name="userPlus" className="h-4 w-4" /> {busy ? "Sending…" : "Connect"}
        </button>
      )}
      {mutualCount > 0 ? (
        <p className="mt-2 text-center text-[13px] font-medium text-slate-500">
          {mutualCount} mutual connection{mutualCount === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}

/** Activity | Tagged tabs (ForumSectionTabs pattern) — presentational. */
export type RunnerProfileTab = "activity" | "tagged";
export function RunnerProfileTabs({ tab, onSelect }: { tab: RunnerProfileTab; onSelect: (t: RunnerProfileTab) => void }) {
  const tabs: { id: RunnerProfileTab; label: string }[] = [
    { id: "activity", label: "Activity" },
    { id: "tagged", label: "Tagged" },
  ];
  return (
    <div role="tablist" aria-label="Runner profile" className="mt-4 flex gap-1.5 rounded-2xl bg-slate-100 p-1.5">
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(t.id)}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold transition-colors ${
              active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 active:bg-white"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Activity panel — forum posts by this runner (server-gated by
 * show_past_activity; the server sends [] when nothing is visible). */
export function RunnerActivityPanel({ rows, loading = false }: { rows: RunnerActivityRow[] | null; loading?: boolean }) {
  return (
    <section aria-label="Recent forum activity" role="tabpanel" className="mt-3">
      {loading || rows === null ? (
        <p className="rounded-2xl bg-white p-5 text-center text-sm text-slate-500 ring-1 ring-slate-200/70">Loading activity…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200/70">
          <p className="text-sm font-semibold text-slate-700">No public activity yet</p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
            This runner hasn't posted anything publicly visible — or keeps their past activity private.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
          {rows.map((a) => (
            <li key={a.id} className="px-4 py-3.5">
              <p className="text-[14px] font-semibold text-slate-900">{a.title}</p>
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-slate-500">{a.excerpt}</p>
              <p className="mt-1 text-[11px] font-semibold text-slate-400">{a.createdAt}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Tagged panel — content this runner is tagged on (server-gated by
 * show_tagged_content; hidden-by-tagged-user rows drop except for the tagged
 * runner themself, so only the tagged user ever sees the self-hide toggle). */
export function RunnerTaggedPanel({
  rows,
  isOwn,
  busyTagId,
  onToggleHide,
}: {
  rows: RunnerTaggedRow[] | null;
  isOwn: boolean;
  busyTagId: string | null;
  onToggleHide: (row: RunnerTaggedRow) => void;
}) {
  return (
    <section aria-label="Tags on this runner" role="tabpanel" className="mt-3">
      {rows === null ? (
        <p className="rounded-2xl bg-white p-5 text-center text-sm text-slate-500 ring-1 ring-slate-200/70">Loading tags…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200/70">
          <p className="text-sm font-semibold text-slate-700">No tags yet</p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
            Runners can tag others on forum posts — tags on this runner will show up here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
          {rows.map((r) => (
            <li key={r.tag.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-slate-900">{r.content.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Chip tone="sky">
                    <Icon name="tag" className="h-3 w-3" /> {r.content.kind === "post" ? "Forum post" : "Event"}
                  </Chip>
                  {r.tag.hiddenByTaggedUser ? <Chip tone="outline">Hidden from this tag</Chip> : null}
                </span>
              </span>
              {isOwn ? (
                <button
                  type="button"
                  disabled={busyTagId === r.tag.id}
                  aria-pressed={!r.tag.hiddenByTaggedUser}
                  onClick={() => onToggleHide(r)}
                  className="min-h-11 shrink-0 rounded-[10px] px-3 text-xs font-bold text-slate-600 active:bg-slate-100 disabled:text-slate-300"
                >
                  {busyTagId === r.tag.id ? "Saving…" : r.tag.hiddenByTaggedUser ? "Show me again" : "Hide me from this tag"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
/**
 * Community standing for ANOTHER runner — qualitative only. Mirrors the
 * own-profile TrustSummary (tier chip + coach/host chips) plus the runner's
 * admin-granted recognitions with an honest empty state.
 */
export function RunnerProfileTrust({ trust }: { trust: RunnerProfileResponse["trust"] }) {
  const labels: Record<string, string> = { coach: "Recognized coach", host: "Recognized host" };
  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold text-slate-900">Community standing</h2>
      <div className="mt-2">
        <TrustSummary trust={trust} />
      </div>
      {trust.recognitions.length === 0 ? (
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-500">
          This runner hasn't been recognized yet. Recognitions are granted by verified community leadership — the
          qualitative tier above is separate from role recognitions.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {trust.recognitions.map((r, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <Chip tone={r.role === "coach" ? "sky" : "emerald"}>
                <Icon name={r.role === "coach" ? "flag" : "users"} className="h-3 w-3" /> {labels[r.role] ?? r.role}
              </Chip>
              <span className="text-[11px] text-slate-400">granted by verified leadership</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
/**
 * Recognized coaches & hosts in the runner's home city (non-ranked, from the
 * same public city list used everywhere). Links each entry to its profile.
 */
export function RunnerProfileCityRecognitions({
  cityName,
  recognitions,
}: {
  cityName: string | null;
  recognitions: RecognitionView[];
}) {
  if (!cityName || recognitions.length === 0) return null;
  const tierText: Record<string, string> = { new: "New", recognized: "Recognized", "well-regarded": "Well-regarded" };
  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold text-slate-900">Recognized in {cityName}</h2>
      <p className="mt-0.5 text-[11px] text-slate-400">Non-ranked, qualitative view — no scores, no rankings.</p>
      <ul className="mt-3 space-y-2">
        {recognitions.map((r) => (
          <li key={r.accountId}>
            <Link
              to={`/runners/${r.accountId}`}
              className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 hover:bg-slate-100"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-slate-800">{r.name}</span>
                {r.username ? <span className="block truncate text-[11px] text-slate-400">@{r.username}</span> : null}
              </span>
              <span className="flex shrink-0 flex-wrap justify-end gap-1">
                {r.roles.map((role) => (
                  <Chip key={role} tone={role === "coach" ? "sky" : "emerald"}>
                    <Icon name={role === "coach" ? "flag" : "users"} className="h-3 w-3" />{" "}
                    {role === "coach" ? "Coach" : "Host"}
                  </Chip>
                ))}
                <Chip tone={r.tier === "well-regarded" ? "brand" : r.tier === "recognized" ? "volt" : "outline"}>
                  {tierText[r.tier] ?? r.tier}
                </Chip>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
/** Honest 404 state — unknown, deleted, or suspended accounts are identical. */
export function RunnerProfileMissing() {
  return (
    <section className="mx-auto mt-8 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100">
        <Icon name="search" className="h-6 w-6 text-slate-400" />
      </span>
      <h1 className="mt-4 text-lg font-extrabold text-slate-900">Runner not found</h1>
      <p className="mt-1 text-sm leading-relaxed text-slate-500">
        This runner's profile isn't available — the account may have been removed or is no longer active.
      </p>
      <Link
        to="/"
        className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[#14171C] px-5 text-sm font-semibold text-white"
      >
        Back to Run Local
      </Link>
    </section>
  );
}
/** Loading skeleton while the public profile fetches. */
export function RunnerProfileLoading() {
  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading">
      <div className="h-6 w-32 animate-pulse rounded bg-slate-200" />
      <div className="mt-4 h-28 animate-pulse rounded-2xl bg-slate-200" />
      <div className="mt-4 h-24 animate-pulse rounded-2xl bg-slate-200" />
    </div>
  );
}
/**
 * Gate for the feedback affordance: VERIFIED signed-in viewers only, and never
 * on your own profile (self-rating is blocked server-side anyway). Extracted
 * for SSR unit tests.
 */
export function canViewerGiveFeedback(role: AccountRole, viewerId: string | null, profileId: string): boolean {
  return role === "verified" && viewerId !== null && viewerId !== profileId;
}

/** "Share feedback" affordance — hidden for guests and unverified viewers. */
export function RunnerShareFeedbackButton({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#14171C] text-sm font-semibold text-white active:opacity-90"
    >
      <Icon name="chat" className="h-4 w-4" /> Share feedback
    </button>
  );
}

/**
 * Public (other-user) runner profile page at /runners/:id. Guest-accessible:
 * no account or role gate — the server returns only public-safe fields and
 * 404s for unknown/deleted/suspended accounts. Verified signed-in viewers get
 * the Connect affordance (relationship state comes from the server) and the
 * "Share feedback" affordance (ratings & concerns keyed to shared runs).
 */
export function RunnerProfilePage({ id }: { id: string }) {
  const { me, role } = useAccount();
  const toast = useToast();
  const navigate = useNavigate();
  const startMessage = () => {
    void api.createDirectConversation(id).then((r) => {
      if (r.ok) navigate(`/messages/${r.data.conversation.id}`);
      else toast(r.error.message ?? "Couldn't start a conversation.", "info");
    });
  };
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [data, setData] = useState<RunnerProfileResponse | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Connect block state: relationship mutations (optimistic + revert), the
  // VerifiedGateSheet for pending/rejected viewers, and the remove-confirm.
  const [gateOpen, setGateOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [busyConnect, setBusyConnect] = useState(false);
  // Activity | Tagged tabs.
  const [tab, setTab] = useState<RunnerProfileTab>("activity");
  const [activity, setActivity] = useState<RunnerActivityRow[] | null>(null);
  const [tagged, setTagged] = useState<RunnerTaggedRow[] | null>(null);
  const [busyTagId, setBusyTagId] = useState<string | null>(null);
  const load = useCallback(() => {
    let live = true;
    setState("loading");
    setData(null);
    void getRunnerProfile(id).then((r) => {
      if (!live) return;
      if (r.ok) {
        setData(r.data);
        setState("ready");
      } else {
        setState("missing");
      }
    });
    return () => {
      live = false;
    };
  }, [id]);
  useEffect(() => load(), [load]);
  /** Quiet refresh after a successful submit — no loading flash; tier copy
   * updates when the server's rating threshold has been crossed. */
  const refresh = useCallback(() => {
    void getRunnerProfile(id).then((r) => {
      if (r.ok) setData(r.data);
    });
  }, [id]);
  const viewerId = me?.status === "signed_in" ? me.account.id : null;
  // Self-view via /runners/:id: no Connect affordance (you can't connect with
  // yourself; own privacy lives in Settings), but the Tagged tab still shows
  // self-hide toggles.
  const isSelf = viewerId !== null && viewerId === id;
  // Activity + Tagged fetch once the profile resolves. The SERVER gates both
  // (show_past_activity / show_tagged_content) and sends [] when nothing is
  // visible — the client never decides visibility.
  useEffect(() => {
    if (state !== "ready") return;
    let alive = true;
    void api.getRunnerActivity(id).then((r) => { if (alive) setActivity(r.ok ? r.data.activity : []); });
    void api.getRunnerTagged(id).then((r) => { if (alive) setTagged(r.ok ? r.data.tagged : []); });
    return () => { alive = false; };
  }, [state, id]);

  /** none → requestConnection; optimistic requested_by_me + revert on error. */
  const connectTo = () => {
    if (busyConnect || !data) return;
    const prev = data;
    setBusyConnect(true);
    setData((cur) => (cur ? { ...cur, profile: { ...cur.profile, connectionState: "requested_by_me" } } : cur));
    void api.requestConnection(data.profile.id).then((r) => {
      setBusyConnect(false);
      if (r.ok) {
        toast(`Request sent to ${data.profile.name}.`, "success");
      } else {
        setData(prev);
        toast(r.error.message ?? "Couldn't send the request. Try again.", "info");
      }
    });
  };

  /** requested_to_me → resolve the request id from the inbox (the profile DTO
   * has no requestId), then accept. Honest error when it's no longer waiting. */
  const acceptRequest = () => {
    if (busyConnect || !data) return;
    const prev = data;
    setBusyConnect(true);
    void api.getConnections().then((r) => {
      if (!r.ok) {
        setBusyConnect(false);
        toast("Couldn't load the request — try again.", "info");
        return;
      }
      const requestId = r.data.requests.find((x) => x.from.id === data.profile.id)?.requestId;
      if (!requestId) {
        setBusyConnect(false);
        refresh();
        toast("That request is no longer waiting.", "info");
        return;
      }
      setData((cur) => (cur ? { ...cur, profile: { ...cur.profile, connectionState: "connected" } } : cur));
      void api.acceptConnection(requestId).then((a) => {
        setBusyConnect(false);
        if (a.ok) {
          toast(`You and ${data.profile.name} are now connected.`, "success");
        } else {
          setData(prev);
          toast(a.error.message ?? "Couldn't accept the request. Try again.", "info");
        }
      });
    });
  };

  /** connected → ModerationConfirmSheet → removeConnection; optimistic "none"
   * with revert on error. */
  const runRemove = () => {
    if (removeBusy || !data) return;
    const prev = data;
    setRemoveBusy(true);
    setRemoveError(null);
    setData((cur) => (cur ? { ...cur, profile: { ...cur.profile, connectionState: "none" } } : cur));
    void api.removeConnection(data.profile.id).then((r) => {
      setRemoveBusy(false);
      if (r.ok) {
        setRemoveOpen(false);
        toast(`Removed ${data.profile.name} from your connections.`, "success");
      } else {
        setData(prev);
        setRemoveError(r.error.message ?? "Couldn't remove this connection. Try again.");
      }
    });
  };

  /** Tagged-row self-hide toggle — ONLY the tagged user sees it (server
   * includes hidden rows only for them); optimistic + revert. */
  const toggleTaggedHide = (row: RunnerTaggedRow) => {
    if (busyTagId) return;
    const prev = tagged;
    const hidden = !row.tag.hiddenByTaggedUser;
    setBusyTagId(row.tag.id);
    setTagged((cur) => cur?.map((r) => (r.tag.id === row.tag.id ? { ...r, tag: { ...r.tag, hiddenByTaggedUser: hidden } } : r)) ?? cur);
    void api.selfHideTag(row.tag.id, hidden).then((r) => {
      setBusyTagId(null);
      if (r.ok) {
        toast(hidden ? "You're hidden from this tag." : "You're visible on this tag again.", "success");
      } else {
        setTagged(prev);
        toast(r.error.message ?? "Couldn't update this tag.", "info");
      }
    });
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Runner profile</h1>
      <p className="mt-0.5 text-sm font-medium text-slate-500">Public community profile</p>
      {state === "loading" ? (
        <RunnerProfileLoading />
      ) : state === "missing" || !data ? (
        <RunnerProfileMissing />
      ) : (
        <>
          <div className="mt-4">
            <RunnerProfileHeader profile={data.profile} />
          </div>
          {!isSelf ? (
            <RunnerConnectBlock
              profile={data.profile}
              viewerRole={role}
              busy={busyConnect}
              onConnect={connectTo}
              onAcceptRequest={acceptRequest}
              onOpenGate={() => setGateOpen(true)}
              onOpenRemove={() => setRemoveOpen(true)}
              onMessage={startMessage}
            />
          ) : (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-slate-100 p-4">
              <p className="text-[13px] font-semibold text-slate-600">This is your own profile.</p>
              <Link to="/settings" className="shrink-0 text-[13px] font-bold text-[#14171C] underline underline-offset-2">
                Edit profile
              </Link>
            </div>
          )}
          <RunnerProfileTabs tab={tab} onSelect={setTab} />
          {tab === "activity" ? (
            <RunnerActivityPanel rows={activity} loading={activity === null} />
          ) : (
            <RunnerTaggedPanel rows={tagged} isOwn={isSelf} busyTagId={busyTagId} onToggleHide={toggleTaggedHide} />
          )}
          <RunnerProfileTrust trust={data.trust} />
          <RunnerProfileCityRecognitions cityName={data.profile.cityName} recognitions={data.recognitions} />
          <RunnerShareFeedbackButton
            visible={canViewerGiveFeedback(role, viewerId, id)}
            onClick={() => setFeedbackOpen(true)}
          />
          <RunnerFeedbackSheet
            open={feedbackOpen}
            onClose={() => setFeedbackOpen(false)}
            runnerId={id}
            runnerName={data.profile.name}
            onSubmitted={refresh}
          />
        </>
      )}
      {gateOpen ? (
        <VerifiedGateSheet
          open
          onClose={() => setGateOpen(false)}
          role={role}
          actionLabel="connecting with runners"
          pendingLabel="Your profile is still in review."
          rejectionReason={me?.status === "signed_in" ? me.account.rejectionReason ?? null : null}
        />
      ) : null}
      {removeOpen ? (
        <ModerationConfirmSheet
          open
          onClose={() => { if (!removeBusy) { setRemoveOpen(false); setRemoveError(null); } }}
          title="Remove this connection?"
          entity={data?.profile.name ?? ""}
          impact="You'll no longer see each other's shared content. You can send a new request later."
          confirmLabel="Remove connection"
          tone="neutral"
          busy={removeBusy}
          error={removeError}
          onConfirm={runRemove}
        />
      ) : null}
    </div>
  );
}
