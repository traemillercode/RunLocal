/**
 * Profile trust & credentials surface (client side).
 *
 * Privacy contract enforced at every layer of this UI:
 *  - Shows ONLY the signed-in user's OWN credential rows; proof files open on
 *    protected owner-only routes (never embedded, never shared).
 *  - Trust data is QUALITATIVE only: tier label, coach/host booleans, and
 *    recognition roles. Never counts, scores, reviewer identities, or reports.
 *  - Under-review state is the account's own state (from /api/me) and the
 *    qualitative trust payload; the restrictions copy is plain-language.
 */
import { useEffect, useState } from "react";
import * as api from "../lib/api";
import type { AppealView, CredentialStatus, CredentialType, CredentialView, PublicTrustView } from "../lib/api";
import { credentialProofUrl } from "../lib/api";
import { Chip, Icon, PillButton } from "./ui";

export const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  coach_certification: "Coach certification",
  first_aid_cpr: "First aid / CPR",
};

export const CREDENTIAL_STATUS_LABELS: Record<CredentialStatus, { label: string; cls: string }> = {
  pending_review: { label: "Pending review", cls: "bg-amber-100 text-amber-800" },
  verified: { label: "Verified", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-700" },
  expired: { label: "Expired", cls: "bg-slate-200 text-slate-600" },
};

export const TIER_LABELS: Record<PublicTrustView["tier"], string> = {
  new: "New to the community",
  recognized: "Recognized",
  "well-regarded": "Well-regarded",
};

const TIER_TEXT: Record<PublicTrustView["tier"], string> = {
  new: "New to the community",
  recognized: "Recognized in the community",
  "well-regarded": "Well-regarded in the community",
};

export function TrustSummary({ trust }: { trust: PublicTrustView }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip tone={trust.tier === "well-regarded" ? "brand" : trust.tier === "recognized" ? "volt" : "outline"}>
        <Icon name="shield" className="h-3 w-3" /> {TIER_TEXT[trust.tier]}
      </Chip>
      {trust.coach ? (
        <Chip tone="sky">
          <Icon name="flag" className="h-3 w-3" /> Recognized coach
        </Chip>
      ) : null}
      {trust.host ? (
        <Chip tone="emerald">
          <Icon name="users" className="h-3 w-3" /> Recognized host
        </Chip>
      ) : null}
      {trust.recognitions.length === 0 ? null : (
        <span className="text-[11px] text-slate-400">Qualitative view — no scores, no rankings.</span>
      )}
    </div>
  );
}

