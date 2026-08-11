import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
/**
 * Group management surface for Group Leads (owner or leader), City Admins of
 * the group's city, and the Global Admin. The server enforces every boundary;
 * this page renders only what `/api/me/leader/groups` says the actor may do:
 * the pending-request queue, own-group profile edits, and — owner/admin only —
 * leader assignment/removal and ownership transfer. Every mutation is
 * reason-required and audited server-side.
 *
 * Data safety: the profile form initializes from the loaded server row and
 * PATCHes only the fields the user actually changed, so a no-op or partial
 * save can never overwrite untouched values.
 */

/**
 * Effective membership mode for a group. Matches the server's runtime
 * semantics (`membershipMode === "open" ? active : pending`): seeded/legacy
 * groups without a stored mode behave as "request", so the form shows
 * "request" and a no-op save never flips them to a phantom "open" change.
 */
export function effectiveMembershipMode(row: { membershipMode?: "open" | "request" }): "open" | "request" {
  return row.membershipMode ?? "request";
}
/**
 * Build the PATCH payload from the current form state. Only fields that
 * differ from the loaded server row are included — untouched fields are
 * preserved because they are simply absent from the patch. Returns `{}` when
 * nothing changed (a no-op save, which the caller must not send).
 */
export function profilePatchFor(
  description: string,
  mode: "open" | "request",
  row: { description?: string; membershipMode?: "open" | "request" },
): api.GroupProfilePatch {
  const patch: api.GroupProfilePatch = {};
  if (description !== (row.description ?? "")) patch.description = description;
  if (mode !== effectiveMembershipMode(row)) patch.membershipMode = mode;
  return patch;
}
/** True when the profile form differs from the loaded server row. */
export function hasProfileChanges(
  description: string,
  mode: "open" | "request",
  row: { description?: string; membershipMode?: "open" | "request" },
): boolean {
  return Object.keys(profilePatchFor(description, mode, row)).length > 0;
}
/**
 * Presentational profile form (no hooks) — exported so UI tests can assert
 * that values initialize from the server row and that no-op saves are
 * blocked. `current` is the loaded server row the form was initialized from.
 */
export function GroupProfileForm({
  description,
  onDescriptionChange,
  mode,
  onModeChange,
  reason,
  onReasonChange,
  onSave,
  current,
}: {
  description: string;
  onDescriptionChange: (value: string) => void;
  mode: "open" | "request";
  onModeChange: (mode: "open" | "request") => void;
  reason: string;
  onReasonChange: (value: string) => void;
  onSave: () => void;
  current: { description?: string; membershipMode?: "open" | "request" };
}) {
  const dirty = hasProfileChanges(description, mode, current);
  return (
    <div>
      <label className="text-sm font-bold" htmlFor="gp-desc">Description</label>
      <textarea id="gp-desc" value={description} onChange={(e) => onDescriptionChange(e.target.value)} rows={4} className="mt-1 w-full rounded-xl border p-3 text-sm" placeholder="Describe the group…" />
      <label className="mt-3 block text-sm font-bold" htmlFor="gp-mode">Membership</label>
      <select id="gp-mode" value={mode} onChange={(e) => onModeChange(e.target.value as "open" | "request")} className="mt-1 w-full rounded-xl border p-3 text-sm">
        <option value="request">Request to join (leaders approve)</option>
        <option value="open">Open (verified runners join instantly)</option>
      </select>
      <label className="mt-3 block text-sm font-bold" htmlFor="gp-reason">Reason for change (audit log)</label>
      <input id="gp-reason" value={reason} onChange={(e) => onReasonChange(e.target.value)} className="mt-1 w-full rounded-xl border p-3 text-sm" placeholder="Why are you making this change?" />
      {!dirty && reason.trim().length > 0 && <p className="mt-2 text-xs text-slate-500">No profile changes to save — edit the description or membership mode first.</p>}
      <button className="mt-3 rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={!dirty} onClick={onSave}>Save profile</button>
    </div>
  );
}

