import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { Chip, Icon, PillButton } from "../components/ui";
import type { City } from "../types";
import { resolveWeekEvents } from "../lib/dates";
import { phaseLabel, roleLabel } from "../lib/accounts";
import * as api from "../lib/api";
import type { AppStore } from "../lib/store";
import { useAccount } from "../state/account";
import { useSelectedCity } from "../state/city";
import { TrustProfileSection } from "../components/TrustProfileSection";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "R";
}

const KIND_LABELS: Record<string, string> = { race: "Race", group: "Group", event: "Independent run" };
const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending approval", cls: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-700" },
};

/** The signed-in user's OWN submissions (server returns this account's records only). */
export function MySubmissions({ signedIn }: { signedIn: boolean }) {
  const [rows, setRows] = useState<api.MySubmissionView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    setLoading(true); setError(null);
    void api.getMySubmissions().then((r) => {
      if (!alive) return;
      if (r.ok) setRows(r.data.submissions);
      else setError(r.error.message);
    }).catch(() => { if (alive) setError("Could not load submission status."); }).finally(() => { if (alive) setLoading(false); });
    return () => {
      alive = false;
    };
  }, [signedIn]);
  if (!signedIn) return null;
  return (
    <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <h2 className="text-[15px] font-bold text-slate-900">My submissions</h2>
      <p className="mt-0.5 text-xs text-slate-500">Your race, group, and independent-run submissions — only you can see these.</p>
      {loading ? (
        <p className="mt-3 text-[13px] text-slate-400">Loading…</p>
      ) : error ? (
        <div className="mt-3 rounded-xl bg-red-50 p-3 text-[13px] text-red-700"><p>{error}</p><button type="button" className="mt-2 font-semibold underline" onClick={() => { setRows(null); setError(null); setLoading(true); void api.getMySubmissions().then((r) => r.ok ? setRows(r.data.submissions) : setError(r.error.message)).finally(() => setLoading(false)); }}>Retry</button></div>
      ) : !rows || rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-slate-500">Nothing submitted yet. Submit a race, group, or independent run from the Races and Events pages.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((r) => {
            const st = STATUS_LABELS[r.status] ?? STATUS_LABELS.pending;
            return (
              <li key={r.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-slate-800">{r.title}</p>
                    <p className="text-xs text-slate-500">{KIND_LABELS[r.kind] ?? r.kind}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${st.cls}`}>{st.label}</span>
                </div>
                {r.status === "rejected" && r.rejectionReason ? (
                  <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[12px] leading-relaxed text-red-700">
                    <span className="font-semibold">Why it was rejected:</span> {r.rejectionReason}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ProfilePage({ city, store }: { city: City; store: AppStore }) {
  const navigate = useNavigate();
  const { me, backendAvailable } = useAccount();
  const { hasHomeCity } = useSelectedCity();

  const rsvps = useMemo(() => {
    const all = resolveWeekEvents(city.events, new Date());
    return all.filter((e) => store.state.rsvped[e.id]);
  }, [city.events, store.state.rsvped]);

  const signedIn = me?.status === "signed_in" ? me.account : null;
  const name = signedIn?.name ?? "Guest runner";
  const photo = signedIn?.profilePhotoUrl ?? null;
  const verified = signedIn?.status === "verified";

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Profile</h1>
      <p className="mt-0.5 text-sm font-medium text-slate-500">Runner profile & settings</p>

      {!backendAvailable ? (
        <section className="mt-4 rounded-2xl bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <span className="font-semibold">Server API unreachable.</span> Identity & verification are unavailable right
          now — you're browsing as a guest and nothing can be verified or saved to your account.
        </section>
      ) : null}

      {/* Identity card */}
      <section className="mt-4 overflow-hidden rounded-2xl bg-[#14171C] text-white shadow-sm">
        <div className="flex items-center gap-4 p-5">
          {photo ? (
            <img src={photo} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-white/20" />
          ) : (
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[10px] bg-[#FF5741] text-xl font-extrabold text-[#14171C]">
              {initials(name)}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-lg font-bold leading-tight">{name}</p>
            {signedIn?.username ? (
              <p className="truncate text-[13px] font-semibold leading-tight text-[#FF5741]">@{signedIn.username}</p>
            ) : null}
            <p className="mt-0.5 text-[13px] text-white/70">
              {signedIn ? (hasHomeCity ? `Home: ${city.name}, ${city.state}` : "Home city: not set") : `${city.name}, ${city.state}`}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {verified ? (
                <VerifiedBadge />
              ) : signedIn ? (
                <Chip tone="amber">
                  <Icon name="clock" className="h-3 w-3" /> Pending verification
                </Chip>
              ) : (
                <Chip tone="outline">
                  <Icon name="users" className="h-3 w-3" /> Guest
                </Chip>
              )}
              {signedIn && signedIn.role === "group_leader" ? (
                <Chip tone="outline">
                  <Icon name="flag" className="h-3 w-3" /> {roleLabel(signedIn.role)}
                </Chip>
              ) : null}
              {signedIn?.isOwner ? (
                <Chip tone="brand">
                  <Icon name="lock" className="h-3 w-3" /> Super Admin
                </Chip>
              ) : null}
            </div>
          </div>
        </div>
        {signedIn && !verified ? (
          <div className="border-t border-white/10 bg-white/5 px-5 py-3">
            <p className="flex items-start gap-2 text-[12px] leading-relaxed text-white/70">
              <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0 text-[#FF5741]" />
              Pending Verification profiles are read-only: no RSVPs, posts, or submissions until your identity is
              approved. Only a Verified badge is ever shown publicly.
            </p>
          </div>
        ) : null}
      </section>

      {/* Guest CTA */}
      {!signedIn ? (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <h2 className="text-[15px] font-bold text-slate-900">Create your runner profile</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
            Verified runners get RSVPs, a public profile, and posting access. Sign up with your email and password,
            confirm your email, then complete a live selfie — reviewed by a person, never shown publicly.
          </p>
          <PillButton variant="secondary" onClick={() => navigate("/login?mode=signup")} className="mt-3.5 w-full">
            <Icon name="shield" className="h-4 w-4" /> Create account
          </PillButton>
        </section>
      ) : (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70"><h2 className="text-[15px] font-bold text-slate-900">Profile settings</h2><p className="mt-1 text-[13px] text-slate-600">Manage your username and notification preferences in Settings.</p><PillButton variant="secondary" onClick={() => navigate("/settings")} className="mt-3 w-full">Open Settings</PillButton></section>
      )}

      {/* My submissions — this account's own submissions only */}
      <MySubmissions signedIn={!!signedIn} />

      {/* Community trust & credentials — own records, qualitative view only */}
      {signedIn ? (
        <TrustProfileSection
          me={{ id: signedIn.id, name: signedIn.name, email: signedIn.email, underReview: signedIn.underReview === true }}
        />
      ) : null}

      {/* Home city — account-owned; change happens in Settings (server-validated) */}
      {signedIn ? (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-slate-900">Home city</h2>
              {hasHomeCity ? (
                <p className="truncate text-[13px] font-semibold text-[#14171C]">
                  {city.name}, {city.state}
                </p>
              ) : (
                <p className="text-[13px] font-semibold text-amber-700">Not set yet — choose your home city</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => navigate("/settings")}
              className="shrink-0 rounded-full bg-slate-100 px-4 py-2 text-[13px] font-semibold text-slate-700 active:bg-slate-200"
            >
              {hasHomeCity ? "Change" : "Choose"}
            </button>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            Your events, races, and forum default to your home city. Changing it re-scopes your community content.
          </p>
        </section>
      ) : null}

      {/* Pending resume */}
      {signedIn && !verified ? (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <h2 className="text-[15px] font-bold text-slate-900">Finish verification</h2>
          <p className="mt-1 text-[13px] text-slate-500">{phaseLabel(signedIn.phase)}</p>
          <PillButton variant="secondary" onClick={() => navigate("/verify")} className="mt-3.5 w-full">
            <Icon name="chevronRight" className="h-4 w-4 rotate-180" /> Continue
          </PillButton>
        </section>
      ) : null}

      {/* Verified content */}
      {signedIn && verified ? (
        <section className="mt-4 space-y-3">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
            <h2 className="text-[15px] font-bold text-slate-900">Upcoming RSVPs</h2>
            {rsvps.length === 0 ? (
              <p className="mt-2 text-[13px] text-slate-500">
                No RSVPs yet. Tap <span className="font-semibold">RSVP</span> on a group run to see it here.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {rsvps.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-3.5 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-slate-800">{e.title}</span>
                      <span className="block text-xs text-slate-500">{e.location}</span>
                    </span>
                    <Chip tone="emerald">RSVP'd</Chip>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2.5 text-[11px] text-slate-400">RSVPs are client-side in this preview — server sync arrives later.</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
            <h2 className="text-[15px] font-bold text-slate-900">My groups</h2>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {city.groups.slice(0, 3).map((g) => (
                <Chip key={g.id} tone="outline">
                  {g.name}
                </Chip>
              ))}
              <Chip tone="neutral">+ 2 more</Chip>
            </div>
            <p className="mt-2.5 text-[11px] text-slate-400">Sample — group membership joins launch later.</p>
          </div>
        </section>
      ) : null}

      {/* Settings */}
      <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <button
          type="button"
          onClick={() => navigate("/settings")}
          className="flex min-h-14 w-full items-center justify-between gap-3 px-5 text-left active:bg-slate-50"
        >
          <span className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600">
              <Icon name="sort" className="h-4.5 w-4.5" />
            </span>
            <span>
              <span className="block text-[14px] font-semibold text-slate-800">Settings</span>
              <span className="block text-xs text-slate-500">Account, preferences & owner tools</span>
            </span>
          </span>
          <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-slate-300" />
        </button>
      </section>
    </div>
  );
}
