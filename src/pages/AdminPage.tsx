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
import { GlobalAdminSection } from "../components/GlobalAdminSection";
import { SponsorsAdminSection } from "../components/SponsorsAdminSection";
import { GeofenceAllowlistSection } from "../components/GeofenceAllowlistSection";
import { PurgeAllSection } from "../components/PurgeAllSection";
import { AdminTrustSection } from "../components/AdminTrustSection";
import { TrustedMembersSection } from "../components/TrustedMembersSection";
import { EventCmsSection } from "../components/EventCmsSection";
import { Icon, PillButton } from "../components/ui";
import * as api from "../lib/api";
import type { AdminRecordView, AdminSearchRow, AuditEntryView, DashboardView, PendingQueueRow } from "../lib/api";
import { ALL_OP_ROLES, roleLabel, type OpRole } from "../lib/accounts";
import { CITIES } from "../data/cities";
import { ContentManagementSection } from "../components/ContentManagementSection";
import { ModerationConfirmSheet } from "../components/ModerationConfirmSheet";
import { useAccount } from "../state/account";
import { useToast } from "../lib/toast";

const inputCls =
  "h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";

const reasonCls =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[14px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";

function Err({ msg }: { msg: string }) {
  return <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3.5 text-[13px] leading-relaxed text-red-800">{msg}</p>;
}

function Info({ msg }: { msg: string }) {
  return <p role="status" className="flex items-start gap-2 rounded-xl bg-sky-50 p-3.5 text-[13px] leading-relaxed text-sky-900">{msg}</p>;
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
  const toast = useToast();
  const { me, refresh: refreshAccount } = useAccount();
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
  // The reason field exists for real accountability on delegated admin
  // access (city admins, key-based sessions) — but for the owner, re-typing
  // a justification to yourself on every click is pure friction with no
  // safety benefit. Persisted in sessionStorage and auto-filled once for the
  // owner, so it's "type it once per browser session," not per action.
  const [reason, setReason] = useState(() => {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem("adminReason") ?? "";
  });
  const setReasonPersisted = (v: string) => {
    setReason(v);
    if (typeof window !== "undefined") sessionStorage.setItem("adminReason", v);
  };
  useEffect(() => {
    if (isOwner && !reason) setReasonPersisted("Routine admin session");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner]);
  const [selfieModalUrl, setSelfieModalUrl] = useState<string | null>(null);
  const [selfieModalLoading, setSelfieModalLoading] = useState(false);
  const [results, setResults] = useState<AdminSearchRow[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // pending queue (owner-only)
  const [pending, setPending] = useState<PendingQueueRow[] | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [overview, setOverview] = useState<api.AdminOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [roleSel, setRoleSel] = useState<Record<string, "runner" | "group_leader">>({});

  // detail
  const [record, setRecord] = useState<AdminRecordView | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // audit
  const [audit, setAudit] = useState<AuditEntryView[] | null>(null);

  // purge
  const [purgeResult, setPurgeResult] = useState<string | null>(null);

  // owner dashboard (moderation, RRCA, featured/pinned)
  const [dashCity, setDashCity] = useState<string>(CITIES.find((c) => c.live)?.id ?? "columbia-mo");
  const [dash, setDash] = useState<DashboardView | null>(null);
  // Was a second, separate reason box for the dashboard section - unified
  // into the one shared, persisted `reason` above so there's only ever one
  // "type a reason" moment for the owner, not two different boxes on one page.
  const dashReason = reason;
  const setDashReason = setReasonPersisted;
  const [dashError, setDashError] = useState<string | null>(null);
  const [dashBusy, setDashBusy] = useState(false);
  /** Registry id of the row action currently in flight (disables that row). */
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  /** Per-group RRCA draft state (badge + note) before saving. */
  const [rrcaDrafts, setRrcaDrafts] = useState<Record<string, { badge: boolean; note: string }>>({});
  /** Per-flag suspension-days input (blank = indefinite). */
  const [suspendDays, setSuspendDays] = useState<Record<string, string>>({});
  const [subRows, setSubRows] = useState<api.SubmissionQueueRow[] | null>(null);
  const [subStatus, setSubStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [subError, setSubError] = useState<string | null>(null);
  const [subBusy, setSubBusy] = useState(false);
  const [subAction, setSubAction] = useState<string | null>(null);
  /**
   * Decision sheet for the queues and the record detail. Approve uses the
   * plain-confirm variant (Variant B): the audit log records the action with
   * the admin identity, no typed reason is forced. Reject uses Variant A with
   * an applicant-facing required reason. Authorization stays server-side —
   * this only controls the prompt.
   */
  const [sheet, setSheet] = useState<null | {
    kind: "submission" | "pending" | "record";
    id?: string;
    action: "approve" | "reject";
    entity: string;
  }>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const isCityAdmin = me?.status === "signed_in" && me.account.role === "city_admin";
  const cityScope = me?.status === "signed_in" ? me.account.adminCityId : null;
  // Loading the queue is a routine read: audited server-side with the
  // generated reason — the operator is NOT prompted. Only decisions
  // (approve/reject) require the explicit reason below.
  const loadSubmissions = async () => {
    setSubError(null);
    setSubBusy(true);
    const r = isCityAdmin ? await api.cityAdminGetSubmissions("") : await api.adminGetSubmissions(null, "", subStatus);
    setSubBusy(false);
    if (r.ok) setSubRows(r.data.results);
    else setSubError(r.error.message ?? "Couldn't load the queue.");
  };
  /** Decide a submission; returns false (with an error surfaced) when the server refuses. */
  const decideSubmission = async (id: string, action: "approve" | "reject", reason: string): Promise<boolean> => {
    setSubError(null);
    setSubAction(id);
    const r = isCityAdmin ? await api.cityAdminDecideSubmission(id, action, reason) : await api.adminDecideSubmission(id, action, reason);
    setSubAction(null);
    if (r.ok) {
      setSubRows((rows) => (rows ? rows.filter((row) => row.id !== id) : rows));
      return true;
    }
    setSheetError(r.error.message ?? "Action failed.");
    return false;
  };

  /** Run the sheet-confirmed decision. `reason` is "" for plain approvals. */
  const confirmSheet = async (reason: string) => {
    if (!sheet) return;
    setSheetError(null);
    setSheetBusy(true);
    try {
      if (sheet.kind === "submission" && sheet.id) {
        if (!(await decideSubmission(sheet.id, sheet.action, reason))) return;
      } else if (sheet.kind === "pending" && sheet.id) {
        if (sheet.action === "approve") {
          const row = pending?.find((r) => r.id === sheet.id);
          if (!row) return;
          if (row.phase !== "pending_review") {
            setSheetError("This user hasn't completed email + selfie verification yet — approval isn't allowed before the pending_review state.");
            return;
          }
          const role = roleSel[row.id] ?? row.requestedRole ?? "runner";
          const r = await api.adminSetStatus(row.id, "approve", reason, role);
          if (!r.ok) {
            setSheetError(
              r.error.code === "verification_incomplete"
                ? "Approval blocked: the required verification state (email + selfie, pending_review) isn't complete."
                : r.error.status === 401
                  ? "Your admin session expired — sign in again."
                  : r.error.message ?? "Approval failed.",
            );
            return;
          }
          await refreshAccount();
          void loadQueue();
          toast(`${row.name} is now Verified.`, "success");
        } else {
          const row = pending?.find((r) => r.id === sheet.id);
          const r = await api.adminSetStatus(sheet.id, "reject", reason);
          if (!r.ok) {
            setSheetError(r.error.status === 401 ? "Your admin session expired — sign in again." : r.error.message ?? "Rejection failed.");
            return;
          }
          void loadQueue();
          toast(`${row?.name ?? "Applicant"} was rejected.`, "info");
        }
      } else if (sheet.kind === "record" && record) {
        const r = sheet.action === "approve" ? await api.adminSetStatus(record.id, "approve", reason) : await api.adminSetStatus(record.id, "reject", reason);
        if (!r.ok) {
          setSheetError(r.error.message ?? (sheet.action === "approve" ? "Approval failed." : "Rejection failed."));
          return;
        }
        setRecord(null);
        setResults(null);
        setDetailError(null);
        void doSearch();
        toast(sheet.action === "approve" ? `${record.name} is now Verified.` : `${record.name} was rejected.`, sheet.action === "approve" ? "success" : "info");
      }
      setSheet(null);
    } finally {
      setSheetBusy(false);
    }
  };

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
        if (isCityAdmin) {
          // City Admin: authorized via their signed-in user session against a
          // scoped routine endpoint (the server enforces the exact city scope;
          // the audit log records the routine read with the generated reason).
          void api.adminGetOverview().then((probe) => {
            if (!alive) return;
            if (probe.ok) {
              setAuthed(true);
              setAdminName(me?.status === "signed_in" ? me.account.name : "City Admin");
            } else {
              setAuthed(false);
            }
          });
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
    setDash(null);
    setDashError(null);
    setDashReason("");
  };

  const loadOverview = async () => {
    setOverviewError(null);
    setOverviewBusy(true);
    const r = await api.adminGetOverview();
    setOverviewBusy(false);
    if (r.ok) setOverview(r.data);
    else setOverviewError(r.error.status === 401 ? "Your admin session expired — sign in again." : r.error.message ?? "Could not load the overview.");
  };

  // ---- owner-only pending queue -----------------------------------------
  const loadQueue = async () => {
    setQueueError(null);
    const r = await api.adminPending();
    if (r.ok) {
      setPending(r.data.results);
      setQueueError(null);
    } else {
      setQueueError(
        r.error.status === 401
          ? "Only the owner/super-admin can view the pending queue."
          : r.error.message ?? "Could not load the queue.",
      );
    }
  };

  /** Open the approve (plain confirm) / reject (required reason) sheet for a pending user. */
  const openPendingDecision = (row: PendingQueueRow, action: "approve" | "reject") => {
    setQueueError(null);
    if (action === "approve" && row.phase !== "pending_review") {
      // Honesty gate, mirrored server-side: no approval without a submitted
      // selfie in review (phase pending_review).
      setQueueError("This user hasn't completed email + selfie verification yet — approval isn't allowed before the pending_review state.");
      return;
    }
    setSheet({ kind: "pending", id: row.id, action, entity: row.name });
  };

  const doSearch = async () => {
    setSearchError(null);
    const r = await api.adminSearch(query);
    if (r.ok) {
      setResults(r.data.results);
      setRecord(null);
      setAudit(null);
    } else {
      setSearchError(
        r.error.status === 401
          ? "Your admin session expired — sign in again."
          : r.error.message ?? "Search failed.",
      );
    }
  };

  const openRecord = async (id: string) => {
    setDetailError(null);
    closeSelfieModal();
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
    if (action === "approve" || action === "reject") {
      // Approve is a plain confirmation (audited with the admin identity, no
      // typed reason forced); reject requires an applicant-facing reason
      // entered in the sheet.
      setSheet({ kind: "record", action, entity: record.name });
      return;
    }
    if (!reason.trim() || reason.trim().length < 5) {
      setDetailError("Enter a reason (min 5 characters) for this action.");
      return;
    }
    if (!window.confirm("Delete this account permanently (scrubs phone, selfie, photo, IP history)? This is audited.")) return;
    const r = await api.adminDeleteRecord(record.id, reason.trim());
    if (r.ok) {
      setRecord(null);
      setResults(null);
      setDetailError(null);
      void doSearch();
    } else {
      setDetailError(r.error.status === 401 ? "Admin session expired — sign in again." : r.error.message ?? "Action failed.");
    }
  };

  /** Undo a rejection - returns the account to pending review. Low-risk/reversible (unlike delete), so no confirm dialog, just the reason already required to be viewing this record. */
  const doUndoRejection = async () => {
    if (!record) return;
    setDetailError(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setDetailError("Enter a reason (min 5 characters) for this action.");
      return;
    }
    const r = await api.adminUndoRejection(record.id, reason.trim());
    if (r.ok) {
      void openRecord(record.id);
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
    // Audit-log READS are routine (server uses routineAdminCtx since Phase 2a):
    // no operator-reason prompt here — decisions and mutations still require one.
    const r = await api.adminAudit(100, "");
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

  // ---- owner dashboard (moderation, RRCA, featured/pinned) ----------------
  /** Returns the trimmed reason when valid, else sets an error and returns null. */
  const dashReasonOr = (what: string): string | null => {
    if (!dashReason.trim() || dashReason.trim().length < 5) {
      setDashError(`Enter a reason (min 5 characters) to ${what}.`);
      return null;
    }
    return dashReason.trim();
  };

  const loadDashboard = async () => {
    setDashBusy(true);
    const reason = dashReasonOr("open the dashboard");
    if (!reason) {
      setDashBusy(false);
      return;
    }
    const r = await api.adminDashboard(dashCity, reason);
    setDashBusy(false);
    if (r.ok) {
      setDash(r.data);
      setDashError(null);
      setRrcaDrafts(
        Object.fromEntries(r.data.groups.map((g) => [g.id, { badge: g.rrcaBadge, note: g.rrcaNote ?? "" }])),
      );
    } else {
      setDashError(r.error.status === 401 ? "Your admin session expired — sign in again." : r.error.message ?? "Could not load the dashboard.");
    }
  };

  /** Run a dashboard mutation, then reload the overview. */
  const dashAction = async (busyKey: string, label: string, fn: () => Promise<api.ApiResult<unknown>>) => {
    const reason = dashReasonOr(label);
    if (!reason) return;
    setActionBusy(busyKey);
    const r = await fn();
    setActionBusy(null);
    if (r.ok) {
      setDashError(null);
      void loadDashboard();
    } else {
      setDashError(r.error.status === 401 ? "Your admin session expired — sign in again." : r.error.message ?? "Action failed.");
    }
  };

  const goLookup = () => {
    document.getElementById("lookup")?.scrollIntoView({ behavior: "smooth", block: "start" });
    (document.getElementById("lookup-query") as HTMLInputElement | null)?.focus({ preventScroll: true });
  };

  const openSelfie = async () => {
    if (!record) return;
    if (!reason.trim() || reason.trim().length < 5) {
      setDetailError("Enter a reason (min 5 characters) to view the selfie.");
      return;
    }
    setDetailError("");
    setSelfieModalLoading(true);
    // Stream via authed fetch (audited server-side) and display inline in this
    // page's own modal — a previous version used window.open(url), but that
    // call happens after an awaited fetch, well after the click that
    // triggered it, so browsers routinely treat it as an unrequested popup
    // and block it silently. Rendering the image in our own modal state
    // avoids ever creating a new window at all.
    try {
      const res = await fetch(api.adminSelfieUrl(record.id), {
        credentials: "same-origin",
        headers: { "x-audit-reason": reason.trim() },
      });
      if (!res.ok) {
        setDetailError(res.status === 401 ? "Admin session expired — sign in again." : "Selfie could not be loaded.");
        setSelfieModalLoading(false);
        return;
      }
      const blob = await res.blob();
      setSelfieModalUrl(URL.createObjectURL(blob));
      selfieCheckRef.current = true;
    } catch {
      setDetailError("Selfie could not be loaded.");
    } finally {
      setSelfieModalLoading(false);
    }
  };

  const closeSelfieModal = () => {
    if (selfieModalUrl) URL.revokeObjectURL(selfieModalUrl);
    setSelfieModalUrl(null);
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-10 text-center text-sm text-slate-500">Loading…</div>
    );
  }

  if (backendDown) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6 desktop-reading">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <h1 className="text-xl font-extrabold text-slate-900">Admin safety tool</h1>
          <div className="mt-4"><Err msg="The Kimbio server is unreachable — the admin API is not available right now. Try again later." /></div>
        </div>
      </div>
    );
  }

  if (!health?.adminConfigured && !isOwner && !isCityAdmin) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6 desktop-reading">
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
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Admin control center</h1>
          <p className="text-sm font-medium text-slate-500">
            Signed in as {adminName}
            {isOwner ? <span className="ml-1.5 font-semibold text-[#14171C]">(Super Admin)</span> : null}
          </p>
        </div>
        <button
          type="button"
          onClick={() => (isCityAdmin ? navigate("/") : void doLogout())}
          className="min-h-11 rounded-full px-4 text-sm font-semibold text-slate-600 active:bg-slate-100"
        >
          {isCityAdmin ? "Back to the app" : "Sign out"}
        </button>
      </div>

      <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
        <span className="mb-1 block text-xs font-semibold text-slate-600">Reason for this admin session (required, audited) — set once, applies to every action below</span>
        <textarea rows={2} placeholder="e.g. Routine admin session" value={reason} onChange={(e) => setReasonPersisted(e.target.value)} className={reasonCls} />
      </section>

      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70" aria-labelledby="admin-overview-heading">
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="admin-overview-heading" className="text-[15px] font-bold text-slate-900">Attention overview</h2>
          <p className="mt-0.5 text-xs text-slate-500">Server-derived queue counts for your permitted scope. No private run or identity details.</p></div>
          <PillButton variant="secondary" className="min-h-9 shrink-0 px-3 text-xs" disabled={overviewBusy} onClick={() => void loadOverview()}>{overviewBusy ? "Refreshing…" : "Refresh"}</PillButton>
        </div>
        {overview ? <><p className="mt-3 text-[11px] text-slate-500">Updated {fmt(overview.generatedAt)} · {overview.scope.kind === "global" ? "All cities" : "Assigned city"}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">{([["Pending verification", overview.queues.pendingVerification, "pending-users"],["Pending submissions", overview.queues.pendingSubmissions, "submissions"],["Open safety reports", overview.queues.openSafetyReports, "dashboard"],["Content to review", overview.queues.contentNeedingReview, "dashboard"]] as const).map(([label,count,target]) => <button type="button" key={label} onClick={() => document.getElementById(target)?.scrollIntoView({behavior:"smooth"})} className="rounded-xl border border-slate-200 p-3 text-left hover:border-slate-400"><span className="block text-2xl font-bold text-slate-900">{count}</span><span className="text-xs font-semibold text-slate-600">{label}</span></button>)}</div>
          <p className="mt-3 text-xs text-slate-500">Published content: {overview.analytics.unavailable ? "Unavailable" : overview.analytics.publishedContent ?? "—"} · RSVP total: {overview.analytics.unavailable ? "Unavailable" : overview.analytics.rsvpTotal ?? "—"}</p>
        </> : <p className="mt-3 text-sm text-slate-500">Load the overview to see current counts.</p>}
        {overviewError ? <Err msg={overviewError} /> : null}
      </section>
      {/* Owner-only pending queue */}
      {isOwner ? (
        <section id="pending-users" className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <h2 className="text-[15px] font-bold text-slate-900">Pending users</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Read-only queue access for Super Admin. Approve is a plain confirmation — the audit log records it with your identity. Reject requires a rejection reason (min 5 characters) the applicant will see. Accounts awaiting verification, newest first. Rows are redacted — no phone, selfie, or IP data here.
            Approve only after the user reached the "Under review" state (email + selfie submitted).
          </p>
          <div className="mt-3 space-y-3">
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
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${row.phase === "pending_review" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
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
                    <PillButton variant="secondary" className="ml-auto px-4" onClick={() => openPendingDecision(row, "approve")}>
                      Approve
                    </PillButton>
                    <PillButton variant="ghost" className="px-4" onClick={() => openPendingDecision(row, "reject")}>
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

      {/* Admin submission queue — owner, key admin, or scoped City Admin */}
      <section id="submissions" className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
        <h2 className="text-[15px] font-bold text-slate-900">{isCityAdmin ? "City submission queue" : "Submission queue"}</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Community-submitted races, groups, and independent events awaiting review. {isCityAdmin ? `Your enforced city scope: ${cityScope ?? "unavailable"}.` : ""} Pending items are not public. Approve publishes the item (groups grant the submitter the Group
          Leader role) as a plain confirmation — the audit log records it with your identity. Reject requires a rejection reason (min 5 characters) the submitter will see; every decision is audited.
        </p>
        <div className="mt-3 space-y-3">
          <PillButton variant="primary" className="w-full" disabled={subBusy} onClick={() => void loadSubmissions()}>
            <Icon name="search" className="h-4 w-4" /> {subBusy ? "Loading…" : "Load submission queue"}
          </PillButton>
          {!isCityAdmin && (
            <select aria-label="Queue status" value={subStatus} onChange={(e) => setSubStatus(e.target.value as "pending" | "approved" | "rejected")} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          )}
          {subError ? <Err msg={subError} /> : null}
        </div>
        {subRows !== null && (
          <ul className="mt-4 space-y-3">
            {subRows.length === 0 ? <li className="py-2 text-sm text-slate-500">No pending submissions.</li> : null}
            {subRows.map((row) => (
              <li key={row.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{row.title}</p>
                    <p className="truncate text-xs text-slate-500">
                      {row.kind === "race" ? "Race" : row.kind === "group" ? "Group" : "Independent run"} · {row.submitterName} · {row.summary}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">Pending</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <PillButton variant="secondary" className="flex-1 px-3" disabled={subAction === row.id} onClick={() => setSheet({ kind: "submission", id: row.id, action: "approve", entity: row.title })}>
                    Approve
                  </PillButton>
                  <PillButton variant="ghost" className="flex-1 px-3" disabled={subAction === row.id} onClick={() => setSheet({ kind: "submission", id: row.id, action: "reject", entity: row.title })}>
                    Reject
                  </PillButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Admin content management — Global Admin (any city) or City Admin
          (server-enforced own city only) */}
      {authed && <ContentManagementSection cityScope={cityScope} />}
      {/* Owner-only dashboard: moderation, RRCA, featured/pinned */}
      {isOwner ? (
        <>
          <section id="dashboard" className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-bold text-slate-900">City dashboard</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Moderation, RRCA badges, and highlights for one city. Every action is reason-required and audited.
              </p>
            </div>
            <button type="button" onClick={goLookup} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[10px] bg-[#14171C] px-4 text-xs font-semibold text-white active:bg-[#252a31]">
              <Icon name="search" className="h-4 w-4" /> Verification lookup
            </button>
          </div>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">City</span>
              <select
                value={dashCity}
                onChange={(e) => {
                  setDashCity(e.target.value);
                  setDash(null);
                }}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#14171C]"
              >
                {CITIES.filter((c) => c.live).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}, {c.state}
                  </option>
                ))}
              </select>
            </label>
            <PillButton variant="primary" className="w-full" disabled={dashBusy} onClick={() => void loadDashboard()}>
              <Icon name="shield" className="h-4 w-4" /> {dashBusy ? "Loading…" : "Load dashboard"}
            </PillButton>
            {dashError ? <Err msg={dashError} /> : null}
          </div>

          {dash ? (
            <div className="mt-4 space-y-5">
              {/* Flags */}
              <div>
                <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Flagged content</h3>
                {dash.flags.filter((f) => f.status === "open").length === 0 ? <p className="mt-1.5 text-sm text-slate-500">No open flags.</p> : null}
                <ul className="mt-2 space-y-2">
                  {dash.flags.map((f) => {
                    const busy = actionBusy === f.id;
                    const open = f.status === "open";
                    return (
                      <li key={f.id} className={`rounded-xl border p-3 ${open ? "border-red-200 bg-red-50/40" : "border-slate-200 bg-slate-50/60"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-800">{f.title}</p>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                              {f.kind} · {f.reporterName}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${open ? "bg-red-100 text-red-700" : "bg-slate-200 text-slate-500"}`}>{f.status}</span>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{f.reason}</p>
                        {open ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <PillButton variant="secondary" className="min-h-9 px-3 text-xs" disabled={busy} onClick={() => void dashAction(f.id, "dismiss this flag", () => api.adminModerateFlag(f.id, "dismiss", dashReason.trim()))}>
                              Dismiss
                            </PillButton>
                            <PillButton
                              variant="ghost"
                              className="min-h-9 px-3 text-xs text-red-600"
                              disabled={busy}
                              onClick={() => {
                                if (window.confirm(`Hide "${f.title}" from everyone? This is audited.`)) {
                                  void dashAction(f.id, "hide this content", () => api.adminModerateFlag(f.id, "hide", dashReason.trim()));
                                }
                              }}
                            >
                              Hide
                            </PillButton>
                            {f.authorAccountId ? (
                              <>
                                <input
                                  type="number"
                                  min={1}
                                  max={365}
                                  placeholder="days (blank = indefinite)"
                                  value={suspendDays[f.id] ?? ""}
                                  onChange={(e) => setSuspendDays((m) => ({ ...m, [f.id]: e.target.value }))}
                                  className="h-9 w-36 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-800 outline-none"
                                  aria-label="Suspension days for the flagged content's author"
                                />
                                <PillButton
                                  variant="ghost"
                                  className="min-h-9 px-3 text-xs"
                                  disabled={busy}
                                  onClick={() => {
                                    const raw = (suspendDays[f.id] ?? "").trim();
                                    const days = raw === "" ? null : Number(raw);
                                    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) {
                                      setDashError("Suspension days must be 1–365, or blank for indefinite.");
                                      return;
                                    }
                                    void dashAction(f.id, "suspend the flagged author", () => api.adminSuspendAccount(f.authorAccountId!, days, dashReason.trim()));
                                  }}
                                >
                                  Suspend author
                                </PillButton>
                              </>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-1.5 text-[11px] text-slate-400">
                            {f.resolvedAction === "hide" ? "Hidden — content is not shown to anyone." : "Dismissed — no action taken."} Resolved {fmt(f.resolvedAt)}.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Hidden content */}
              {dash.events.some((e) => e.hidden) || dash.races.some((r) => r.hidden) || dash.posts.some((p) => p.hidden) ? (
                <div>
                  <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Hidden content</h3>
                  <ul className="mt-2 space-y-2">
                    {[...dash.events, ...dash.races, ...dash.posts]
                      .filter((c) => c.hidden)
                      .map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-800">{c.title}</p>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{c.kind}</p>
                          </div>
                          <PillButton variant="ghost" className="min-h-9 shrink-0 px-3 text-xs" disabled={actionBusy === c.id} onClick={() => void dashAction(c.id, "unhide this content", () => api.adminUnhideContent(c.id, dashReason.trim()))}>
                            Unhide
                          </PillButton>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}

              {/* Suspensions */}
              <div>
                <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Suspended accounts</h3>
                {dash.suspensions.length === 0 ? (
                  <p className="mt-1.5 text-sm text-slate-500">No active suspensions.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {dash.suspensions.map((s) => (
                      <li key={s.accountId} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-800">{s.name}</p>
                            <p className="truncate text-xs text-slate-500">{s.email}</p>
                            <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                              {s.suspendedUntil ? `Suspended until ${fmt(s.suspendedUntil)}` : "Suspended indefinitely"} · {s.suspensionReason ?? "no reason recorded"}
                            </p>
                          </div>
                          <PillButton variant="ghost" className="min-h-9 shrink-0 px-3 text-xs" disabled={actionBusy === s.accountId} onClick={() => void dashAction(s.accountId, "lift this suspension", () => api.adminLiftSuspension(s.accountId, dashReason.trim()))}>
                            Lift
                          </PillButton>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Suspended accounts can't post anywhere until the expiry or a lift. "Suspend author" appears on a flag once the flagged content belongs to a signed-in account.
                </p>
              </div>

              {/* RRCA notes */}
              <div>
                <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">RRCA club badges</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  The badge drives the public "RRCA-Chartered Club" label. The note is your internal evidence trail — never shown publicly.
                </p>
                <ul className="mt-2 space-y-2">
                  {dash.groups.map((g) => {
                    const draft = rrcaDrafts[g.id] ?? { badge: g.rrcaBadge, note: g.rrcaNote ?? "" };
                    const busy = actionBusy === `rrca:${g.id}`;
                    return (
                      <li key={g.id} className="rounded-xl border border-slate-200 p-3">
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                          <input
                            type="checkbox"
                            checked={draft.badge}
                            onChange={(e) => setRrcaDrafts((m) => ({ ...m, [g.id]: { ...draft, badge: e.target.checked } }))}
                            className="h-4 w-4 accent-[#14171C]"
                          />
                          {g.name}
                          {g.rrcaBadge ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold uppercase text-emerald-800">RRCA badge on</span> : null}
                        </label>
                        <textarea
                          rows={2}
                          placeholder="Internal charter note (e.g. charter number + date verified)"
                          value={draft.note}
                          onChange={(e) => setRrcaDrafts((m) => ({ ...m, [g.id]: { ...draft, note: e.target.value } }))}
                          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-[#14171C]"
                        />
                        <PillButton
                          variant="ghost"
                          className="mt-2 min-h-9 px-3 text-xs"
                          disabled={busy || (draft.badge === g.rrcaBadge && draft.note === (g.rrcaNote ?? ""))}
                          onClick={() => void dashAction(`rrca:${g.id}`, "save the RRCA note", () => api.adminSetGroupRrca(g.id, draft.badge, draft.note, dashReason.trim()))}
                        >
                          Save badge & note
                        </PillButton>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Featured & pinned */}
              <div>
                <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Featured & pinned events / races</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">Featured sorts first with a highlight chip; pinned adds a pin chip. Independent toggles.</p>
                {(
                  [
                    ["events", dash.events],
                    ["races", dash.races],
                  ] as const
                ).map(([label, items]) => (
                  <div key={label} className="mt-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {items.map((c) => {
                        const busy = actionBusy === c.id;
                        return (
                          <li key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
                            <span className="min-w-0 truncate text-[13px] font-semibold text-slate-800">{c.title}</span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void dashAction(c.id, "toggle featured", () => api.adminSetHighlight(c.id, { featured: !c.featured }, dashReason.trim()))}
                                className={`min-h-9 rounded-full px-3 text-xs font-semibold transition-colors ${c.featured ? "bg-[#FF5741] text-[#14171C]" : "bg-slate-100 text-slate-500 active:bg-slate-200"}`}
                              >
                                Featured
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void dashAction(c.id, "toggle pinned", () => api.adminSetHighlight(c.id, { pinned: !c.pinned }, dashReason.trim()))}
                                className={`min-h-9 rounded-full px-3 text-xs font-semibold transition-colors ${c.pinned ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500 active:bg-slate-200"}`}
                              >
                                Pinned
                              </button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          </section>
        </>
      ) : null}

      {/* Global Admin — site settings & CMS (key admin or owner; audited).
          Hidden for City Admins: these surfaces are server-restricted to
          Global Admins (authorizeAdmin), so a City Admin would only see errors. */}
      {authed && !isCityAdmin && <EventCmsSection />}
      {authed && !isCityAdmin && <GlobalAdminSection />}
      {authed && !isCityAdmin && <SponsorsAdminSection cityId="columbia-mo" reason={reason} />}
      {authed && !isCityAdmin && <GeofenceAllowlistSection reason={reason} />}
      {isOwner && <PurgeAllSection reason={reason} />}
      {/* Global Admin — community trust & credentials (audited) */}
      {authed && !isCityAdmin && <AdminTrustSection />}
      {/* Trusted Member (manual trust / blue-check) - Global or scoped City Admin */}
      <TrustedMembersSection isCityAdmin={isCityAdmin} />

      {/* Search — Global Admin only (records carry phone/selfie/IP data and
          the server restricts lookup to key-admin/owner sessions). */}
      {!isCityAdmin && (
      <section id="lookup" className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
        <h2 className="text-[15px] font-bold text-slate-900">Lookup by username or email</h2>
        <p className="mt-0.5 text-xs text-slate-500">Phone-number search is intentionally not available — no discovery by phone.</p>
        <div className="mt-3 space-y-3">
          <input id="lookup-query" type="search" inputMode="search" placeholder="Name or email" value={query} onChange={(e) => setQuery(e.target.value)} className={inputCls} aria-label="Search query" />
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
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${r.status === "verified" ? "bg-emerald-100 text-emerald-800" : r.status === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                      {r.status}{r.status === "pending" && r.phase ? ` · ${r.phase}` : ""}
                    </span>
                    {r.trustedMember ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sky-700">Trusted</span> : null}
                    <Icon name="chevronRight" className="h-4 w-4 text-slate-300" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {/* Record detail — Global Admin only (same server restriction as search). */}
      {!isCityAdmin && record && (
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
            <Row k="Trusted member" v={record.trustedMember ? "Yes - manually granted" : "No"} />
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
            <PillButton variant="ghost" className="mt-3 w-full" disabled={selfieModalLoading} onClick={() => void openSelfie()}>
              <Icon name="shield" className="h-4 w-4" /> {selfieModalLoading ? "Loading…" : "View selfie (audited)"}
            </PillButton>
          )}
          <RoleEditor
            record={record}
            viewerIsCityAdmin={isCityAdmin}
            viewerCityScope={cityScope ?? null}
            reason={reason}
            onSaved={() => void openRecord(record.id)}
          />
          {detailError ? <div className="mt-3"><Err msg={detailError} /></div> : null}
          {record.priorRejectionReason ? (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900">
              <span className="font-bold">Previously rejected:</span> {record.priorRejectionReason}
            </p>
          ) : null}
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
          {record.status === "rejected" ? (
            <PillButton variant="ghost" className="mt-2 w-full" onClick={() => void doUndoRejection()}>
              Undo rejection — return to pending review
            </PillButton>
          ) : null}
          <p className="mt-2 text-center text-[11px] text-slate-400">Approve is a plain confirmation (audited). Reject shows the applicant your reason. Delete uses the reason above.</p>
        </section>
      )}

      {/* Audit + purge — Global Admin only (records + retention policy) */}
      {!isCityAdmin && (
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
      )}

      <button type="button" onClick={() => navigate("/")} className="mt-4 w-full text-center text-sm font-semibold text-slate-500 underline underline-offset-2">
        Back to the app
      </button>

      {/* Queue / record decision sheet. Approve = Variant B (plain confirm,
          audited with the admin identity; no typed reason forced). Reject =
          Variant A with an applicant-facing required reason. */}
      <ModerationConfirmSheet
        open={sheet !== null}
        onClose={() => {
          if (!sheetBusy) {
            setSheet(null);
            setSheetError(null);
          }
        }}
        title={sheet?.action === "approve" ? "Approve this?" : "Reject this?"}
        entity={sheet?.entity ?? ""}
        impact={
          sheet?.action === "approve"
            ? "This is a routine approval — the audit log records it with your identity. No typed reason is required."
            : sheet?.kind === "pending"
              ? "The applicant will see your reason on their verification status. This cannot be undone."
              : "The submitter will see your reason on their submission. This cannot be undone."
        }
        confirmLabel={sheet?.action === "approve" ? "Approve" : "Reject"}
        requireReason={sheet?.action === "reject"}
        reasonLabel="Rejection reason — the submitter will see this"
        reasonPlaceholder="Why was this rejected? The submitter will see this (min 5 characters)"
        tone={sheet?.action === "approve" ? "neutral" : "danger"}
        busy={sheetBusy}
        error={sheetError}
        onConfirm={(reason) => void confirmSheet(reason)}
      />
      {selfieModalUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={closeSelfieModal}>
          <div className="max-h-[85vh] max-w-md overflow-hidden rounded-2xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 p-4">
              <p className="text-sm font-bold text-slate-900">Verification selfie — audited view</p>
              <button type="button" aria-label="Close photo" onClick={closeSelfieModal} className="rounded-full p-1.5 hover:bg-slate-100">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            <img src={selfieModalUrl} alt="Submitted verification selfie" className="max-h-[70vh] w-full object-contain" />
          </div>
        </div>
      ) : null}
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

/** Server error codes the roles endpoint can return, mapped to operator-facing copy. */
function roleErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case "invalid_roles":
      return "That role set isn't valid — pick from the roles shown below.";
    case "invalid_city":
      return "The City Admin role requires a valid city scope — choose one from the list.";
    case "city_scope_denied":
      return "Your admin access is scoped to one city — you can only manage accounts in your own city.";
    case "roles_out_of_scope":
      return "City Admins may only add or remove the Group Leader role within their own city.";
    case "owner_cannot_demote":
      return "The owner always holds Site Admin and cannot be demoted.";
    case "verification_incomplete":
      return "Admin roles (City Admin, Site Admin) require an identity-verified account.";
    case "account_not_found":
      return "Account not found — it may have been deleted.";
    default:
      return null;
  }
}

/**
 * Audited multi-role editor for one account record. Renders the current role
 * set with roleLabel(), lets the operator toggle assignable roles, and PATCHes
 * the FULL desired set to /api/admin/accounts/:id/roles. Server-enforced
 * rules are mirrored in the UI: City Admins only get the group_leader toggle
 * (own city only); Global Admins (owner or key admin) get the full set; the
 * owner's site_admin can never be removed. Server errors surface inline.
 */
function RoleEditor({
  record,
  viewerIsCityAdmin,
  viewerCityScope,
  reason,
  onSaved,
}: {
  record: AdminRecordView;
  viewerIsCityAdmin: boolean;
  viewerCityScope: string | null;
  reason: string;
  onSaved?: () => void;
}) {
  const [draft, setDraft] = useState<Set<OpRole>>(() => new Set(record.roles));
  const [citySel, setCitySel] = useState<string>(record.adminCityId ?? record.cityId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const outOfScope = viewerIsCityAdmin && record.cityId !== viewerCityScope;
  const canEdit = !viewerIsCityAdmin || !outOfScope;
  const cityName = (id: string | null) => CITIES.find((c) => c.id === id)?.name ?? id ?? null;

  const toggle = (role: OpRole) => {
    if (busy || (record.isOwner && role === "site_admin")) return;
    setSaved(null);
    setError(null);
    const next = new Set(draft);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    setDraft(next);
  };

  const save = async () => {
    setError(null);
    setSaved(null);
    if (!reason.trim() || reason.trim().length < 5) {
      setError("Enter a reason (min 5 characters) to save role changes — every change is audited.");
      return;
    }
    const roles = ALL_OP_ROLES.filter((r) => draft.has(r));
    if (roles.length === 0) {
      setError("At least one role is required — everyone keeps Verified Runner.");
      return;
    }
    setBusy(true);
    const r = await api.adminAssignRoles(record.id, roles, draft.has("city_admin") ? citySel || null : null, reason.trim());
    setBusy(false);
    if (r.ok) {
      setSaved(`Roles saved — ${r.data.account.roles.map(roleLabel).join(", ")}. This change is in the audit log.`);
      setDraft(new Set(r.data.account.roles));
      setCitySel(r.data.account.adminCityId ?? citySel);
      onSaved?.();
    } else {
      setError(roleErrorMessage(r.error.code) ?? r.error.message ?? "Couldn't save roles.");
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold text-slate-900">Roles</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {record.roles.map((r) => (
            <span key={r} className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${r === "site_admin" ? "bg-slate-800 text-white" : r === "city_admin" ? "bg-indigo-100 text-indigo-700" : r === "group_leader" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
              {roleLabel(r)}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        Roles glue together: a higher role includes every lower one. Saving replaces the full set — it is audited with the reason above.
        {record.adminCityId ? ` City Admin scope: ${cityName(record.adminCityId)}.` : ""}
      </p>
      {!canEdit ? (
        <p className="mt-2 rounded-lg bg-amber-50 p-2.5 text-[12px] text-amber-800">
          This account is outside your city scope ({viewerCityScope ?? "none"}) — you may not change its roles here.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {!viewerIsCityAdmin && (
            <>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-white p-2.5 ring-1 ring-slate-200">
                <span className="text-[13px] text-slate-800">
                  <span className="font-semibold">Group Leader</span>
                  <span className="block text-[11px] text-slate-500">Label role for people who run a club or group.</span>
                </span>
                <input type="checkbox" checked={draft.has("group_leader")} onChange={() => toggle("group_leader")} disabled={busy} className="h-4 w-4 accent-[#FF5741]" />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-white p-2.5 ring-1 ring-slate-200">
                <span className="text-[13px] text-slate-800">
                  <span className="font-semibold">City Admin</span>
                  <span className="block text-[11px] text-slate-500">Scoped to exactly one city. Requires an identity-verified account.</span>
                </span>
                <input type="checkbox" checked={draft.has("city_admin")} onChange={() => toggle("city_admin")} disabled={busy} className="h-4 w-4 accent-[#FF5741]" />
              </label>
              {draft.has("city_admin") && (
                <div>
                  <label htmlFor={`role-city-${record.id}`} className="mb-1 block text-[11px] font-semibold text-slate-600">
                    City scope (required for City Admin)
                  </label>
                  <select
                    id={`role-city-${record.id}`}
                    value={citySel}
                    onChange={(e) => setCitySel(e.target.value)}
                    disabled={busy}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[13px] text-slate-900 outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
                  >
                    <option value="">Choose a city…</option>
                    {CITIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}, {c.state}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-white p-2.5 ring-1 ring-slate-200">
                <span className="text-[13px] text-slate-800">
                  <span className="font-semibold">Site Admin</span>
                  <span className="block text-[11px] text-slate-500">Top of the hierarchy — includes every lower role. Requires an identity-verified account.</span>
                </span>
                <input
                  type="checkbox"
                  checked={draft.has("site_admin")}
                  onChange={() => toggle("site_admin")}
                  disabled={busy || record.isOwner}
                  className="h-4 w-4 accent-[#FF5741]"
                  aria-label={record.isOwner ? "Site Admin (locked — the owner always holds it)" : "Site Admin"}
                />
              </label>
              {record.isOwner && <p className="text-[11px] text-slate-500">The owner always holds Site Admin — it cannot be removed here.</p>}
            </>
          )}
          {viewerIsCityAdmin && (
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-white p-2.5 ring-1 ring-slate-200">
              <span className="text-[13px] text-slate-800">
                <span className="font-semibold">Group Leader</span>
                <span className="block text-[11px] text-slate-500">City Admins may only add or remove this role, in their own city.</span>
              </span>
              <input type="checkbox" checked={draft.has("group_leader")} onChange={() => toggle("group_leader")} disabled={busy} className="h-4 w-4 accent-[#FF5741]" />
            </label>
          )}
          {error ? <Err msg={error} /> : null}
          {saved ? <Info msg={saved} /> : null}
          <div className="flex gap-2">
            <PillButton variant="primary" className="flex-1" onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save roles"}
            </PillButton>
            {record.roles.some((r) => r !== "runner") && (
              <PillButton
                variant="ghost"
                className="flex-1"
                disabled={busy || (record.isOwner && record.roles.includes("site_admin"))}
                onClick={() => {
                  setError(null);
                  setSaved(null);
                  setDraft(new Set(["runner"]));
                  setCitySel(record.cityId ?? "");
                }}
              >
                Reset to Runner
              </PillButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
