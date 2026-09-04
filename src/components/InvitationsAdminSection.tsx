import { Fragment, useCallback, useEffect, useState } from "react";
import * as api from "../lib/api";
import { Icon } from "./ui";

/**
 * Mint, list and revoke invitations.
 *
 * NO EMAIL SENDING, deliberately. The confirmation mail already hit one junk
 * folder and two .edu addresses that never confirmed — for ten people the
 * operator knows personally, a text they can see delivered beats an email they
 * cannot. So this produces a LINK to copy, and skips the template, the Resend
 * call, and the resend path entirely.
 *
 * The raw token is returned exactly once by the server (only its hash is
 * stored), so it is surfaced immediately and prominently. Navigating away
 * before copying loses it and the invitation must be re-minted.
 */
export function InvitationsAdminSection({ cityId }: { cityId: string }) {
  const [rows, setRows] = useState<api.InvitationView[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The one-time link for the invitation just minted. */
  const [minted, setMinted] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    void api.listInvitations(cityId).then((r) => {
      if (r.ok) setRows(r.data.invitations);
      else setError(r.error.message);
    });
  }, [cityId]);

  useEffect(load, [load]);

  const mint = async () => {
    const target = email.trim().toLowerCase();
    if (!target) return;
    /*
     * If a usable invitation already exists for this address, surface ITS link
     * rather than creating a second. Minting reported a false error once and
     * produced two invitations for the same person; the duplicate was the
     * user's reasonable response to a lie, so the fix belongs here as well as
     * in the error handling.
     */
    const existing = (rows ?? []).find((i) => i.email === target && i.valid && !i.usedAt && i.token);
    if (existing) {
      setMinted({ email: target, url: api.invitationUrl(target, existing.token!) });
      setCopied(false);
      setEmail("");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await api.createInvitation({ cityId, email: target });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setMinted({ email: target, url: api.invitationUrl(target, r.data.token) });
    setCopied(false);
    setEmail("");
    load();
  };

  const copy = async () => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.url);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the input below is selectable as a fallback,
      // which is why the URL is rendered in a field rather than as plain text.
      setCopied(false);
    }
  };

  const revoke = async (id: string) => {
    const r = await api.revokeInvitation(id);
    if (!r.ok) { setError(r.error.message); return; }
    load();
  };

  /** One word for the row's state, in priority order — used beats revoked beats expired. */
  const statusOf = (i: api.InvitationView): { label: string; tone: string } => {
    if (i.usedAt) return { label: "Used", tone: "bg-emerald-100 text-emerald-800" };
    if (i.revokedAt) return { label: "Revoked", tone: "bg-slate-100 text-slate-600" };
    if (!i.valid) return { label: "Expired", tone: "bg-amber-100 text-amber-800" };
    return { label: "Unused", tone: "bg-[#FF5741]/15 text-[#14171C]" };
  };

  return (
    <section className="mt-8" aria-labelledby="invites-heading">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Beta</p>
      <h2 id="invites-heading" className="mt-1 text-lg font-extrabold text-slate-900">Invitations</h2>
      <p className="mt-1 text-[13px] text-slate-500">
        Mint a link and send it however you like. Nothing is emailed from here.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="runner@example.com"
          aria-label="Email address to invite"
          className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3.5 text-[15px] outline-none focus:border-[#14171C]"
        />
        <button
          type="button"
          onClick={() => void mint()}
          disabled={busy || !email.trim()}
          className="h-11 shrink-0 rounded-xl bg-[#14171C] px-4 text-[14px] font-bold text-white disabled:opacity-40"
        >
          {busy ? "Minting…" : "Mint link"}
        </button>
      </div>

      {error ? <p className="mt-2 text-[13px] font-semibold text-rose-600">{error}</p> : null}

      {minted ? (
        <div className="mt-4 rounded-xl bg-[#FF5741]/10 p-4 ring-1 ring-[#FF5741]/30">
          <p className="text-[13px] font-bold text-[#14171C]">Link for {minted.email}</p>
          {/* Shown once — the server stores only a hash, so navigating away
              before copying means re-minting. Said plainly rather than left to
              be discovered. */}
          <p className="mt-0.5 text-[12px] text-slate-600">Send this however you like — text, DM, email.</p>
          <div className="mt-2 flex gap-2">
            <input
              readOnly
              value={minted.url}
              aria-label="Invitation link"
              onFocus={(e) => e.currentTarget.select()}
              className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 font-mono text-[12px]"
            />
            <button type="button" onClick={() => void copy()} className="h-11 shrink-0 rounded-xl bg-[#14171C] px-4 text-[14px] font-bold text-white">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {/* Dismissed only on request. It was transient before, so an error
              during minting — or a refresh — stranded a valid invitation with
              no way to recover its link. */}
          <button type="button" onClick={() => setMinted(null)} className="mt-2 h-11 text-[13px] font-bold text-slate-600">
            Done
          </button>
        </div>
      ) : null}

      <ul className="mt-5 space-y-1.5">
        {rows === null ? (
          <li className="text-[13px] text-slate-400">Loading…</li>
        ) : rows.length === 0 ? (
          <li className="rounded-xl bg-slate-50 px-4 py-3 text-[13px] text-slate-500">No invitations yet.</li>
        ) : (
          rows.map((i, idx) => {
            const s = statusOf(i);
            /*
             * "EARLIER" DIVIDER, at the point the list stops being actionable.
             *
             * The server sorts unused invitations first, so the boundary is
             * wherever the first non-actionable row lands — computed from the
             * data rather than from a count, which means it stays correct when
             * one is revoked or redeemed without anything being recalculated.
             *
             * Nothing is hidden. An invitation revoked last week is still
             * findable, because "was this address ever invited" is a question
             * worth being able to answer in six months.
             */
            const actionable = (r: typeof i) => !r.usedAt && !r.revokedAt && r.valid;
            const isFirstEarlier = !actionable(i) && (idx === 0 || actionable(rows[idx - 1]));
            return (
              /* Fragment needs the key, not the children — a bare <> in a map
                 loses it and React warns on every render. */
              <Fragment key={i.id}>
              {isFirstEarlier ? (
                <li className="flex items-center gap-3 pt-3 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  <span>Earlier</span>
                  <span className="h-px flex-1 bg-slate-200" />
                </li>
              ) : null}
              <li className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200/70">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-slate-900">{i.email}</span>
                  <span className="block text-[12px] text-slate-500">
                    {i.usedAt ? `Joined ${new Date(i.usedAt).toLocaleDateString()}` : `Expires ${new Date(i.expiresAt).toLocaleDateString()}`}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${s.tone}`}>{s.label}</span>
                {/* Revoke only where it can do something. A used invitation
                    cannot be un-redeemed, and offering the button would be a
                    control that looks like it works. */}
                {/* Every unredeemed row can reproduce its link. Previously the
                    token existed only in the one-time panel, so a refresh left
                    the invitation valid, unshareable and — because revoke was
                    also broken — unremovable. */}
                {i.valid && !i.usedAt && i.token ? (
                  <button
                    type="button"
                    onClick={() => { setMinted({ email: i.email, url: api.invitationUrl(i.email, i.token!) }); setCopied(false); }}
                    className="h-11 shrink-0 rounded-full px-3 text-[13px] font-bold text-[#FF5741]"
                  >
                    Copy link
                  </button>
                ) : null}
                {i.valid && !i.usedAt ? (
                  <button
                    type="button"
                    onClick={() => void revoke(i.id)}
                    aria-label={`Revoke the invitation for ${i.email}`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
                  >
                    <Icon name="close" className="h-4 w-4" />
                  </button>
                ) : null}
              </li>
              </Fragment>
            );
          })
        )}
      </ul>
    </section>
  );
}
