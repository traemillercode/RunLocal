/**
 * Admin-only safety tool.
 *
 * Access model: a single admin key (RUN_LOCAL_ADMIN_KEY) unlocks a
 * server-issued HttpOnly session. Every lookup/export/action requires an
 * explicit reason, and every access is written to the audit log
 * (admin/timestamp/reason/action). Group Leaders and Verified Runners have
 * no route to this page and no API access.
 *
 * Explicit states: not-configured, unauthorized, reason-required, backend
 * unreachable. Nothing here is fake — if the backend is missing the UI says so.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, PillButton } from "../components/ui";
import * as api from "../lib/api";
import type { AdminRecordView, AdminSearchRow, AuditEntryView, PendingQueueRow } from "../lib/api";
import { useAccount } from "../state/account";

const inputCls =
  "h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0b2b22] focus:ring-2 focus:ring-[#c8f169]/60";

const reasonCls =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[14px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0b2b22] focus:ring-2 focus:ring-[#c8f169]/60";

function Err({ msg }: { msg: string }) {
  return <p className="flex items-start gap-2 rounded-xl bg-red-50 p-3.5 text-[13px] leading-relaxed text-red-800">{msg}</p>;
}

function Info({ msg }: { msg: string }) {
  return <p className="flex items-start gap-2 rounded-xl bg-sky-50 p-3.5 text-[13px] leading-relaxed text-sky-900">{msg}</p>;
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function maskIp(ip: string | null): string {
  return ip ?? "—";
}

export function AdminPage() {
  const navigate = useNavigate();
  const { me } = useAccount();
  // The owner/super-admin (server-derived isOwner flag from /api/me) gets the
  // control center through their normal signed-in session — no key needed.
  // Everyone else sees the key-based safety tool login exactly as before.
  const isOwner = me?.status === "signed_in" && me.account.isOwner === true;
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<api.HealthInfo | null>(null);
  const [backendDown, setBackendDown] = useState(false);

  // auth
  const [authed, setAuthed] = useState<boolean | null>(null); // null = unknown
  const [adminName, setAdminName] = useState("");
  const [key, setKey] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // search
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [results, setResults] = useState<AdminSearchRow[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // pending queue (owner-only)
  const [pending, setPending] = useState<PendingQueueRow[] | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [roleSel, setRoleSel] = useState<Record<string, "runner" | "group_leader">>({});

  // detail
  const [record, setRecord] = useState<AdminRecordView | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // audit
  const [audit, setAudit] = useState<AuditEntryView[] | null>(null);

  // purge
  const [purgeResult, setPurgeResult] = useState<string | null>(null);

  const selfieCheckRef = useRef(false);

  const showAuthError = useCallback((code: string, message?: string) => {
    if (code === "unauthorized") setAuthError("You don't have admin access on this server.");
    else if (code === "reason_required") setAuthError("A reason (at least 5 characters) is required for every admin action.");
    else if (code === "admin_unconfigured") setAuthError("Admin access is not configured on this server (RUN_LOCAL_ADMIN_KEY is not set).");
    else setAuthError(message ?? "Request failed.");
  }, []);

  // Initial load: health + (owner auto-auth | admin-session probe).
  useEffect(() => {
    let alive = true;
    void api.getHealth().then((r) => {
      if (!alive) return;
      setLoading(false);
      if (r.ok) {
        setHealth(r.data);
        setBackendDown(false);
        if (isOwner) {
          // Owner/super-admin: authorized via the signed-in user session.
          setAuthed(true);
          setAdminName(me?.status === "signed_in" ? me.account.name : "Super Admin");
          return;
        }
        // Probe admin session with a benign action that audits nothing? Use audit list with a generic reason.
        void api.adminAudit(1, "Session check").then((probe) => {
          if (probe.ok) {
            setAuthed(true);
            setAdminName("admin");
          } else if (probe.error.status === 401) {
            setAuthed(false);
          } else if (probe.error.status === 503) {
            setAuthed(false);
          }
        });
      } else {
        setBackendDown(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [isOwner, me]);

  const doLogin = async () => {
    setBusy(true);
    setAuthError(null);
    const r = await api.adminLogin(key.trim());
    setBusy(false);
    if (r.ok) {
      setAuthed(true);
      setAdminName(r.data.admin);
      setKey("");
    } else {
      showAuthError(r.error.code, r.error.message);
    }
  };

  const doLogout = async () => {
    await api.adminLogout();
    setAuthed(false);
    setResults(null);
    setRecord(null);
    setAudit(null);
    setPurgeResult(null);
    setPending(null);
  };

  // ---- owner-only pending queue -----------------------------------------
  const loadQueue = async () => {
    setQueueError(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setQueueError("Enter a reason (min 5 characters) to load the pending queue.");
      return;
    }
    const r = await api.adminPending(reason.trim());
    if (r.ok) {
      setPending(r.data.results);
      setQueueError(null);
    } else {
      setQueueError(
        r.error.status === 401
          ? "Only the owner/super-admin can view the pending queue."
          : r.error.code === "reason_required"
            ? "A reason is required to load the queue."
            : r.error.message ?? "Could not load the queue.",
      );
    }
  };

  const approvePending = async (row: PendingQueueRow) => {
    setQueueError(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setQueueError("Enter a reason (min 5 characters) for this approval.");
      return;
    }
    // Honesty gate, mirrored server-side: no approval without a submitted
    // selfie in review (phase pending_review).
    if (row.phase !== "pending_review") {
      setQueueError("This user hasn't completed email + selfie verification yet — approval isn't allowed before the pending_review state.");
      return;
    }
    const role = roleSel[row.id] ?? row.requestedRole ?? "runner";
    const roleName = role === "group_leader" ? "Group Leader" : "Verified Runner";
    if (!window.confirm(`Approve ${row.name} as ${roleName}? This is audited.`)) return;
    const r = await api.adminSetStatus(row.id, "approve", reason.trim(), role);
    if (r.ok) {
      setQueueError(null);
      void loadQueue();
    } else if (r.error.code === "verification_incomplete") {
      setQueueError("Approval blocked: the required verification state (email + selfie, pending_review) isn't complete.");
    } else {
      setQueueError(r.error.status === 401 ? "Your admin session expired — sign in again." : r.error.message ?? "Approval failed.");
    }
  };

  const rejectPending = async (row: PendingQueueRow) => {
    setQueueError(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setQueueError("Enter a reason (min 5 characters) for this rejection.");
      return;
    }
    if (!window.confirm(`Reject ${row.name}'s pending verification? This is audited.`)) return;
    const r = await api.adminSetStatus(row.id, "reject", reason.trim());
    if (r.ok) {
      setQueueError(null);
      void loadQueue();
    } else {
      setQueueError(r.error.status === 401 ? "Your admin session expired — sign in again." : r.error.message ?? "Rejection failed.");
    }
  };

  const doSearch = async () => {
    setSearchError(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setSearchError("A reason is required before searching (min 5 characters).");
      return;
    }
    const r = await api.adminSearch(query, reason.trim());
    if (r.ok) {
      setResults(r.data.results);
      setRecord(null);
      setAudit(null);
    } else {
      setSearchError(
        r.error.status === 401
          ? "Your admin session expired — sign in again."
          : r.error.code === "reason_required"
            ? "A reason is required for every search."
            : r.error.message ?? "Search failed.",
      );
    }
  };

  const openRecord = async (id: string) => {
    setDetailError(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setDetailError("Enter a reason (min 5 characters) to view this record.");
      return;
    }
    const r = await api.adminGetRecord(id, reason.trim());
    if (r.ok) {
      setRecord(r.data.record);
      selfieCheckRef.current = false;
    } else {
      setDetailError(r.error.status === 401 ? "Your admin session expired — sign in again." : r.error.message ?? "Could not load the record.");
    }
  };

  const doAction = async (action: "approve" | "reject" | "delete") => {
    if (!record) return;
    setDetailError(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setDetailError("Enter a reason (min 5 characters) for this action.");
      return;
    }
    if (action === "delete" && !window.confirm("Delete this account permanently (scrubs phone, selfie, photo, IP history)? This is audited.")) return;
    const r = action === "delete" ? await api.adminDeleteRecord(record.id, reason.trim()) : await api.adminSetStatus(record.id, action, reason.trim());
    if (r.ok) {
      setRecord(null);
      setResults(null);
      setDetailError(null);
      void doSearch();
    } else {
      setDetailError(r.error.status === 401 ? "Admin session expired — sign in again." : r.error.message ?? "Action failed.");
    }
  };

  const doExport = async () => {
    setDetailError(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setDetailError("Enter a reason (min 5 characters) to export.");
      return;
    }
    const r = await api.adminExportCsv(query, reason.trim());
    if (r.ok) {
      const a = document.createElement("a");
      a.href = r.data.blobUrl;
      a.download = r.data.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      setDetailError(r.error.status === 401 ? "Admin session expired — sign in again." : r.error.message ?? "Export failed.");
    }
  };

  const doAudit = async () => {
    setDetailError(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setDetailError("Enter a reason (min 5 characters) to view the audit log.");
      return;
    }
    const r = await api.adminAudit(100, reason.trim());
    if (r.ok) setAudit(r.data.entries);
    else setDetailError(r.error.status === 401 ? "Admin session expired — sign in again." : r.error.message ?? "Audit failed.");
  };

  const doPurge = async () => {
    setPurgeResult(null);
    setDetailError(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setDetailError("Enter a reason (min 5 characters) to run the retention purge.");
      return;
    }
    const r = await api.adminPurge(reason.trim());
    if (r.ok) setPurgeResult(`Purged ${r.data.purged} eligible record(s); ${r.data.retained} retained.`);
    else setDetailError(r.error.status === 401 ? "Admin session expired — sign in again." : r.error.message ?? "Purge failed.");
  };

  const openSelfie = async () => {
    if (!record) return;
    if (!reason.trim() || reason.trim().length < 5) {
      setDetailError("Enter a reason (min 5 characters) to view the selfie.");
      return;
    }
    // Stream via authed fetch (audited server-side) and display as object URL.
    try {
      const res = await fetch(api.adminSelfieUrl(record.id), { credentials: "same-origin" });
      if (!res.ok) {
        setDetailError(res.status === 401 ? "Admin session expired — sign in again." : "Selfie could not be loaded.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (!w) setDetailError("Pop-up blocked — allow pop-ups for this site to view the selfie.");
      selfieCheckRef.current = true;
    } catch {
      setDetailError("Selfie could not be loaded.");
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-10 text-center text-sm text-slate-500">Loading…</div>
    );
  }

  if (backendDown) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <h1 className="text-xl font-extrabold text-slate-900">Admin safety tool</h1>
          <div className="mt-4"><Err msg="The Run Local server is unreachable — the admin API is not available right now. Try again later." /></div>
        </div>
      </div>
    );
  }

  if (!health?.adminConfigured && !isOwner) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <h1 className="text-xl font-extrabold text-slate-900">Admin safety tool</h1>
          <div className="mt-4">
            <Info msg="Admin access is not configured on this server. The operator must set RUN_LOCAL_ADMIN_KEY (and optionally RUN_LOCAL_ADMIN_EMAIL) and restart the server. No admin actions are possible until then." />
          </div>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <h1 className="text-xl font-extrabold text-slate-900">Admin safety tool</h1>
          <p className="mt-1 text-sm text-slate-500">Authorized administrators only. Every access is audited.</p>
          <div className="mt-4 space-y-3">
            <input type="password" autoComplete="current-password" placeholder="Admin key" value={key} onChange={(e) => setKey(e.target.value)} className={inputCls} aria-label="Admin key" />
            {authError ? <Err msg={authError} /> : null}
            <PillButton variant="primary" className="w-full" disabled={busy || key.trim().length === 0} onClick={() => void doLogin()}>
              {busy ? "Signing in…" : "Sign in"}
            </PillButton>
            <p className="text-center text-[11px] leading-relaxed text-slate-400">
              The key is sent once and never stored on this device. This page is not linked anywhere in the app.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Admin control center</h1>
          <p className="text-sm font-medium text-slate-500">
            Signed in as {adminName}
            {isOwner ? <span className="ml-1.5 font-semibold text-[#0b2b22]">(Super Admin)</span> : null}
          </p>
        </div>
        <button type="button" onClick={() => void doLogout()} className="min-h-11 rounded-full px-4 text-sm font-semibold text-slate-600 active:bg-slate-100">
          Sign out
        </button>
      </div>

      {/* Owner-only pending queue */}
      {isOwner ? (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <h2 className="text-[15px] font-bold text-slate-900">Pending users</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Accounts awaiting verification, newest first. Rows are redacted — no phone, selfie, or IP data here.
            Approve only after the user reached the "Under review" state (email + selfie submitted).
          </p>
          <div className="mt-3 space-y-3">
            <textarea rows={2} placeholder="Reason for accessing the queue (required, audited)" value={reason} onChange={(e) => setReason(e.target.value)} className={reasonCls} />
            <PillButton variant="primary" className="w-full" onClick={() => void loadQueue()}>
              <Icon name="search" className="h-4 w-4" /> Load pending queue
            </PillButton>
            {queueError ? <Err msg={queueError} /> : null}
          </div>
          {pending !== null && (
            <ul className="mt-4 space-y-3">
              {pending.length === 0 ? <li className="py-2 text-sm text-slate-500">No pending accounts right now.</li> : null}
              {pending.map((row) => (
                <li key={row.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{row.name}</p>
                      <p className="truncate text-xs text-slate-500">{row.email}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${row.phase === "pending_review" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                      {row.phase}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      Approve as
                      <select
                        value={roleSel[row.id] ?? row.requestedRole ?? "runner"}
                        onChange={(e) => setRoleSel((m) => ({ ...m, [row.id]: e.target.value === "group_leader" ? "group_leader" : "runner" }))}
                        className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800"
                      >
                        <option value="runner">Verified Runner</option>
                        <option value="group_leader">Group Leader</option>
                      </select>
                      {row.requestedRole ? <span className="text-slate-400">(requested {row.requestedRole})</span> : null}
                    </label>
                    <PillButton variant="secondary" className="ml-auto px-4" onClick={() => void approvePending(row)}>
                      Approve
                    </PillButton>
                    <PillButton variant="ghost" className="px-4" onClick={() => void rejectPending(row)}>
                      Reject
                    </PillButton>
                  </div>
                  {row.phase !== "pending_review" ? (
                    <p className="mt-1.5 text-[11px] text-amber-700">
                      Verification incomplete — approval is disabled until this user finishes email + selfie (Under review).
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* Search */}
      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
        <h2 className="text-[15px] font-bold text-slate-900">Lookup by username or email</h2>
        <p className="mt-0.5 text-xs text-slate-500">Phone-number search is intentionally not available — no discovery by phone.</p>
        <div className="mt-3 space-y-3">
          <input type="search" inputMode="search" placeholder="Name or email" value={query} onChange={(e) => setQuery(e.target.value)} className={inputCls} aria-label="Search query" />
          <div>
            <span className="mb-1 block text-xs font-semibold text-slate-600">Reason for this access (required, audited)</span>
            <textarea rows={2} placeholder="e.g. Safety review of a flagged report" value={reason} onChange={(e) => setReason(e.target.value)} className={reasonCls} />
          </div>
          <div className="flex gap-2">
            <PillButton variant="primary" className="flex-1" onClick={() => void doSearch()}>
              <Icon name="search" className="h-4 w-4" /> Search
            </PillButton>
            <PillButton variant="ghost" className="flex-1" onClick={() => void doExport()}>
              <Icon name="download" className="h-4 w-4" /> Export CSV
            </PillButton>
          </div>
          {searchError ? <Err msg={searchError} /> : null}
        </div>
        {results !== null && (
          <ul className="mt-4 divide-y divide-slate-100">
            {results.length === 0 ? <li className="py-3 text-sm text-slate-500">No accounts match.</li> : null}
            {results.map((r) => (
              <li key={r.id} className="py-2.5">
                <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => void openRecord(r.id)}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-800">{r.name}</span>
                    <span className="block truncate text-xs text-slate-500">{r.email}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${r.status === "verified" ? "bg-emerald-100 text-emerald-800" : r.status === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                      {r.status}{r.status === "pending" && r.phase ? ` · ${r.phase}` : ""}
                    </span>
                    <Icon name="chevronRight" className="h-4 w-4 text-slate-300" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Record detail */}
      {record && (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-[15px] font-bold text-slate-900">Record — {record.name}</h2>
            <button type="button" onClick={() => setRecord(null)} className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-slate-500 active:bg-slate-200" aria-label="Close record">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
          <dl className="mt-3 space-y-2 text-[13px]">
            <Row k="Status" v={`${record.status}${record.phase ? ` (${record.phase})` : ""}`} />
            <Row k="Email" v={record.email} />
            <Row k="Phone" v={record.phone ?? "—"} sensitive />
            <Row k="Phone verified" v={fmt(record.phoneVerifiedAt)} sensitive />
            <Row k="Selfie captured" v={fmt(record.selfieCapturedAt)} sensitive />
            <Row k="Signup IP" v={maskIp(record.signupIp)} sensitive />
            <Row k="Last activity" v={fmt(record.lastActivityAt)} sensitive />
            <Row k="Signup" v={fmt(record.signupAt)} />
            <Row k="Verified" v={fmt(record.verifiedAt)} />
            <Row k="Deleted" v={fmt(record.deletedAt)} sensitive />
            <Row k="Retention" v={`${record.retentionYears}y${record.purgeAt ? ` · purge by ${fmt(record.purgeAt)}` : ""}`} sensitive />
            <li className="flex items-start gap-2">
              <span className="w-28 shrink-0 font-semibold text-slate-500">Login IPs (90d)</span>
              <span className="flex-1 text-slate-800">
                {record.loginIps.length === 0 ? "—" : record.loginIps.map((e) => `${e.ip} · ${fmt(e.at)}`).join(", ")}
              </span>
            </li>
          </dl>
          {record.canViewSelfie && (
            <PillButton variant="ghost" className="mt-3 w-full" onClick={() => void openSelfie()}>
              <Icon name="shield" className="h-4 w-4" /> View selfie (audited)
            </PillButton>
          )}
          {detailError ? <div className="mt-3"><Err msg={detailError} /></div> : null}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <PillButton variant="secondary" className="w-full px-2" onClick={() => void doAction("approve")} disabled={record.status === "verified"}>
              Approve
            </PillButton>
            <PillButton variant="ghost" className="w-full px-2" onClick={() => void doAction("reject")} disabled={record.status === "rejected"}>
              Reject
            </PillButton>
            <PillButton variant="ghost" className="w-full px-2 text-red-600" onClick={() => void doAction("delete")}>
              Delete
            </PillButton>
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-400">All actions use the reason above and are audited.</p>
        </section>
      )}

      {/* Audit + purge */}
      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
        <h2 className="text-[15px] font-bold text-slate-900">Audit log & retention</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Retention: {health?.retention.retentionYears ?? "?"} year(s); {health?.retention.eligibleForPurge ?? "?"} record(s) currently eligible for purge.
        </p>
        <div className="mt-3 flex gap-2">
          <PillButton variant="ghost" className="flex-1" onClick={() => void doAudit()}>
            <Icon name="sort" className="h-4 w-4" /> View audit log
          </PillButton>
          <PillButton variant="ghost" className="flex-1" onClick={() => void doPurge()}>
            <Icon name="trash" className="h-4 w-4" /> Run purge
          </PillButton>
        </div>
        {purgeResult ? <div className="mt-3"><Info msg={purgeResult} /></div> : null}
        {audit && (
          <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto">
            {audit.map((a) => (
              <li key={a.id} className="rounded-lg bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600">
                <span className="font-semibold text-slate-800">{a.action}</span> · {fmt(a.at)} · {a.admin}
                <span className="block text-slate-500">Reason: {a.reason}{a.targetId ? ` · target ${a.targetId.slice(0, 8)}…` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" onClick={() => navigate("/")} className="mt-4 w-full text-center text-sm font-semibold text-slate-500 underline underline-offset-2">
        Back to the app
      </button>
    </div>
  );
}

function Row({ k, v, sensitive }: { k: string; v: string; sensitive?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span className="w-28 shrink-0 font-semibold text-slate-500">{k}</span>
      <span className={`flex-1 break-all ${sensitive ? "font-mono text-slate-800" : "text-slate-800"}`}>{v}</span>
    </li>
  );
}
