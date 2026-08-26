import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import * as api from "../lib/api";
import { Icon, PillButton } from "../components/ui";

/**
 * The actual "sponsor page" — a real, branded page a business can visit to
 * see what they're paying for and pay by card or Apple Pay, rather than
 * being handed a raw stripe.com checkout link with no context. The owner
 * creates the sponsor record in Admin, gets this page's URL
 * (getkimbio.com/sponsor/:id), and sends that link directly to the business.
 */
/** "Sep 1 – Sep 7, 2026" style formatting for a booking's date range, or "Sep 1, 2026" if it's a single day. */
function formatDateRange(startDate: string, endDate: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  const start = new Date(startDate + "T00:00:00Z").toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  if (startDate === endDate) return start;
  const end = new Date(endDate + "T00:00:00Z").toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  return `${start} – ${end}`;
}

export function SponsorPaymentPage() {
  const { sponsorId = "" } = useParams<{ sponsorId: string }>();
  const [searchParams] = useSearchParams();
  const justPaid = searchParams.get("paid") === "1";
  const [sponsor, setSponsor] = useState<api.SponsorPaymentView | null | "not_found">(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.getSponsorPayment(sponsorId).then((r) => {
      if (r.ok) setSponsor(r.data.sponsor);
      else setSponsor("not_found");
    });
  }, [sponsorId]);

  const pay = async () => {
    setPaying(true);
    setError(null);
    const r = await api.payForSponsor(sponsorId);
    if (r.ok) {
      window.location.href = r.data.url;
    } else {
      setPaying(false);
      setError(r.error.message ?? "Couldn't start checkout — contact Kimbio directly.");
    }
  };

  if (sponsor === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#14171C]" />
      </div>
    );
  }

  if (sponsor === "not_found") {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Link not found</h1>
        <p className="text-sm text-slate-600">This sponsorship link isn't valid, or the placement no longer exists. Contact Kimbio if you think this is a mistake.</p>
      </div>
    );
  }

  const isActive = sponsor.active || justPaid;

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="text-center">
        <div className="text-2xl font-extrabold tracking-tight text-slate-900">
          Kim<span className="text-[#FF5741]">bio</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">Sponsor placement</p>
      </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        {isActive ? (
          <div className="text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-700">
              <Icon name="check" className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-xl font-extrabold tracking-tight text-slate-900">You're live on Kimbio</h1>
            <p className="mt-2 text-sm text-slate-600">
              {sponsor.businessName}'s {sponsor.tier} placement is showing on the Events page for Columbia runners, {formatDateRange(sponsor.startDate, sponsor.endDate)}. It'll come down automatically after that — no action needed.
            </p>
          </div>
        ) : (
          <>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#FF5741]">{sponsor.tier} placement</span>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight text-slate-900">{sponsor.businessName}</h1>
            <p className="mt-1 text-[13px] font-semibold text-slate-500">{formatDateRange(sponsor.startDate, sponsor.endDate)}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Your placement appears on Kimbio's Events page — the first thing Columbia runners see when they open the app to find their next group run.
            </p>
            <div className="mt-4 rounded-xl bg-slate-50 p-3.5 text-[12px] leading-relaxed text-slate-600">
              <p className="font-bold text-slate-700">Logo specs</p>
              <p className="mt-1">
                {sponsor.tier === "featured"
                  ? "Square logo, at least 200×200px. It displays at 44×44px in a rounded square — simple marks read better than detailed logos at that size."
                  : "Square logo, at least 120×120px. It displays as a 24×24px circle in a compact row alongside other sponsors — a monogram or icon works better than a full wordmark."}
                {" "}If you don't have one ready, that's fine — your business name shows on its own until you send one.
              </p>
            </div>
            <div className="mt-5 flex items-baseline gap-1 border-t border-slate-100 pt-5">
              <span className="text-3xl font-extrabold tracking-tight text-slate-900">${sponsor.priceUsd}</span>
              <span className="text-sm text-slate-500">one-time</span>
            </div>
            {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-[13px] font-semibold text-rose-800">{error}</p> : null}
            <PillButton variant="primary" className="mt-5 w-full" disabled={paying} onClick={() => void pay()}>
              {paying ? "Redirecting to checkout…" : "Pay with card or Apple Pay"}
            </PillButton>
            <p className="mt-3 text-center text-[11px] text-slate-400">Secure checkout by Stripe. Your placement goes live as soon as payment completes.</p>
          </>
        )}
      </div>
    </div>
  );
}
