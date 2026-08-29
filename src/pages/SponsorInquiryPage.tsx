import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../lib/api";
import { PillButton } from "../components/ui";

const DAY_RATE = { featured: 25, standard: 10 } as const;

/**
 * Self-serve sponsor booking — a business picks a tier and dates, sees
 * real-time availability and price, fills in their info, and submits
 * directly. This creates a pending booking and hands off to the branded
 * payment page (SponsorPaymentPage) to actually pay. The owner can still
 * block off dates manually in Admin for a specific sponsor - this page is
 * just the default path so most bookings never need the owner in the loop.
 */
export function SponsorInquiryPage() {
  const navigate = useNavigate();
  const cityId = "columbia-mo";
  const todayStr = new Date().toISOString().slice(0, 10);

  const [tier, setTier] = useState<"featured" | "standard">("standard");
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [availability, setAvailability] = useState<"checking" | "available" | "unavailable" | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [tagline, setTagline] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [logoRef, setLogoRef] = useState<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (endDate < startDate) { setAvailability("unavailable"); return; }
    setAvailability("checking");
    let live = true;
    void api.checkSponsorAvailability(cityId, tier, startDate, endDate).then((r) => {
      if (live) setAvailability(r.ok && r.data.available ? "available" : "unavailable");
    });
    return () => { live = false; };
  }, [tier, startDate, endDate]);

  const dayCount = Math.max(0, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000) + 1);
  const totalPrice = dayCount * DAY_RATE[tier];

  const handleLogoFile = (file: File) => {
    setLogoUploading(true);
    setLogoPreviewUrl(URL.createObjectURL(file));
    const reader = new FileReader();
    reader.onload = () => {
      void api.uploadInquirySponsorLogo(reader.result as string).then((r) => {
        setLogoUploading(false);
        if (r.ok) setLogoRef(r.data.logoRef);
        else setError(r.error.message ?? "Logo upload failed — you can still submit without one.");
      });
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!businessName.trim()) { setError("Business name is required."); return; }
    if (!linkUrl.trim()) { setError("A link to your business (website, Instagram, etc.) is required."); return; }
    if (availability !== "available") { setError("Pick a date range that's actually available first."); return; }
    setError(null);
    setSubmitting(true);
    const r = await api.submitSponsorInquiry({ cityId, tier, businessName: businessName.trim(), tagline: tagline.trim(), linkUrl: linkUrl.trim(), logoRef, startDate, endDate });
    setSubmitting(false);
    if (r.ok) {
      navigate(`/sponsor/${r.data.sponsor.id}`);
    } else {
      setError(r.error.message ?? "That didn't go through — try again.");
    }
  };

  const inputCls = "h-11 w-full rounded-xl border border-slate-200 px-3.5 text-[15px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="text-center">
        <div className="text-2xl font-extrabold tracking-tight text-slate-900">
          Kim<span className="text-[#FF5741]">bio</span>
        </div>
        <h1 className="mt-3 text-xl font-extrabold tracking-tight text-slate-900">Sponsor Kimbio Columbia</h1>
        <p className="mt-1 text-sm text-slate-600">Put your business in front of local runners on the Events page — pick your dates below.</p>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <span className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-slate-500">1. Choose a tier</span>
        <div className="flex gap-2">
          {(["standard", "featured"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              className={`flex-1 rounded-xl border p-3 text-left transition-colors ${tier === t ? "border-[#14171C] bg-[#14171C] text-white" : "border-slate-200 text-slate-700"}`}
            >
              <span className="block text-sm font-bold">{t === "featured" ? "Featured" : "Standard"}</span>
              <span className={`block text-[12px] ${tier === t ? "text-white/70" : "text-slate-400"}`}>${DAY_RATE[t]}/day · {t === "featured" ? "1 spot" : "3 spots"}</span>
            </button>
          ))}
        </div>

        <span className="mb-2 mt-5 block text-[11px] font-bold uppercase tracking-widest text-slate-500">2. Pick your dates</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1"><span className="mb-1 block text-[11px] font-semibold text-slate-500">Start</span><input type="date" min={todayStr} value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></label>
          <label className="min-w-0 flex-1"><span className="mb-1 block text-[11px] font-semibold text-slate-500">End</span><input type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} /></label>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">Placements run all day (not a specific time) — live starting midnight on your start date, through 11:59pm on your end date.</p>
        <div className={`mt-2 flex items-center justify-between rounded-xl px-3.5 py-2.5 text-[13px] font-semibold ${availability === "unavailable" ? "bg-rose-50 text-rose-700" : availability === "available" ? "bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-500"}`}>
          <span>{dayCount} day{dayCount === 1 ? "" : "s"} · ${totalPrice} total</span>
          <span>{availability === "checking" ? "Checking…" : availability === "available" ? "Available ✓" : availability === "unavailable" ? "Not available" : ""}</span>
        </div>

        <span className="mb-2 mt-5 block text-[11px] font-bold uppercase tracking-widest text-slate-500">3. Your business</span>
        <div className="space-y-2.5">
          <input className={inputCls} placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={60} />
          <input className={inputCls} placeholder="Tagline (optional)" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={120} />
          <input className={inputCls} placeholder="https://your-business.com" inputMode="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />

          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            {logoPreviewUrl ? (
              <img src={logoPreviewUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />
            ) : (
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-200 text-[11px] font-bold text-slate-500">Logo</span>
            )}
            <div className="min-w-0 flex-1">
              <label className="inline-block cursor-pointer text-[13px] font-bold text-[#14171C] underline underline-offset-2">
                {logoUploading ? "Uploading…" : logoRef ? "Change logo" : "Upload logo (optional)"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); }} />
              </label>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                {tier === "featured"
                  ? "Square, at least 200×200px — shows as a 44px rounded square. Simple marks read better than detailed logos this small."
                  : "Square, at least 120×120px — shows as a 24px circle. A monogram or icon works better than a full wordmark."}
              </p>
            </div>
          </div>
        </div>

        {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-[13px] font-semibold text-rose-800">{error}</p> : null}

        <PillButton variant="primary" className="mt-5 w-full" disabled={submitting || availability !== "available"} onClick={() => void submit()}>
          {submitting ? "Submitting…" : `Continue to payment — $${totalPrice}`}
        </PillButton>
        <p className="mt-3 text-center text-[11px] text-slate-400">Nothing is charged yet — the next page is where you actually pay, and your dates aren't held until payment completes.</p>
      </div>
    </div>
  );
}
