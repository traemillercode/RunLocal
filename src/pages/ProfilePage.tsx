import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { TrustedBadge } from "../components/TrustedBadge";
import { ActionMenu } from "../components/ActionMenu";
import { ModerationConfirmSheet } from "../components/ModerationConfirmSheet";
import { Chip, Icon, PillButton, Sheet } from "../components/ui";
import type { City } from "../types";
import { resolveWeekEvents, submissionDateLabel } from "../lib/dates";
import { roleLabel } from "../lib/accounts";
import { actionMenuItems, type ActionKey } from "../lib/actionModel";
import { useToast } from "../lib/toast";
import * as api from "../lib/api";
import type { AppStore } from "../lib/store";
import { useAccount } from "../state/account";
import { useSelectedCity } from "../state/city";
import { VerifiedGateSheet } from "../components/VerifiedGateSheet";
import { LogRunSheet } from "../components/SubmissionSheets";
import { TrustProfileSection } from "../components/TrustProfileSection";
import {
  RunnerProfileTabs,
  RunnerActivityPanel,
  RunnerTaggedPanel,
  type RunnerProfileTab,
} from "./RunnerProfilePage";
import type { PublicActivityCard, RunnerActivityRow, RunnerTaggedRow } from "../lib/api";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "R";
}

const KIND_LABELS: Record<string, string> = { race: "Race", group: "Group", event: "Independent run" };
const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending approval", cls: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-700" },
  withdrawn: { label: "Withdrawn", cls: "bg-slate-100 text-slate-600" },
};

/**
 * One-line "Submitted Aug 4, 2025" style history label per status. Pending uses
 * submittedAt; decided statuses use the server's decidedAt. Empty when the
 * relevant timestamp is missing — dates only, never times.
 */
function submissionDateLine(r: api.MySubmissionView): string {
  const iso = r.status === "pending" ? r.submittedAt : r.decidedAt;
  const label = submissionDateLabel(iso);
  if (!label) return "";
  return r.status === "pending"
    ? `Submitted ${label}`
    : r.status === "approved"
      ? `Approved ${label}`
      : r.status === "rejected"
        ? `Rejected ${label}`
        : `Withdrawn ${label}`;
}

/**
 * "Edit pending submission" sheet — presentational, kind-conditional fields
 * prefilled from the submitter's own pending payload. Photos on group
 * submissions can't be replaced through this endpoint (server preserves the
 * existing refs). Save calls PATCH /api/my/submissions/:id which re-validates
 * every field with the same rules as the original submit.
 */
