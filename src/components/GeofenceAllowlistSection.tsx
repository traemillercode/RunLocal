import { useState } from "react";
import * as api from "../lib/api";
import { Icon, PillButton } from "./ui";

/**
 * Owner-only: manage which specific email addresses bypass the 20-mile
 * geofence entirely - e.g. someone who lives just outside the radius, or a
 * remote partner who needs full access. This is separate from the owner's
 * own automatic exemption. Real "Confirm Delete" pattern for removal, same
 * as sponsors: explicit confirm/cancel, not a notes-field workaround.
 */
export function GeofenceAllowlistSection({ reason }: { reason: string }) {
  const [emails, setEmails] = useState<string[] | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = () => {
    if (!reason.trim() || reason.trim().length < 5) return;
    void api.adminListGeofenceAllowlist(reason.trim()).then((r) => {
      if (r.ok) setEmails(r.data.emails);
      else setError(r.error.message ?? "Couldn't load the allowlist.");
    });
  };

  const add = async () => {
    const email = newEmail.trim();
    if (!email || !email.includes("@")) { setError("Enter a valid email address."); return; }
    if (!reason.trim() || reason.trim().length < 5) { setError("Enter a reason above first."); return; }
    setBusy(true);
    const r = await api.adminAddGeofenceAllowlistEmail(email, reason.trim());
    setBusy(false);
    if (r.ok) { setEmails(r.data.emails); setNewEmail(""); setError(null); }
    else setError(r.error.message ?? "Couldn't add that email.");
  };

  const remove = async (email: string) => {
    if (!reason.trim() || reason.trim().length < 5) { setError("Enter a reason above first."); return; }
    setBusy(true);
    const r = await api.adminRemoveGeofenceAllowlistEmail(email, reason.trim());
    setBusy(false);
    setConfirmRemove(null);
    if (r.ok) setEmails(r.data.emails);
    else setError(r.error.message ?? "Remove failed.");
  };

  return (
    <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-slate-900">Geofence allowlist</h2>
          <p className="mt-0.5 text-xs text-slate-500">These emails can use the app in full from anywhere, no matter their location.</p>
        </div>
        {emails === null ? (
          <PillButton variant="ghost" className="min-h-9 shrink-0 px-3 text-xs" onClick={load}>Load</PillButton>
        ) : null}
      </div>

      {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-[13px] font-semibold text-rose-800">{error}</p> : null}

      {emails !== null ? (
        <>
          <div className="mt-3 flex gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="someone@example.com"
              className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
            />
            <PillButton variant="primary" className="min-h-10 shrink-0 px-3 text-xs" disabled={busy} onClick={() => void add()}>Add</PillButton>
          </div>

          {emails.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No exemptions yet — everyone else follows the normal 20-mile rule.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {emails.map((email) => (
                <li key={email} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                  <span className="truncate text-[13px] font-semibold text-slate-700">{email}</span>
                  {confirmRemove === email ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <button type="button" disabled={busy} onClick={() => void remove(email)} className="rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white">
                        Confirm remove
                      </button>
                      <button type="button" onClick={() => setConfirmRemove(null)} className="rounded-full px-2 py-1 text-[11px] font-semibold text-slate-500">
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirmRemove(email)} className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${email}`}>
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
