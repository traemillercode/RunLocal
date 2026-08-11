/**
 * Global Admin trust tooling: credential review queue, appeal decisions, and
 * the configurable under-review threshold. Every action is audited server-side
 * (required reason header); proof files open on audited admin-only routes.
 * This UI never shows proof bytes inline and never exposes reviewer identity,
 * ratings lists, or raw counts — only the qualitative/admin surfaces the
 * server authorizes.
 */
import { useCallback, useEffect, useState } from "react";
import * as api from "../lib/api";
import type { AdminAppealRow, AdminCredentialRow, AdminTrustView } from "../lib/api";
import { adminCredentialProofUrl } from "../lib/api";
import { CREDENTIAL_TYPE_LABELS } from "./TrustProfileSection";
import { Chip, Icon, PillButton } from "./ui";

const inputCls =
  "h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";

/** Presentational: pending credential review queue. */
export function CredentialQueue({
  rows,
  busyId,
  error,
  onDecide,
}: {
  rows: AdminCredentialRow[];
  busyId: string | null;
  error: string | null;
  onDecide: (id: string, action: "approve" | "reject", reason: string) => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <h2 className="text-[15px] font-bold text-slate-900">Credential review</h2>
      <p className="mt-0.5 text-xs text-slate-500">Coach certifications & first aid / CPR awaiting verification. Proof opens in a private, audited view.</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-slate-500">Nothing waiting for review.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800">{CREDENTIAL_TYPE_LABELS[r.type] ?? r.type}</p>
                  <p className="text-xs text-slate-500">{r.certifyingBody}</p>
                </div>
                <a
                  href={adminCredentialProofUrl(r.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-[12px] font-semibold text-slate-700 active:bg-slate-200"
                >
                  <Icon name="external" className="mr-1 inline h-3.5 w-3.5" />View proof
                </a>
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  value={reasons[r.id] ?? ""}
                  onChange={(e) => setReasons((m) => ({ ...m, [r.id]: e.target.value }))}
                  placeholder={r.type === "coach_certification" ? "Decision note (required to reject)…" : "Decision note (optional)…"}
                  className="h-10 flex-1 rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-[#14171C]"
                />
                <PillButton variant="secondary" className="min-h-10 px-4" disabled={busyId === r.id} onClick={() => onDecide(r.id, "approve", (reasons[r.id] ?? "").trim())}>
                  Approve
                </PillButton>
                <PillButton variant="ghost" className="min-h-10 px-4" disabled={busyId === r.id} onClick={() => onDecide(r.id, "reject", (reasons[r.id] ?? "").trim())}>
                  Reject
                </PillButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="mt-2 text-xs font-medium text-red-600">{error}</p> : null}
    </section>
  );
}

/** Presentational: open appeal queue with Reinstate / Uphold decisions. */
export function AppealQueue({
  rows,
  busyId,
  error,
  onDecide,
}: {
  rows: AdminAppealRow[];
  busyId: string | null;
  error: string | null;
  onDecide: (id: string, action: "reinstate" | "uphold", decisionReason: string) => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const open = rows.filter((r) => r.status === "open");
  const decided = rows.filter((r) => r.status !== "open");
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <h2 className="text-[15px] font-bold text-slate-900">Appeals</h2>
      <p className="mt-0.5 text-xs text-slate-500">Reinstate clears the account's under-review state; uphold keeps it. A reason is required and shown to the appellant.</p>
      {open.length === 0 ? (
        <p className="mt-3 text-[13px] text-slate-500">No open appeals.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {open.map((a) => (
            <li key={a.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800">{a.accountName}</p>
                  <p className="text-xs text-slate-500">{a.accountEmail}</p>
                </div>
                <Chip tone="amber">Open</Chip>
              </div>
              <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] leading-relaxed text-slate-700">{a.reason}</p>
              <div className="mt-2 flex gap-2">
                <input
                  value={reasons[a.id] ?? ""}
                  onChange={(e) => setReasons((m) => ({ ...m, [a.id]: e.target.value }))}
                  placeholder="Decision reason (required, shown to appellant)…"
                  className="h-10 flex-1 rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-[#14171C]"
                />
                <PillButton variant="secondary" className="min-h-10 px-4" disabled={busyId === a.id} onClick={() => onDecide(a.id, "reinstate", (reasons[a.id] ?? "").trim())}>
                  Reinstate
                </PillButton>
                <PillButton variant="ghost" className="min-h-10 px-4" disabled={busyId === a.id} onClick={() => onDecide(a.id, "uphold", (reasons[a.id] ?? "").trim())}>
                  Uphold
                </PillButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {decided.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Recent decisions</h3>
          <ul className="mt-2 space-y-1.5">
            {decided.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-2 text-[12px] text-slate-600">
                <span className="min-w-0 truncate">{a.accountName}</span>
                <span className="shrink-0 font-semibold">{a.status === "reinstated" ? "Reinstated" : "Upheld"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-xs font-medium text-red-600">{error}</p> : null}
    </section>
  );
}

/** Presentational: configurable combined negative-rating + concern threshold. */
export function TrustThresholdEditor({
  threshold,
  busy,
  error,
  onSave,
}: {
  threshold: number;
  busy: boolean;
  error: string | null;
  onSave: (value: number) => void;
}) {
  const [value, setValue] = useState(String(threshold));
  const [localError, setLocalError] = useState<string | null>(null);
  const submit = () => {
    setLocalError(null);
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      setLocalError("Threshold must be a whole number from 1 to 10.");
      return;
    }
    onSave(n);
  };
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <h2 className="text-[15px] font-bold text-slate-900">Under-review threshold</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        An account moves into under-review when its combined negative ratings + open concerns reach this number. Raising
        it never auto-clears — only a reinstate appeal decision does.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="numeric"
          className={`${inputCls} max-w-28`}
          aria-label="Under-review threshold"
        />
        <PillButton variant="primary" className="min-h-11 px-5" disabled={busy} onClick={submit}>
          {busy ? "Saving…" : "Save threshold"}
        </PillButton>
      </div>
      {localError ?? error ? <p role="alert" className="mt-2 text-xs font-medium text-red-600">{localError ?? error}</p> : null}
    </section>
  );
}

/** Container: loads credential queue, appeals, and trust policy (audited). */
export function AdminTrustSection() {
  const [reason, setReason] = useState("");
  const [credentials, setCredentials] = useState<AdminCredentialRow[] | null>(null);
  const [appeals, setAppeals] = useState<AdminAppealRow[] | null>(null);
  const [trust, setTrust] = useState<AdminTrustView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const [c, a, t] = await Promise.all([
      api.adminGetCredentials(reason.trim()),
      api.adminGetAppeals(reason.trim()),
      api.adminGetTrust(reason.trim()),
    ]);
    if (c.ok) setCredentials(c.data.credentials);
    if (a.ok) setAppeals(a.data.appeals);
    if (t.ok) setTrust(t.data);
    if (!c.ok || !a.ok || !t.ok) {
      const first = [c, a, t].find((r) => !r.ok);
      setLoadError(first?.ok ? null : (first?.error.message ?? "Couldn't load trust tools."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reason]);

  useEffect(() => {
    if (reason.trim().length >= 5) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reason]);

  const decideCredential = async (id: string, action: "approve" | "reject", note: string) => {
    setBusyId(id);
    setError(null);
    if (action === "reject" && note.length < 5) {
      setError("A rejection note (5+ chars) is required.");
      setBusyId(null);
      return;
    }
    // The per-row note is the applicant-facing decision reason (stored as the
    // credential's decisionReason); the shared audit reason stays separate in
    // the audited header. Never conflate the two.
    const r = await api.adminDecideCredential(id, action, reason.trim(), note);
    setBusyId(null);
    if (r.ok) await load();
    else setError(r.error.message ?? "Couldn't save the decision.");
  };

  const decideAppeal = async (id: string, action: "reinstate" | "uphold", decisionReason: string) => {
    setBusyId(id);
    setError(null);
    if (decisionReason.length < 5) {
      setError("A decision reason (5+ chars) is required and shown to the appellant.");
      setBusyId(null);
      return;
    }
    const r = await api.adminDecideAppeal(id, action, reason.trim(), decisionReason);
    setBusyId(null);
    if (r.ok) await load();
    else setError(r.error.message ?? "Couldn't save the decision.");
  };

  const saveThreshold = async (value: number) => {
    setError(null);
    const r = await api.adminSetTrustThreshold(value, reason.trim());
    if (r.ok) {
      setTrust((t) => (t ? { ...t, threshold: r.data.threshold } : t));
    } else {
      setError(r.error.message ?? "Couldn't save the threshold.");
    }
  };

  return (
    <section className="mt-8 space-y-4">
      <div>
        <h2 className="text-lg font-extrabold text-slate-900">Community trust & credentials</h2>
        <p className="text-[13px] text-slate-500">Credential verification, appeal decisions, and the under-review threshold. Every action is audited with your reason.</p>
      </div>
      <div>
        <label htmlFor="trust-reason" className="text-xs font-semibold text-slate-600">Audit reason (required for every action below)</label>
        <input
          id="trust-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Reviewing credential queue"
          className={`${inputCls} mt-1`}
        />
      </div>
      {loadError ? <p role="alert" className="text-xs font-medium text-red-600">{loadError}</p> : null}
      {credentials !== null ? (
        <CredentialQueue rows={credentials} busyId={busyId} error={error} onDecide={(id, a, r) => void decideCredential(id, a, r)} />
      ) : null}
      {appeals !== null ? (
        <AppealQueue rows={appeals} busyId={busyId} error={error} onDecide={(id, a, r) => void decideAppeal(id, a, r)} />
      ) : null}
      {trust !== null ? (
        <TrustThresholdEditor threshold={trust.threshold} busy={busyId !== null} error={error} onSave={(v) => void saveThreshold(v)} />
      ) : null}
      {trust && trust.underReview.length > 0 ? (
        <section className="rounded-2xl bg-amber-50 p-5 ring-1 ring-amber-200">
          <h3 className="text-sm font-bold text-amber-900">Accounts under review ({trust.underReview.length})</h3>
          <ul className="mt-2 space-y-1 text-[13px] text-amber-800">
            {trust.underReview.map((u) => (
              <li key={u.accountId} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{u.name}</span>
                <span className="shrink-0 text-xs text-amber-700">{u.email}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
