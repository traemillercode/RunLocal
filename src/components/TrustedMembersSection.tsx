/**
 * Trusted Member (manual trust / blue-check) admin panel — Task 7 slice 1.
 *
 * One compact surface for both admin identities: a Global Admin sees every
 * trusted member across all cities; a City Admin sees only their enforced
 * scope city (the server enforces that boundary on every call — this UI just
 * picks the right endpoint). Grant is by account email, revoke per roster
 * row. Every action is reason-required and audited; the reason input is
 * shared by the whole panel.
 */
import { useCallback, useEffect, useState } from "react";
import * as api from "../lib/api";
import { Icon, PillButton } from "./ui";

const inputCls =
  "h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";

export function TrustedMembersSection({ isCityAdmin }: { isCityAdmin: boolean }) {
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [members, setMembers] = useState<api.TrustedMemberRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** "grant" or the accountId being revoked — disables that row while in flight. */
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = isCityAdmin ? await api.cityGetTrustedMembers("") : await api.adminGetTrustedMembers("");
    if (r.ok) setMembers(r.data.members);
    else setError(r.error.message ?? "Couldn't load trusted members.");
  }, [isCityAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const grant = async () => {
    if (reason.trim().length < 5) {
      setError("An audit reason (min 5 characters) is required for every action.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter the member's account email.");
      return;
    }
    setBusy("grant");
    const r = isCityAdmin ? await api.cityGrantTrust(email.trim(), reason.trim()) : await api.adminGrantTrust(email.trim(), reason.trim());
    setBusy(null);
    if (r.ok) {
      setEmail("");
      await load();
    } else {
      setError(r.error.message ?? "Couldn't grant the badge.");
    }
  };

  const revoke = async (accountId: string) => {
    if (reason.trim().length < 5) {
      setError("An audit reason (min 5 characters) is required for every action.");
      return;
    }
    setBusy(accountId);
    const r = isCityAdmin ? await api.cityRevokeTrust(accountId, reason.trim()) : await api.adminRevokeTrust(accountId, reason.trim());
    setBusy(null);
    if (r.ok) await load();
    else setError(r.error.message ?? "Couldn't revoke the badge.");
  };

  return (
    <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-bold text-slate-900">Trusted members</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Manual trust / blue-check foundation. Granted only to fully identity-verified members — never pending
            accounts, never by an admin on their own account{isCityAdmin ? ", and only within your enforced scope city" : ""}.
            Every action is audited with your reason.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sky-700">
          {isCityAdmin ? "City scope" : "All cities"}
        </span>
      </div>
      <div className="mt-3">
        <label htmlFor="trusted-reason" className="text-xs font-semibold text-slate-600">
          Audit reason (required for grant and revoke)
        </label>
        <input
          id="trusted-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Confirmed long-standing local member in person"
          className={`${inputCls} mt-1`}
        />
      </div>
      <div className="mt-3 flex gap-2">
        <input
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Member email to grant…"
          aria-label="Member email to grant"
          className={inputCls}
        />
        <PillButton variant="primary" className="shrink-0 px-4" disabled={busy === "grant"} onClick={() => void grant()}>
          {busy === "grant" ? "…" : <Icon name="check" className="h-4 w-4" />} Grant
        </PillButton>
      </div>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-[13px] text-red-700">{error}</p> : null}
      <ul className="mt-4 divide-y divide-slate-100">
        {members === null ? (
          <li className="py-3 text-sm text-slate-500">Loading…</li>
        ) : members.length === 0 ? (
          <li className="py-3 text-sm text-slate-500">No trusted members yet.</li>
        ) : (
          members.map((m) => (
            <li key={m.accountId} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-800">{m.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {m.email}
                  {m.cityId ? ` · ${m.cityId}` : ""}
                </span>
              </span>
              <button
                type="button"
                disabled={busy === m.accountId}
                onClick={() => void revoke(m.accountId)}
                className="min-h-9 shrink-0 rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-600 active:bg-slate-200 disabled:opacity-50"
              >
                {busy === m.accountId ? "…" : "Revoke"}
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
