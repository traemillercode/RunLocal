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
  const todayStr = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [availability, setAvailability] = useState<"checking" | "available" | "unavailable" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [stripeReady, setStripeReady] = useState(false);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState("Copy link");

  useEffect(() => {
    void api.getSponsorPaymentsStatus().then((r) => { if (r.ok) setStripeReady(r.data.configured); });
  }, []);

  // Live availability check whenever tier or dates change - the admin sees
  // a conflict before submitting, matching what the self-serve page shows.
  useEffect(() => {
    if (endDate < startDate) { setAvailability("unavailable"); return; }
    setAvailability("checking");
    let live = true;
    void api.checkSponsorAvailability(cityId, tier, startDate, endDate).then((r) => {
      if (live) setAvailability(r.ok && r.data.available ? "available" : "unavailable");
    });
    return () => { live = false; };
  }, [cityId, tier, startDate, endDate]);

  // Preview only - the server (SPONSOR_DAY_RATE_USD in payments.ts) is the actual source of truth at checkout time. Keep these two in sync if the rates change.
  const dayCount = Math.max(0, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000) + 1);
  const dayRate = tier === "featured" ? 25 : 10;
  const totalPrice = dayCount * dayRate;

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
    const r = await api.adminCreateSponsor({ cityId, tier, businessName: businessName.trim(), tagline: tagline.trim(), linkUrl: linkUrl.trim(), logoRef, active: true, startDate, endDate }, reason.trim());
    setSubmitting(false);
    if (r.ok) onDone();
    else setFormError(r.error.message ?? "Those dates are already booked for this tier.");
  };

  /**
   * Creates the sponsor record inactive first, then hands back a link to
   * its own branded payment page (getkimbio.com/sponsor/:id) - a real page
   * explaining the deal, not a raw stripe.com URL. That page creates the
   * actual Stripe checkout session itself when the business clicks Pay, so
   * generating this link doesn't require Stripe to be configured yet.
   */
  const generateSponsorLink = async () => {
    if (!businessName.trim()) { setFormError("Business name is required."); return; }
    if (!linkUrl.trim()) { setFormError("A link URL is required."); return; }
    setSubmitting(true);
    const created = await api.adminCreateSponsor({ cityId, tier, businessName: businessName.trim(), tagline: tagline.trim(), linkUrl: linkUrl.trim(), logoRef, active: false, startDate, endDate }, reason.trim());
    setSubmitting(false);
    if (!created.ok) { setFormError(created.error.message ?? "Those dates are already booked for this tier."); return; }
    setPaymentLink(`${window.location.origin}/sponsor/${created.data.sponsor.id}`);
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
      <div className="flex gap-2">
        <label className="flex-1"><span className="mb-1 block text-[11px] font-semibold text-slate-500">Start date</span><input type="date" min={todayStr} value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></label>
        <label className="flex-1"><span className="mb-1 block text-[11px] font-semibold text-slate-500">End date</span><input type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} /></label>
      </div>
      <div className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-[13px] font-semibold ${availability === "unavailable" ? "bg-rose-50 text-rose-700" : availability === "available" ? "bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-500"}`}>
        <span>{dayCount} day{dayCount === 1 ? "" : "s"} · ${totalPrice} total</span>
        <span>{availability === "checking" ? "Checking…" : availability === "available" ? "Dates open ✓" : availability === "unavailable" ? "Already booked" : ""}</span>
      </div>
      <input className={inputCls} placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
      <input className={inputCls} placeholder="Tagline (optional)" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={120} />
      <input className={inputCls} placeholder="https://…" inputMode="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
      <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-600">
        <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); }} />
        <span className="cursor-pointer rounded-full bg-slate-100 px-3 py-1.5">{logoRef ? "Logo uploaded ✓" : "Upload logo (optional)"}</span>
      </label>
      {formError ? <p role="alert" className="text-[13px] font-semibold text-rose-700">{formError}</p> : null}
      {paymentLink ? (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          <p className="text-[12px] font-semibold text-slate-600">Send this link to the business — it opens a Kimbio page explaining their placement, and the spot activates automatically once they pay.</p>
          <div className="flex items-center gap-2">
            <input readOnly value={paymentLink} className="h-9 flex-1 truncate rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] text-slate-700" />
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(paymentLink); setCopyLabel("Copied ✓"); setTimeout(() => setCopyLabel("Copy link"), 2000); }}
              className="shrink-0 rounded-lg bg-[#14171C] px-3 py-1.5 text-[12px] font-bold text-white"
            >
              {copyLabel}
            </button>
          </div>
          <PillButton variant="ghost" onClick={onDone} className="w-full">Done — it's listed as pending until paid</PillButton>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <PillButton variant="ghost" onClick={onCancel} className="flex-1">Cancel</PillButton>
            <PillButton variant="ghost" disabled={submitting || availability === "unavailable"} onClick={() => void submit()} className="flex-1">
              {submitting ? "Adding…" : "Add now (mark active)"}
            </PillButton>
          </div>
          <PillButton variant="primary" disabled={submitting || availability === "unavailable"} onClick={() => void generateSponsorLink()} className="w-full">
            {submitting ? "Generating…" : "Generate sponsor page link"}
          </PillButton>
          {!stripeReady ? (
            <p className="text-center text-[11px] text-slate-400">Note: add STRIPE_SECRET_KEY on Railway before sending this — the business's "Pay" button needs it to actually charge a card.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
