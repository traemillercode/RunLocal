import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { TrustedBadge } from "../components/TrustedBadge";
import { Chip, Icon } from "../components/ui";
import { TrustSummary } from "../components/TrustProfileSection";
import {
  getRunnerProfile,
  type RecognitionView,
  type RunnerProfileResponse,
  type RunnerProfileView,
} from "../lib/api";
function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "R"
  );
}
/**
 * Identity card for ANOTHER runner (or a guest viewing anyone, including
 * themselves via /runners/:id). Deliberately public-safe: the server sends
 * only id/name/username/photo/city/badges — never email, phone, suspension,
 * rejection reasons, or under-review state.
 */
export function RunnerProfileHeader({ profile }: { profile: RunnerProfileView }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-[#14171C] text-white shadow-sm">
      <div className="flex items-center gap-4 p-5">
        {profile.profilePhotoUrl ? (
          <img
            src={profile.profilePhotoUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-white/20"
          />
        ) : (
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[10px] bg-[#FF5741] text-xl font-extrabold text-[#14171C]">
            {initials(profile.name)}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-lg font-bold leading-tight">{profile.name}</p>
          {profile.username ? (
            <p className="truncate text-[13px] font-semibold leading-tight text-[#FF5741]">@{profile.username}</p>
          ) : null}
          <p className="mt-0.5 text-[13px] text-white/70">
            {profile.cityName ? `Home: ${profile.cityName}` : "Home city: not set"}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {profile.isVerified ? <VerifiedBadge /> : null}
            {profile.isTrustedMember ? <TrustedBadge size="sm" /> : null}
            {profile.isLeader ? (
              <Chip tone="outline">
                <Icon name="flag" className="h-3 w-3" /> Group Leader
              </Chip>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
/**
 * Community standing for ANOTHER runner — qualitative only. Mirrors the
 * own-profile TrustSummary (tier chip + coach/host chips) plus the runner's
 * admin-granted recognitions with an honest empty state.
 */
export function RunnerProfileTrust({ trust }: { trust: RunnerProfileResponse["trust"] }) {
  const labels: Record<string, string> = { coach: "Recognized coach", host: "Recognized host" };
  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold text-slate-900">Community standing</h2>
      <div className="mt-2">
        <TrustSummary trust={trust} />
      </div>
      {trust.recognitions.length === 0 ? (
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-500">
          This runner hasn't been recognized yet. Recognitions are granted by verified community leadership — the
          qualitative tier above is separate from role recognitions.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {trust.recognitions.map((r, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <Chip tone={r.role === "coach" ? "sky" : "emerald"}>
                <Icon name={r.role === "coach" ? "flag" : "users"} className="h-3 w-3" /> {labels[r.role] ?? r.role}
              </Chip>
              <span className="text-[11px] text-slate-400">granted by verified leadership</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
/**
 * Recognized coaches & hosts in the runner's home city (non-ranked, from the
 * same public city list used everywhere). Links each entry to its profile.
 */
export function RunnerProfileCityRecognitions({
  cityName,
  recognitions,
}: {
  cityName: string | null;
  recognitions: RecognitionView[];
}) {
  if (!cityName || recognitions.length === 0) return null;
  const tierText: Record<string, string> = { new: "New", recognized: "Recognized", "well-regarded": "Well-regarded" };
  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold text-slate-900">Recognized in {cityName}</h2>
      <p className="mt-0.5 text-[11px] text-slate-400">Non-ranked, qualitative view — no scores, no rankings.</p>
      <ul className="mt-3 space-y-2">
        {recognitions.map((r) => (
          <li key={r.accountId}>
            <Link
              to={`/runners/${r.accountId}`}
              className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 hover:bg-slate-100"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-slate-800">{r.name}</span>
                {r.username ? <span className="block truncate text-[11px] text-slate-400">@{r.username}</span> : null}
              </span>
              <span className="flex shrink-0 flex-wrap justify-end gap-1">
                {r.roles.map((role) => (
                  <Chip key={role} tone={role === "coach" ? "sky" : "emerald"}>
                    <Icon name={role === "coach" ? "flag" : "users"} className="h-3 w-3" />{" "}
                    {role === "coach" ? "Coach" : "Host"}
                  </Chip>
                ))}
                <Chip tone={r.tier === "well-regarded" ? "brand" : r.tier === "recognized" ? "volt" : "outline"}>
                  {tierText[r.tier] ?? r.tier}
                </Chip>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
/** Honest 404 state — unknown, deleted, or suspended accounts are identical. */
export function RunnerProfileMissing() {
  return (
    <section className="mx-auto mt-8 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100">
        <Icon name="search" className="h-6 w-6 text-slate-400" />
      </span>
      <h1 className="mt-4 text-lg font-extrabold text-slate-900">Runner not found</h1>
      <p className="mt-1 text-sm leading-relaxed text-slate-500">
        This runner's profile isn't available — the account may have been removed or is no longer active.
      </p>
      <Link
        to="/"
        className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[#14171C] px-5 text-sm font-semibold text-white"
      >
        Back to Run Local
      </Link>
    </section>
  );
}
/** Loading skeleton while the public profile fetches. */
export function RunnerProfileLoading() {
  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading">
      <div className="h-6 w-32 animate-pulse rounded bg-slate-200" />
      <div className="mt-4 h-28 animate-pulse rounded-2xl bg-slate-200" />
      <div className="mt-4 h-24 animate-pulse rounded-2xl bg-slate-200" />
    </div>
  );
}
/**
 * Public (other-user) runner profile page at /runners/:id. Guest-accessible:
 * no account or role gate — the server returns only public-safe fields and
 * 404s for unknown/deleted/suspended accounts.
 */
export function RunnerProfilePage({ id }: { id: string }) {
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [data, setData] = useState<RunnerProfileResponse | null>(null);
  useEffect(() => {
    let live = true;
    setState("loading");
    setData(null);
    void getRunnerProfile(id).then((r) => {
      if (!live) return;
      if (r.ok) {
        setData(r.data);
        setState("ready");
      } else {
        setState("missing");
      }
    });
    return () => {
      live = false;
    };
  }, [id]);
  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Runner profile</h1>
      <p className="mt-0.5 text-sm font-medium text-slate-500">Public community profile</p>
      {state === "loading" ? (
        <RunnerProfileLoading />
      ) : state === "missing" || !data ? (
        <RunnerProfileMissing />
      ) : (
        <>
          <div className="mt-4">
            <RunnerProfileHeader profile={data.profile} />
          </div>
          <RunnerProfileTrust trust={data.trust} />
          <RunnerProfileCityRecognitions cityName={data.profile.cityName} recognitions={data.recognitions} />
        </>
      )}
    </div>
  );
}