export function GroupManagePage({ id }: { id: string }) {
  const [row, setRow] = useState<api.LedGroupRow | null | "loading">("loading");
  const [pending, setPending] = useState<api.PendingRequestRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [desc, setDesc] = useState("");
  const [mode, setMode] = useState<"open" | "request">("request");
  // Initialize the profile form from the server row exactly once per group;
  // later reloads (after approvals, saves) must not clobber in-progress edits.
  const initializedFor = useRef<string | null>(null);
  const load = useCallback(() => {
    setErr(null);
    void api.getMyLedGroups().then((r) => {
      if (!r.ok) { setRow(null); setErr(r.error.message); return; }
      const found = r.data.groups.find((g) => g.groupId === id);
      setRow(found ?? null);
      if (found) {
        if (initializedFor.current !== found.groupId) {
          setDesc(found.description ?? "");
          setMode(found.membershipMode ?? "request");
          initializedFor.current = found.groupId;
        }
        void api.getLeaderQueue().then((q) => {
          if (q.ok) setPending(q.data.pending.filter((p) => p.groupId === id));
        });
      }
    });
  }, [id]);
  useEffect(load, [load]);
  const act = (fn: Promise<api.ApiResult<unknown>>, success: string) => {
    setErr(null); setNotice(null);
    void fn.then((r) => { setNotice(r.ok ? success : null); if (!r.ok) setErr(r.error.message); load(); });
  };
  if (row === "loading") return <section className="mx-auto max-w-3xl px-4 py-8"><p>Loading…</p></section>;
  if (!row) return (
    <section className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-black">Group management</h1>
      <p className="mt-3 text-slate-600">You don't manage this group.{err ? ` ${err}` : ""} Management is limited to the group's owner, its listed leaders, the City Admin for the group's city, and the platform owner.</p>
      <Link className="mt-5 inline-block font-bold text-orange-700" to="/my-groups">Back to My groups</Link>
    </section>
  );
  const roleCopy =
    row.role === "owner" ? "the group owner"
      : row.role === "leader" ? "a group leader"
        : row.role === "city_admin" ? "the City Admin for this city"
          : "the platform owner";
  return (
    <section className="mx-auto max-w-3xl px-4 py-6">
      <p className="text-xs font-bold uppercase tracking-widest text-orange-700">Private · Leader tools</p>
      <h1 className="mt-2 text-3xl font-black">{row.groupName}</h1>
      <p className="mt-1 text-sm text-slate-600">You're listed as {roleCopy}. Every change is reason-required and audited.</p>
      {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {err && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}
      <h2 className="mt-8 text-lg font-black">Pending membership requests</h2>
      {pending.length === 0
        ? <p className="mt-2 rounded-2xl bg-white p-4 text-sm text-slate-600">No pending requests. New requests also arrive as notifications for leaders with community updates on.</p>
        : <div className="mt-3 grid gap-3">{pending.map((p) => (
            <div key={p.membershipId} className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm">
              <div><p className="font-bold">{p.name}{p.username ? ` @${p.username}` : ""}</p>
              <p className="text-xs text-slate-500">Requested {new Date(p.requestedAt).toLocaleDateString()}</p></div>
              <div className="flex gap-2">
                <button className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white" onClick={() => act(api.updateGroupMembership(row.groupId, "approve", p.accountId), "Request approved.")}>Approve</button>
                <button className="rounded-lg border px-3 py-2 text-sm font-bold" onClick={() => act(api.updateGroupMembership(row.groupId, "decline", p.accountId), "Request declined.")}>Decline</button>
              </div>
            </div>
          ))}</div>}
      <h2 className="mt-8 text-lg font-black">Group profile</h2>
      <div className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
        <GroupProfileForm
          description={desc}
          onDescriptionChange={setDesc}
          mode={mode}
          onModeChange={setMode}
          reason={reason}
          onReasonChange={setReason}
          current={row}
          onSave={() => {
            const patch = profilePatchFor(desc, mode, row);
            if (Object.keys(patch).length === 0) { setNotice("No changes to save."); return; }
            act(api.updateGroupProfile(row.groupId, patch, reason), "Profile updated.");
          }}
        />
      </div>
      <h2 className="mt-8 text-lg font-black">Leaders</h2>
      <ul className="mt-3 grid gap-2">{row.leaders.map((l) => (
        <li key={l.id} className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm">
          <span className="font-bold">{l.name}{l.id === row.ownerId ? <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">Owner</span> : ""}</span>
          {row.canManageLeaders && l.id !== row.ownerId && (
            <span className="flex gap-2">
              <button className="rounded-lg border px-3 py-1.5 text-sm font-bold" onClick={() => { const r = window.prompt(`Transfer ownership of ${row.groupName} to ${l.name}? Type a reason:`); if (r) act(api.transferGroupOwnership(row.groupId, l.id, r), "Ownership transferred."); }}>Transfer ownership</button>
              <button className="rounded-lg border px-3 py-1.5 text-sm font-bold text-red-700" onClick={() => { const r = window.prompt(`Remove ${l.name} as leader? Type a reason:`); if (r) act(api.removeGroupLeader(row.groupId, l.id, r), "Leader removed."); }}>Remove</button>
            </span>
          )}
        </li>
      ))}</ul>
      {row.canManageLeaders && (
        <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
          <label className="text-sm font-bold" htmlFor="add-email">Add a leader (verified runner in this city)</label>
          <input id="add-email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border p-3 text-sm" placeholder="runner@example.com" />
          <label className="mt-3 block text-sm font-bold" htmlFor="add-reason">Reason</label>
          <input id="add-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-xl border p-3 text-sm" placeholder="Why is this person a leader?" />
          <button className="mt-3 rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={!email || !reason} onClick={() => act(api.assignGroupLeader(row.groupId, email, reason), "Leader added.")}>Add leader</button>
        </div>
      )}
      <Link className="mt-8 inline-block text-sm font-bold text-orange-700" to={`/groups/${row.groupId}`}>View public group page</Link>
    </section>
  );
}
