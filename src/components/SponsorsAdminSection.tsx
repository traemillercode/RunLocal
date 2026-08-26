import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { Icon, PillButton } from "./ui";

const TIER_CAPS = { featured: 1, standard: 3 } as const;

/**
 * Owner-only sponsor placement management. Real add/edit/delete — this is
 * the template for "Confirm Delete" done properly: an explicit destructive
 * action with its own confirm step, not a notes-field workaround.
 */
export function SponsorsAdminSection({ cityId, reason }: { cityId: string; reason: string }) {
  const [sponsors, setSponsors] = useState<api.AdminSponsorView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!reason.trim() || reason.trim().length < 5) return;
    void api.adminListSponsors(cityId, reason.trim()).then((r) => {
      if (r.ok) setSponsors(r.data.sponsors);
      else setError(r.error.message ?? "Couldn't load sponsors.");
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cityId]);

  const featuredCount = sponsors?.filter((s) => s.tier === "featured" && s.active).length ?? 0;
  const standardCount = sponsors?.filter((s) => s.tier === "standard" && s.active).length ?? 0;

  const toggleActive = async (s: api.AdminSponsorView) => {
    if (!reason.trim() || reason.trim().length < 5) { setError("Enter a reason (min 5 characters) above first."); return; }
    setBusy(true);
    const r = await api.adminUpdateSponsor(s.id, { active: !s.active }, reason.trim());
    setBusy(false);
    if (r.ok) load();
    else setError(r.error.message ?? "That tier may already be full.");
  };

  const confirmDelete = async (id: string) => {
    if (!reason.trim() || reason.trim().length < 5) { setError("Enter a reason (min 5 characters) above first."); return; }
    setBusy(true);
    const r = await api.adminDeleteSponsor(id, reason.trim());
    setBusy(false);
    setConfirmDeleteId(null);
    if (r.ok) load();
    else setError(r.error.message ?? "Delete failed.");
  };

  return (
    <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-slate-900">Sponsor placements</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Featured {featuredCount}/{TIER_CAPS.featured} · Standard {standardCount}/{TIER_CAPS.standard} — sold and set up manually, no self-serve ad platform.
          </p>
        </div>
        <PillButton
          variant="secondary"
          className="min-h-9 shrink-0 px-3 text-xs"
          onClick={() => { if (!reason.trim() || reason.trim().length < 5) { setError("Enter a reason (min 5 characters) above first."); return; } setError(null); setFormOpen(true); }}
        >
          <Icon name="plus" className="h-3.5 w-3.5" /> Add
        </PillButton>
      </div>

      {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-[13px] font-semibold text-rose-800">{error}</p> : null}

      {sponsors === null ? (
        <p className="mt-3 text-sm text-slate-500">Enter a reason above to load sponsors.</p>
      ) : sponsors.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No sponsor placements yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {sponsors.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
              {s.logoUrl ? (
                <img src={s.logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">
                  {s.businessName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-bold text-slate-900">{s.businessName}</span>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${s.tier === "featured" ? "bg-[#FF5741]/15 text-[#14171C]" : "bg-slate-100 text-slate-500"}`}>
                    {s.tier}
                  </span>
                </div>
                <p className="truncate text-[11px] text-slate-400">{s.linkUrl}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void toggleActive(s)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${s.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}
              >
                {s.active ? "Active" : "Off"}
              </button>
              {confirmDeleteId === s.id ? (
                <span className="flex shrink-0 items-center gap-1">
                  <button type="button" disabled={busy} onClick={() => void confirmDelete(s.id)} className="rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white">
                    Confirm delete
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className="rounded-full px-2 py-1 text-[11px] font-semibold text-slate-500">
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmDeleteId(s.id)} className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete ${s.businessName}`}>
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {formOpen ? (
        <NewSponsorForm
          cityId={cityId}
          reason={reason}
          onDone={() => { setFormOpen(false); load(); }}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}
    </section>
  );
}

function NewSponsorForm({ cityId, reason, onDone, onCancel }: { cityId: string; reason: string; onDone: () => void; onCancel: () => void }) {
  const [tier, setTier] = useState<"featured" | "standard">("standard");
  const [businessName, setBusinessName] = useState("");
  const [tagline, setTagline] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [logoRef, setLogoRef] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleLogoFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      void api.adminUploadSponsorLogo(reader.result as string, reason.trim()).then((r) => {
        if (r.ok) setLogoRef(r.data.logoRef);
        else setFormError(r.error.message ?? "Logo upload failed.");
      });
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!businessName.trim()) { setFormError("Business name is required."); return; }
    if (!linkUrl.trim()) { setFormError("A link URL is required."); return; }
    setSubmitting(true);
    const r = await api.adminCreateSponsor({ cityId, tier, businessName: businessName.trim(), tagline: tagline.trim(), linkUrl: linkUrl.trim(), logoRef, active: true }, reason.trim());
    setSubmitting(false);
    if (r.ok) onDone();
    else setFormError(r.error.message ?? "That tier is full — deactivate one first.");
  };

  const inputCls = "h-11 w-full rounded-xl border border-slate-200 px-3.5 text-[15px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-slate-200 p-4">
      <div className="flex gap-2">
        {(["standard", "featured"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTier(t)}
            className={`min-h-9 flex-1 rounded-full text-[13px] font-bold ${tier === t ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-500"}`}
          >
            {t === "featured" ? "Featured (1 slot)" : "Standard (3 slots)"}
          </button>
        ))}
      </div>
      <input className={inputCls} placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
      <input className={inputCls} placeholder="Tagline (optional)" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={120} />
      <input className={inputCls} placeholder="https://…" inputMode="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
      <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-600">
        <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); }} />
        <span className="cursor-pointer rounded-full bg-slate-100 px-3 py-1.5">{logoRef ? "Logo uploaded ✓" : "Upload logo (optional)"}</span>
      </label>
      {formError ? <p role="alert" className="text-[13px] font-semibold text-rose-700">{formError}</p> : null}
      <div className="flex gap-2">
        <PillButton variant="ghost" onClick={onCancel} className="flex-1">Cancel</PillButton>
        <PillButton variant="primary" disabled={submitting} onClick={() => void submit()} className="flex-1">
          {submitting ? "Adding…" : "Add sponsor"}
        </PillButton>
      </div>
    </div>
  );
}