/** The signed-in user's own credential rows (server returns only their own). */
export function CredentialList({ credentials }: { credentials: CredentialView[] }) {
  if (credentials.length === 0) {
    return (
      <p className="mt-3 text-[13px] text-slate-500">
        No credentials on file yet. Add a coach certification or first aid / CPR credential below.
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-2.5">
      {credentials.map((c) => {
        const st = CREDENTIAL_STATUS_LABELS[c.status] ?? CREDENTIAL_STATUS_LABELS.pending_review;
        return (
          <li key={c.id} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-slate-800">{CREDENTIAL_TYPE_LABELS[c.type] ?? c.type}</p>
                <p className="truncate text-xs text-slate-500">{c.certifyingBody}</p>
                {c.expiresOn ? <p className="text-[11px] text-slate-400">Expires {c.expiresOn}</p> : null}
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${st.cls}`}>{st.label}</span>
            </div>
            {c.status === "rejected" && c.decisionReason ? (
              <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[12px] leading-relaxed text-red-700">
                <span className="font-semibold">Why it was rejected:</span> {c.decisionReason}
              </p>
            ) : null}
            {c.hasProof ? (
              <a
                href={credentialProofUrl(c.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-[#0b2b22] underline decoration-[#c8f169] decoration-2 underline-offset-2"
              >
                <Icon name="external" className="h-3.5 w-3.5" /> View proof (private, owner-only)
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export interface CredentialDraft {
  type: CredentialType;
  certifyingBody: string;
  issuedOn?: string;
  expiresOn?: string;
  proof?: string;
  proofMime?: string;
}

export function CredentialSubmitForm({
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (draft: CredentialDraft) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<CredentialType>("coach_certification");
  const [body, setBody] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [proofName, setProofName] = useState<string | null>(null);
  const [proofData, setProofData] = useState<{ data: string; mime: string } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const pickFile = (file: File | null) => {
    setProofName(null);
    setProofData(null);
    setLocalError(null);
    if (!file) return;
    const mime = file.type === "application/pdf" || file.type === "image/jpeg" || file.type === "image/png" ? file.type : "";
    if (!mime) {
      setLocalError("Proof must be a PDF, JPEG, or PNG.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProofName(file.name);
      setProofData({ data: String(reader.result ?? ""), mime });
    };
    reader.onerror = () => setLocalError("Couldn't read that file — try again.");
    reader.readAsDataURL(file);
  };

  const submit = () => {
    setLocalError(null);
    if (!body.trim()) {
      setLocalError("Certifying body is required (e.g. RRCA, American Red Cross).");
      return;
    }
    if (type === "coach_certification" && !proofData) {
      setLocalError("Coach certifications need a proof file (PDF, JPEG, or PNG).");
      return;
    }
    onSubmit({
      type,
      certifyingBody: body.trim(),
      issuedOn: issuedOn || undefined,
      expiresOn: expiresOn || undefined,
      proof: proofData?.data,
      proofMime: proofData?.mime,
    });
  };

  const inputCls =
    "h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0b2b22] focus:ring-2 focus:ring-[#c8f169]/60";

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label htmlFor="cred-type" className="text-xs font-semibold text-slate-600">Credential type</label>
        <select
          id="cred-type"
          value={type}
          onChange={(e) => setType(e.target.value as CredentialType)}
          className={inputCls}
        >
          <option value="coach_certification">Coach certification</option>
          <option value="first_aid_cpr">First aid / CPR</option>
        </select>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          {type === "coach_certification"
            ? "Upload your certification document — it goes to manual admin review and your proof stays private."
            : "First aid / CPR with a proof file is reviewed by an admin; without one it's marked verified (self-attested)."}
        </p>
      </div>
      <div>
        <label htmlFor="cred-body" className="text-xs font-semibold text-slate-600">Certifying body</label>
        <input
          id="cred-body"
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="e.g. RRCA, American Red Cross"
          className={inputCls}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="cred-issued" className="text-xs font-semibold text-slate-600">Issued (optional)</label>
          <input id="cred-issued" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="cred-expires" className="text-xs font-semibold text-slate-600">Expires (optional)</label>
          <input id="cred-expires" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div>
        <label htmlFor="cred-proof" className="text-xs font-semibold text-slate-600">
          Proof file {type === "coach_certification" ? "(required)" : "(optional)"}
        </label>
        <input
          id="cred-proof"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          className="block w-full text-[13px] text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-[#0b2b22] file:px-4 file:py-2 file:text-[13px] file:font-semibold file:text-white"
        />
        {proofName ? <p className="mt-1 text-[11px] text-emerald-700">Selected: {proofName}</p> : null}
      </div>
      {localError ?? error ? (
        <p role="alert" className="text-xs font-medium text-red-600">{localError ?? error}</p>
      ) : null}
      <div className="flex gap-2">
        <PillButton variant="primary" className="flex-1" disabled={busy} onClick={submit}>
          {busy ? "Submitting…" : "Submit for review"}
        </PillButton>
        <PillButton variant="ghost" onClick={onCancel}>Cancel</PillButton>
      </div>
    </div>
  );
}

/** Plain-language under-review notice (the account's own state). */
export function UnderReviewBanner({ trust }: { trust: PublicTrustView }) {
  return (
    <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-800">
          <Icon name="clock" className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-amber-900">Account under community review</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-amber-800">
            You can still browse, RSVP, and comment. Hosting events and posting club or coach content are paused while
            your account is reviewed. If you believe this is a mistake, file an appeal below — an admin will review it.
          </p>
          {trust.restrictions ? (
            <ul className="mt-2 space-y-1 text-[12px] font-semibold text-amber-800">
              <li>{trust.restrictions.hosting ? "● Hosting: paused" : "● Hosting: available"}</li>
              <li>{trust.restrictions.coachPost ? "● Club / coach posting: paused" : "● Club / coach posting: available"}</li>
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** The account's own appeal history (statuses + decision reasons only). */
export function AppealHistory({ appeals }: { appeals: AppealView[] }) {
  if (appeals.length === 0) return null;
  const st: Record<AppealView["status"], { label: string; cls: string }> = {
    open: { label: "Open", cls: "bg-amber-100 text-amber-800" },
    reinstated: { label: "Reinstated", cls: "bg-emerald-100 text-emerald-800" },
    upheld: { label: "Upheld", cls: "bg-red-100 text-red-700" },
  };
  return (
    <ul className="mt-3 space-y-2">
      {appeals.map((a) => {
        const s = st[a.status];
        return (
          <li key={a.id} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px] leading-relaxed text-slate-700">{a.reason}</p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.cls}`}>{s.label}</span>
            </div>
            {a.status !== "open" && a.decisionReason ? (
              <p className="mt-1.5 text-[12px] text-slate-500">
                <span className="font-semibold">Admin decision:</span> {a.decisionReason}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function AppealForm({ busy, error, onSubmit }: { busy: boolean; error: string | null; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const submit = () => {
    setLocalError(null);
    if (reason.trim().length < 5) {
      setLocalError("Explain your appeal (at least 5 characters).");
      return;
    }
    onSubmit(reason.trim());
  };
  return (
    <div className="mt-3">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={500}
        placeholder="Tell an admin what happened and why the review should be reconsidered…"
        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-[14px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0b2b22] focus:ring-2 focus:ring-[#c8f169]/60"
      />
      {localError ?? error ? (
        <p role="alert" className="mt-1 text-xs font-medium text-red-600">{localError ?? error}</p>
      ) : null}
      <PillButton variant="secondary" className="mt-2 w-full" disabled={busy} onClick={submit}>
        {busy ? "Submitting…" : "File appeal"}
      </PillButton>
    </div>
  );
}

/**
 * Container: fetches the signed-in user's own credentials, qualitative trust
 * view, and appeals. Renders the presentational pieces above. Mounted only
 * for signed-in accounts; the server decides what this user may see.
 */
export function TrustProfileSection({ me }: { me: { id: string; name: string; email: string; underReview: boolean } }) {
  const [credentials, setCredentials] = useState<CredentialView[] | null>(null);
  const [trust, setTrust] = useState<PublicTrustView | null>(null);
  const [appeals, setAppeals] = useState<AppealView[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealError, setAppealError] = useState<string | null>(null);

  const load = async () => {
    const [c, t, a] = await Promise.all([api.getMyCredentials(), api.getPublicTrust(me.id), api.getMyAppeals()]);
    if (c.ok) setCredentials(c.data.credentials);
    if (t.ok) setTrust(t.data);
    if (a.ok) setAppeals(a.data.appeals);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id]);

  const submitCredential = async (draft: CredentialDraft) => {
    setBusy(true);
    setError(null);
    const r = await api.submitCredential(draft);
    setBusy(false);
    if (r.ok) {
      setFormOpen(false);
      await load();
    } else if (r.error.code === "proof_required") {
      setError("Coach certifications need a proof file (PDF, JPEG, or PNG).");
    } else {
      setError(r.error.message ?? "Couldn't submit the credential. Try again.");
    }
  };

  const submitAppeal = async (reason: string) => {
    setAppealBusy(true);
    setAppealError(null);
    const r = await api.submitAppeal(reason);
    setAppealBusy(false);
    if (r.ok) {
      await load();
    } else {
      setAppealError(r.error.message ?? "Couldn't file the appeal. Try again.");
    }
  };

  return (
    <>
      {me.underReview && trust ? <UnderReviewBanner trust={trust} /> : null}

      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
        <h2 className="text-[15px] font-bold text-slate-900">Community trust</h2>
        <p className="mt-0.5 text-xs text-slate-500">Qualitative view — no scores, counts, or rankings.</p>
        <div className="mt-2.5">
          {trust ? <TrustSummary trust={trust} /> : <p className="text-[13px] text-slate-400">Loading…</p>}
        </div>
      </section>

      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Credentials</h2>
            <p className="mt-0.5 text-xs text-slate-500">Coach certifications & first aid / CPR. Proof stays private.</p>
          </div>
          {!formOpen ? (
            <button
              type="button"
              onClick={() => {
                setFormOpen(true);
                setError(null);
              }}
              className="shrink-0 rounded-full bg-[#0b2b22] px-4 py-2 text-[13px] font-semibold text-white active:bg-[#124d3c]"
            >
              Add credential
            </button>
          ) : null}
        </div>
        {credentials === null ? (
          <p className="mt-3 text-[13px] text-slate-400">Loading…</p>
        ) : (
          <CredentialList credentials={credentials} />
        )}
        {formOpen ? (
          <CredentialSubmitForm busy={busy} error={error} onSubmit={(d) => void submitCredential(d)} onCancel={() => setFormOpen(false)} />
        ) : null}
      </section>

      {me.underReview ? (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <h2 className="text-[15px] font-bold text-slate-900">Appeal the review</h2>
          <p className="mt-0.5 text-xs text-slate-500">An admin will review your appeal and decide to reinstate or uphold.</p>
          <AppealHistory appeals={appeals ?? []} />
          <AppealForm busy={appealBusy} error={appealError} onSubmit={(r) => void submitAppeal(r)} />
        </section>
      ) : null}
    </>
  );
}