export function SubmissionEditSheet({
  open,
  kind,
  draft,
  busy = false,
  error = null,
  onDraftChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  kind: api.SubmissionKind;
  draft: Record<string, string>;
  busy?: boolean;
  error?: string | null;
  onDraftChange: (patch: Record<string, string>) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const inputCls = "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";
  const oneTime = draft.type !== "recurring";
  return (
    <Sheet open={open} onClose={onClose} title="Edit pending submission" subtitle="Changes go back into the review queue.">
      <div className="space-y-4">
        {kind === "race" ? (
          <>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Race name</span><input type="text" value={draft.name ?? ""} maxLength={120} onChange={(e) => onDraftChange({ name: e.target.value })} className={inputCls} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Distances</span><input type="text" value={draft.distances ?? ""} maxLength={80} onChange={(e) => onDraftChange({ distances: e.target.value })} className={inputCls} /></label>
              <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Date</span><input type="date" value={draft.date ?? ""} onChange={(e) => onDraftChange({ date: e.target.value })} className={inputCls} /></label>
            </div>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Location</span><input type="text" value={draft.location ?? ""} maxLength={160} onChange={(e) => onDraftChange({ location: e.target.value })} className={inputCls} /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Registration link</span><input type="url" value={draft.registrationUrl ?? ""} onChange={(e) => onDraftChange({ registrationUrl: e.target.value })} className={inputCls} /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Description <span className="font-normal text-slate-400">(optional)</span></span><textarea value={draft.description ?? ""} rows={3} maxLength={1000} onChange={(e) => onDraftChange({ description: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" /></label>
          </>
        ) : kind === "group" ? (
          <>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Group name</span><input type="text" value={draft.name ?? ""} maxLength={80} onChange={(e) => onDraftChange({ name: e.target.value })} className={inputCls} /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Description</span><textarea value={draft.description ?? ""} rows={3} maxLength={500} onChange={(e) => onDraftChange({ description: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Facebook</span><input type="url" value={draft.facebookUrl ?? ""} onChange={(e) => onDraftChange({ facebookUrl: e.target.value })} className={inputCls} /></label>
              <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Instagram</span><input type="url" value={draft.instagramUrl ?? ""} onChange={(e) => onDraftChange({ instagramUrl: e.target.value })} className={inputCls} /></label>
              <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Website</span><input type="url" value={draft.websiteUrl ?? ""} onChange={(e) => onDraftChange({ websiteUrl: e.target.value })} className={inputCls} /></label>
            </div>
            <p className="rounded-xl bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-500">Group photos can't be changed here — keep the submission pending and an admin can help with those.</p>
          </>
        ) : (
          <>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Run title</span><input type="text" value={draft.title ?? ""} maxLength={100} onChange={(e) => onDraftChange({ title: e.target.value })} className={inputCls} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Time</span><input type="text" value={draft.time ?? ""} maxLength={20} onChange={(e) => onDraftChange({ time: e.target.value })} className={inputCls} /></label>
              <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Distance</span><input type="text" value={draft.distanceLabel ?? ""} maxLength={80} onChange={(e) => onDraftChange({ distanceLabel: e.target.value })} className={inputCls} /></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Schedule</span>
                {oneTime ? (
                  <input type="date" value={draft.date ?? ""} onChange={(e) => onDraftChange({ date: e.target.value, type: "one_time" })} className={inputCls} />
                ) : (
                  <select value={draft.dayOfWeek ?? "0"} onChange={(e) => onDraftChange({ dayOfWeek: e.target.value, type: "recurring" })} className={inputCls}>
                    {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                )}
              </label>
              <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Who can join?</span><select value={draft.invite ?? "Open to all"} onChange={(e) => onDraftChange({ invite: e.target.value })} className={inputCls}>{["Open to all", "Members + guests", "RSVP requested"].map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
            </div>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Location</span><input type="text" value={draft.location ?? ""} maxLength={160} onChange={(e) => onDraftChange({ location: e.target.value })} className={inputCls} /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Details link <span className="font-normal text-slate-400">(optional)</span></span><input type="url" value={draft.externalUrl ?? ""} onChange={(e) => onDraftChange({ externalUrl: e.target.value })} className={inputCls} /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Description <span className="font-normal text-slate-400">(optional)</span></span><textarea value={draft.description ?? ""} rows={3} maxLength={1000} onChange={(e) => onDraftChange({ description: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" /></label>
          </>
        )}
        {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-[13px] font-semibold text-rose-800">{error}</p> : null}
        <div className="flex gap-3">
          <PillButton variant="ghost" className="flex-1" onClick={onClose} disabled={busy}>Cancel</PillButton>
          <PillButton variant="primary" className="flex-1" disabled={busy} onClick={onSubmit}>{busy ? "Saving…" : "Save changes"}</PillButton>
        </div>
        <p className="text-center text-xs text-slate-400">Once reviewed, submissions are history-only — edits then require an admin.</p>
      </div>
    </Sheet>
  );
}

/**
 * The signed-in user's OWN submission rows — presentational (no data hooks) so
 * SSR tests can render the real markup: pending rows get the Withdraw action
 * menu (capability `withdraw`), decided rows render no trigger, and withdrawn
 * rows show the neutral "Withdrawn" chip.
 */
export function MySubmissionsContent({
  rows,
  onAction,
  onWithdraw,
}: {
  rows: api.MySubmissionView[];
  /** Menu dispatcher — the parent maps edit_pending to the edit sheet and withdraw to the confirm. */
  onAction?: (row: api.MySubmissionView, key: ActionKey) => void;
  /** Deprecated legacy prop — treats every action as a withdraw (older callers). */
  onWithdraw?: (id: string, title: string) => void;
}) {
  return (
    <ul className="mt-3 space-y-2.5">
      {rows.map((r) => {
        const st = STATUS_LABELS[r.status] ?? STATUS_LABELS.pending;
        const items = actionMenuItems(r.capabilities);
        const dateLine = submissionDateLine(r);
        return (
          <li key={r.id} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-slate-800">{r.title}</p>
                <p className="text-xs text-slate-500">{KIND_LABELS[r.kind] ?? r.kind}</p>
                {dateLine ? <p className="text-[11px] text-slate-400">{dateLine}</p> : null}
              </div>
              <span className="flex shrink-0 items-center gap-1.5">
                {items.length > 0 && (onAction || onWithdraw) ? (
                  <ActionMenu entityTitle={`${r.title} submission`} items={items} onSelect={(key) => (onAction ? onAction(r, key) : onWithdraw?.(r.id, r.title))} />
                ) : null}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${st.cls}`}>{st.label}</span>
              </span>
            </div>
            {r.status === "rejected" && r.rejectionReason ? (
              <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[12px] leading-relaxed text-red-700">
                <span className="font-semibold">Why it was rejected:</span> {r.rejectionReason}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The signed-in user's OWN submissions (server returns this account's records only). */
export function MySubmissions({ signedIn }: { signedIn: boolean }) {
  const [rows, setRows] = useState<api.MySubmissionView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<{ id: string; title: string } | null>(null);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<api.MySubmissionView | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const toast = useToast();
  const openRowAction = (row: api.MySubmissionView, key: ActionKey) => {
    if (key === "edit_pending") {
      const p = (row.payload ?? {}) as Record<string, unknown>;
      const draft: Record<string, string> = {};
      for (const [k, v] of Object.entries(p)) {
        if (typeof v === "string" || typeof v === "number") draft[k] = String(v);
      }
      setEditDraft(draft);
      setEditRow(row);
      setEditError(null);
      return;
    }
    if (key === "withdraw") setWithdrawTarget({ id: row.id, title: row.title });
    setWithdrawError(null);
  };
  const savePendingEdit = () => {
    if (!editRow || editBusy) return;
    const row = editRow;
    setEditBusy(true);
    setEditError(null);
    void api.updatePendingSubmission(row.id, editDraft).then((r) => {
      setEditBusy(false);
      if (r.ok) {
        setEditRow(null);
        load();
        toast?.("Submission updated — it's back in the review queue.", "success");
      } else {
        setEditError(r.error.message ?? "Couldn't save — try again.");
      }
    });
  };
  const load = () => {
    setLoading(true); setError(null);
    void api.getMySubmissions().then((r) => {
      if (r.ok) setRows(r.data.submissions);
      else setError(r.error.message);
    }).catch(() => setError("Could not load submission status.")).finally(() => setLoading(false));
  };
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    setLoading(true); setError(null);
    void api.getMySubmissions().then((r) => {
      if (!alive) return;
      if (r.ok) setRows(r.data.submissions);
      else setError(r.error.message);
    }).catch(() => { if (alive) setError("Could not load submission status."); }).finally(() => { if (alive) setLoading(false); });
    return () => {
      alive = false;
    };
  }, [signedIn]);
  const confirmWithdraw = () => {
    if (!withdrawTarget || withdrawBusy) return;
    const target = withdrawTarget;
    setWithdrawBusy(true);
    setWithdrawError(null);
    void api.withdrawSubmission(target.id).then((r) => {
      setWithdrawBusy(false);
      if (r.ok) {
        setWithdrawTarget(null);
        // The server returns the row as withdrawn with no further actions;
        // reflect both locally so the chip flips and the menu disappears.
        setRows((cur) => (cur ? cur.map((x) => (x.id === target.id ? { ...x, status: "withdrawn", capabilities: [] } : x)) : cur));
      } else {
        setWithdrawError(r.error.message ?? "Couldn't withdraw — try again.");
      }
    });
  };
  if (!signedIn) return null;
  const pendingCount = rows ? rows.filter((r) => r.status === "pending").length : 0;
  return (
    <section id="my-submissions" data-tour-target="profile-submissions" className="mt-4 scroll-mt-20 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold text-slate-900" tabIndex={-1}>My submissions</h2>
        {!loading && rows && rows.length > 0 ? (
          pendingCount > 0 ? (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">{pendingCount} pending</span>
          ) : (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{rows.length}</span>
          )
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-slate-500">Your race, group, and independent-run submissions — only you can see these.</p>
      {loading ? (
        <p className="mt-3 text-[13px] text-slate-400">Loading…</p>
      ) : error ? (
        <div className="mt-3 rounded-xl bg-red-50 p-3 text-[13px] text-red-700"><p>{error}</p><button type="button" className="mt-2 font-semibold underline" onClick={load}>Retry</button></div>
      ) : !rows || rows.length === 0 ? (
        <div className="mt-3">
          <p className="text-[13px] leading-relaxed text-slate-500">
            Nothing submitted yet. Races, groups, and independent runs you submit for review will show up here.
          </p>
          <div className="mt-3 space-y-2">
            <Link to="/races" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#FF5741] text-sm font-semibold text-[#14171C] active:bg-[#e94735]">
              <Icon name="plus" className="h-4 w-4" /> Submit a race
            </Link>
            <Link to="/" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-white text-sm font-semibold text-slate-700 ring-1 ring-slate-200 active:bg-slate-100">
              <Icon name="plus" className="h-4 w-4" /> Host a run or start a group
            </Link>
          </div>
        </div>
      ) : (
        <MySubmissionsContent rows={rows} onAction={openRowAction} />
      )}
      <ModerationConfirmSheet
        open={withdrawTarget !== null}
        onClose={() => !withdrawBusy && setWithdrawTarget(null)}
        title="Withdraw this submission?"
        entity={withdrawTarget?.title ?? ""}
        impact="It will leave the review queue. You can submit it again later."
        confirmLabel="Withdraw"
        busy={withdrawBusy}
        error={withdrawError}
        onConfirm={() => confirmWithdraw()}
      />
      <SubmissionEditSheet
        open={editRow !== null}
        kind={editRow?.kind ?? "race"}
        draft={editDraft}
        busy={editBusy}
        error={editError}
        onDraftChange={(patch) => setEditDraft((cur) => ({ ...cur, ...patch }))}
        onClose={() => { if (!editBusy) { setEditRow(null); setEditError(null); } }}
        onSubmit={savePendingEdit}
      />
    </section>
  );
}

/**
 * Presentational body of the Profile "Groups & clubs" entry — exported so
 * SSR/no-jsdom tests can assert the directory + My Groups rows and the
 * pending badge without the fetch effects (which never run in SSR).
 */
export function ProfileGroupsCardContent({
  membershipCount,
  pendingRequests,
  loading,
}: {
  membershipCount: number | null;
  pendingRequests: number;
  loading: boolean;
}) {
  const pending = Math.max(0, pendingRequests);
  return (
    <section
      className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70"
      data-tour-target="profile-my-groups"
    >
      <h2 className="text-[15px] font-bold text-slate-900">Groups &amp; clubs</h2>
      <p className="mt-0.5 text-xs text-slate-500">Find local running communities and manage your memberships.</p>
      <ul className="mt-3 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
        <li>
          <Link to="/groups" className="flex min-h-12 items-center gap-3 px-4 py-3 active:bg-slate-50">
            <Icon name="users" className="h-5 w-5 shrink-0 text-[#FF5741]" />
            <span className="flex-1 text-[14px] font-semibold text-slate-800">Browse the public directory</span>
            <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-slate-400" />
          </Link>
        </li>
        <li>
          <Link to="/my-groups" className="flex min-h-12 items-center gap-3 px-4 py-3 active:bg-slate-50">
            <Icon name="rsvp" className="h-5 w-5 shrink-0 text-[#FF5741]" />
            <span className="flex-1 text-[14px] font-semibold text-slate-800">My Groups</span>
            {loading ? (
              <span className="text-xs font-semibold text-slate-400">…</span>
            ) : (
              <span className="flex items-center gap-1.5">
                {membershipCount != null && membershipCount > 0 ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                    {membershipCount} {membershipCount === 1 ? "membership" : "memberships"}
                  </span>
                ) : null}
                {pending > 0 ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                    {pending} pending
                  </span>
                ) : null}
              </span>
            )}
            <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-slate-400" />
          </Link>
        </li>
      </ul>
    </section>
  );
}

/**
 * Signed-in-only wrapper that fetches this account's memberships and the
 * pending-request counts of groups it leads, then renders the entry card.
 */
export function ProfileGroupsCard({ signedIn }: { signedIn: boolean }) {
  const [membershipCount, setMembershipCount] = useState<number | null>(null);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    void api.getMyGroups().then((r) => {
      if (!alive) return;
      if (r.ok) {
        setMembershipCount(r.data.memberships.filter((m) => m.status === "active" || m.status === "pending").length);
      }
      if (!r.ok) setMembershipCount(0);
    });
    void api.getMyLedGroups().then((r) => {
      if (!alive) return;
      if (r.ok) setPendingRequests(r.data.groups.reduce((n, g) => n + (g.pendingCount ?? 0), 0));
    });
    setLoading(false);
    return () => {
      alive = false;
    };
  }, [signedIn]);
  return <ProfileGroupsCardContent membershipCount={membershipCount} pendingRequests={pendingRequests} loading={loading} />;
}

/**
 * /profile — the signed-in runner's OWN public-profile experience (not a
 * settings dashboard). Identity header, Activity + Tagged content (same
 * server-gated surfaces as /runners/:id, fetched for the viewer's own id),
 * Groups/clubs, submissions and trust — plus a "View public profile" link to
 * /runners/:id. ALL settings forms (username, photo, notifications, privacy,
 * account, home city) live on SettingsPage; /profile never renders them.
 */
export function ProfilePage({ city, store }: { city: City; store: AppStore }) {
  const { me, role, backendAvailable } = useAccount();
  const { hasHomeCity } = useSelectedCity();
  const [tab, setTab] = useState<RunnerProfileTab>("activity");
  const [activity, setActivity] = useState<RunnerActivityRow[] | null>(null);
  const [cards, setCards] = useState<PublicActivityCard[] | null>(null);
  const [tagged, setTagged] = useState<RunnerTaggedRow[] | null>(null);
  // Log-a-run composition (verified only) + its gate for unverified profiles.
  const [logRunOpen, setLogRunOpen] = useState(false);
  const [logGateOpen, setLogGateOpen] = useState(false);

  const rsvps = useMemo(() => {
    const all = resolveWeekEvents(city.events, new Date());
    return all.filter((e) => store.state.rsvped[e.id]);
  }, [city.events, store.state.rsvped]);

  const signedIn = me?.status === "signed_in" ? me.account : null;
  const name = signedIn?.name ?? "Guest runner";
  const photo = signedIn?.profilePhotoUrl ?? null;
  const verified = signedIn?.status === "verified";
  const accountId = signedIn?.id ?? null;

  // Own-profile Activity | Tagged — the same server-gated public-profile
  // endpoints /runners/:id uses, called with the viewer's own id.
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    void api.getRunnerActivity(accountId).then((r) => { if (alive) { setActivity(r.ok ? r.data.activity : []); setCards(r.ok ? r.data.activityCards : []); } });
    void api.getRunnerTagged(accountId).then((r) => { if (alive) setTagged(r.ok ? r.data.tagged : []); });
    return () => { alive = false; };
  }, [accountId]);

  // Deep link from the account menu ("My submissions") and the submission
  // success panel: /profile?section=submissions scrolls to the section. Keyed
  // on the search string (not just mount) because App.tsx remounts <main> only
  // on pathname change — this also covers tapping the menu while already on
  // /profile. The section renders synchronously, so one rAF defer is enough.
  const location = useLocation();
  useEffect(() => {
    if (new URLSearchParams(location.search).get("section") !== "submissions") return;
    requestAnimationFrame(() => {
      const el = document.getElementById("my-submissions");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      // Land screen-reader users on the section heading (tabIndex -1 above).
      el?.querySelector("h2")?.focus({ preventScroll: true });
    });
  }, [location.search]);

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading-narrow">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Profile</h1>
      <p className="mt-0.5 text-sm font-medium text-slate-500">Your public profile</p>

      {!backendAvailable ? (
        <section className="mt-4 rounded-2xl bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <span className="font-semibold">Server API unreachable.</span> Identity & verification are unavailable right
          now — you're browsing as a guest and nothing can be verified or saved to your account.
        </section>
      ) : null}

      {/* Identity card */}
      <section className="mt-4 overflow-hidden rounded-2xl bg-[#14171C] text-white shadow-sm" data-tour-target="profile-header">
        <div className="flex items-center gap-4 p-5">
          {photo ? (
            <img src={photo} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-white/20" />
          ) : (
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[10px] bg-[#FF5741] text-xl font-extrabold text-[#14171C]">
              {initials(name)}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-lg font-bold leading-tight">{name}</p>
            {signedIn?.username ? (
              <p className="truncate text-[13px] font-semibold leading-tight text-[#FF5741]">@{signedIn.username}</p>
            ) : null}
            <p className="mt-0.5 text-[13px] text-white/70">
              {signedIn ? (hasHomeCity ? `Home: ${city.name}, ${city.state}` : "Home city: not set") : `${city.name}, ${city.state}`}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {verified ? (
                <VerifiedBadge />
              ) : signedIn && signedIn.status === "rejected" ? (
                <Chip tone="red">
                  <Icon name="close" className="h-3 w-3" /> Denied
                </Chip>
              ) : signedIn ? (
                <Chip tone="amber">
                  <Icon name="clock" className="h-3 w-3" /> Pending verification
                </Chip>
              ) : (
                <Chip tone="outline">
                  <Icon name="users" className="h-3 w-3" /> Guest
                </Chip>
              )}
              {signedIn?.trustedMember ? <TrustedBadge size="sm" /> : null}
              {signedIn && signedIn.role === "group_leader" ? (
                <Chip tone="outline">
                  <Icon name="flag" className="h-3 w-3" /> {roleLabel(signedIn.role)}
                </Chip>
              ) : null}
              {signedIn?.isOwner ? (
                <Chip tone="brand">
                  <Icon name="lock" className="h-3 w-3" /> Super Admin
                </Chip>
              ) : null}
            </div>
          </div>
        </div>
        {signedIn && !verified ? (
          <div className={`border-t px-5 py-3 ${signedIn.status === "rejected" ? "border-white/10 bg-red-500/10" : "border-white/10 bg-white/5"}`}>
            <p className={`flex items-start gap-2 text-[12px] leading-relaxed ${signedIn.status === "rejected" ? "text-red-200" : "text-white/70"}`}>
              <Icon name={signedIn.status === "rejected" ? "close" : "lock"} className="mt-0.5 h-4 w-4 shrink-0 text-[#FF5741]" />
              {signedIn.status === "rejected" ? (
                <span>
                  <span className="font-semibold">Verification denied.</span> Your profile is read-only — no RSVPs,
                  posts, or submissions.
                  {signedIn.rejectionReason ? (
                    <span className="mt-1 block"><span className="font-semibold">Why:</span> {signedIn.rejectionReason}</span>
                  ) : null}
                </span>
              ) : (
                <span>
                  Pending Verification profiles are read-only: no RSVPs, posts, or submissions until your identity is
                  approved. Only a Verified badge is ever shown publicly.
                </span>
              )}
            </p>
          </div>
        ) : null}
      </section>

      {/* Guest CTA */}
      {!signedIn ? (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <h2 className="text-[15px] font-bold text-slate-900">Create your runner profile</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
            Verified runners get RSVPs, a public profile, and posting access. Sign up with your email and password,
            confirm your email, then complete a live selfie — reviewed by a person, never shown publicly.
          </p>
          <Link
            to="/login?mode=signup"
            className="mt-3.5 flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#FF5741] text-sm font-semibold text-[#14171C] active:bg-[#e94735]"
          >
            <Icon name="shield" className="h-4 w-4" /> Create account
          </Link>
        </section>
      ) : (
        /* View public profile — the public /runners/:id view of this account */
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <h2 className="text-[15px] font-bold text-slate-900">Public profile</h2>
          <p className="mt-1 text-[13px] text-slate-600">See your profile the way other runners see it — activity, tags, and community standing.</p>
          <Link
            to={`/runners/${encodeURIComponent(signedIn.id)}`}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#14171C] text-sm font-semibold text-white active:bg-[#252a31]"
          >
            View public profile
          </Link>
        </section>
      )}

      {/* Activity + Tagged — own public-profile content (server-gated) */}
      {signedIn ? (
        <>
          <RunnerProfileTabs tab={tab} onSelect={setTab} />
          {tab === "activity" ? (
            <RunnerActivityPanel
              rows={activity}
              cards={cards}
              loading={activity === null}
              ownView
              onLogRun={() => (verified ? setLogRunOpen(true) : setLogGateOpen(true))}
            />
          ) : (
            <RunnerTaggedPanel rows={tagged} isOwn busyTagId={null} onToggleHide={() => {}} />
          )}
        </>
      ) : null}

      {logRunOpen ? (
        <LogRunSheet
          open
          onClose={() => setLogRunOpen(false)}
          onLogged={() => {
            void api.getRunnerActivity(signedIn!.id).then((r) => { if (r.ok) { setActivity(r.data.activity); setCards(r.data.activityCards); } });
          }}
        />
      ) : null}
      {logGateOpen ? (
        <VerifiedGateSheet
          open
          onClose={() => setLogGateOpen(false)}
          role={role}
          actionLabel="logging runs"
          pendingLabel="Your profile is still in review."
          rejectionReason={me?.status === "signed_in" ? me.account.rejectionReason ?? null : null}
        />
      ) : null}

      {/* Groups & clubs — directory entry + My Groups with pending counts */}
      {signedIn ? <ProfileGroupsCard signedIn={!!signedIn} /> : null}
      {/* My submissions — this account's own submissions only */}
      <MySubmissions signedIn={!!signedIn} />

      {/* Community trust & credentials — own records, qualitative view only */}
      {signedIn ? (
        <TrustProfileSection
          me={{ id: signedIn.id, name: signedIn.name, email: signedIn.email, underReview: signedIn.underReview === true }}
        />
      ) : null}

      {/* Verified content */}
      {signedIn && verified ? (
        <section className="mt-4 space-y-3">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
            <h2 className="text-[15px] font-bold text-slate-900">Upcoming RSVPs</h2>
            {rsvps.length === 0 ? (
              <p className="mt-2 text-[13px] text-slate-500">
                No RSVPs yet. Tap <span className="font-semibold">RSVP</span> on a group run to see it here.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {rsvps.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-3.5 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-slate-800">{e.title}</span>
                      <span className="block text-xs text-slate-500">{e.location}</span>
                    </span>
                    <Chip tone="emerald">RSVP'd</Chip>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2.5 text-[11px] text-slate-400">RSVPs are saved to your account — your full private list lives in My Runs.</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
            <h2 className="text-[15px] font-bold text-slate-900">My groups</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-600">Only groups you've actually joined or requested to join appear here.</p>
            <Link
              to="/my-groups"
              className="mt-3.5 flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#FF5741] text-sm font-semibold text-[#14171C] active:bg-[#e94735]"
            >
              <Icon name="chevronRight" className="h-4 w-4 rotate-180" /> View my groups
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
