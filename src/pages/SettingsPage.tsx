/**
 * Settings — account preferences with a clearly separated owner-only section.
 *
 * The owner-only section renders ONLY when the server-reported `isOwner` flag
 * is true (never derived from the email client-side). It links to the admin
 * control center and shows honest deployment status (Supabase Auth email
 * verification, admin key, retention) from the public /api/health endpoint —
 * no secrets.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { Chip, Icon, PillButton } from "../components/ui";
import { CITIES } from "../data/cities";
import { phaseLabel, roleLabel } from "../lib/accounts";
import * as api from "../lib/api";
import { useToast } from "../lib/toast";
import { useAccount } from "../state/account";
import { useSelectedCity } from "../state/city";

export function SettingsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { me, backendAvailable, signOut, deleteMyAccount } = useAccount();
  const { city, cityId, signedIn, hasHomeCity, selectCity } = useSelectedCity();
  const [notificationsOn, setNotificationsOn] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [health, setHealth] = useState<api.HealthInfo | null>(null);
  // In-progress home-city selection (null = not editing / unchanged).
  const [pendingCityId, setPendingCityId] = useState<string | null>(null);
  const [cityBusy, setCityBusy] = useState(false);
  const [citySaveError, setCitySaveError] = useState<string | null>(null);

  useEffect(() => {
    void api.getHealth().then((r) => {
      if (r.ok) setHealth(r.data);
    });
  }, []);

  const account = me?.status === "signed_in" ? me.account : null;
  const verified = account?.status === "verified";
  const isOwner = account?.isOwner === true;

  /**
   * Persist the pending home-city selection through the server (which
   * re-validates the id against the known city entities) and surface its
   * verdicts clearly.
   */
  const saveHomeCity = async () => {
    const target = pendingCityId;
    if (!target || target === cityId) {
      setPendingCityId(null);
      setCitySaveError(null);
      return;
    }
    setCityBusy(true);
    setCitySaveError(null);
    const r = await selectCity(target);
    setCityBusy(false);
    if (r.ok) {
      setPendingCityId(null);
      toast("Home city updated.", "success");
    } else if (r.error.code === "invalid_city") {
      setCitySaveError("That city isn't supported yet — pick one from the list.");
    } else if (r.error.code === "city_required") {
      setCitySaveError("Choose a city first.");
    } else if (r.error.code === "sign_in_required") {
      setCitySaveError("Your session expired — log in again to save your home city.");
    } else {
      setCitySaveError(r.error.message ?? "Couldn't save your home city. Try again.");
    }
  };

  const doDelete = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    const result = await deleteMyAccount();
    if (result.ok) {
      toast("Your profile was deleted — verification data (phone, selfie, photo) was removed.", "success");
      navigate("/");
    } else {
      toast("Could not delete your profile. Try again.", "neutral");
    }
    setConfirmingDelete(false);
  };

  const supabaseConfigured = health?.supabaseConfigured;
  const supabaseLabel =
    supabaseConfigured === undefined
      ? "…"
      : supabaseConfigured
        ? "Configured"
        : "Not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)";

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Settings</h1>
      <p className="mt-0.5 text-sm font-medium text-slate-500">Account preferences & status</p>

      {!backendAvailable ? (
        <section className="mt-4 rounded-2xl bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <span className="font-semibold">Server API unreachable.</span> Identity, verification, and account settings
          are unavailable right now — you're browsing as a guest.
        </section>
      ) : null}

      {signedIn && account ? <ActivityConnections /> : null}
      {/* Account */}
      <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <h2 className="border-b border-slate-100 px-5 py-3.5 text-[15px] font-bold text-slate-900">Account</h2>
        {account ? (
          <ul className="divide-y divide-slate-100">
            <li className="flex items-center justify-between gap-3 px-5 py-3.5">
              <span className="text-[14px] font-medium text-slate-700">Name</span>
              <span className="max-w-[60%] truncate text-[14px] text-slate-500">{account.name}</span>
            </li>
            <li className="flex items-center justify-between gap-3 px-5 py-3.5">
              <span className="text-[14px] font-medium text-slate-700">Email</span>
              <span className="max-w-[60%] truncate text-[14px] text-slate-500">{account.email}</span>
            </li>
            <li className="flex items-center justify-between gap-3 px-5 py-3.5">
              <span className="text-[14px] font-medium text-slate-700">Username</span>
              <span className="max-w-[60%] truncate text-[14px] text-slate-500">
                {account.username ? `@${account.username}` : "Not set — add one on your profile"}
              </span>
            </li>
            <li className="flex items-center justify-between gap-3 px-5 py-3.5">
              <span className="text-[14px] font-medium text-slate-700">Status</span>
              <span className="flex flex-wrap items-center justify-end gap-1.5">
                {verified ? <VerifiedBadge size="sm" /> : <Chip tone="amber">{phaseLabel(account.phase)}</Chip>}
                {isOwner ? <Chip tone="brand">Super Admin</Chip> : <Chip tone="outline">{roleLabel(account.role)}</Chip>}
              </span>
            </li>
            <li>
              <button
                type="button"
                onClick={() => navigate("/verify")}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-5 text-left active:bg-slate-50"
              >
                <span className="text-[14px] font-medium text-slate-700">Verification</span>
                <span className="flex items-center gap-1 text-[14px] font-semibold text-[#0b2b22]">
                  {verified ? "View status" : "Continue"} <Icon name="chevronRight" className="h-4 w-4 text-slate-300" />
                </span>
              </button>
            </li>
          </ul>
        ) : (
          <div className="px-5 py-4">
            <p className="text-[13px] leading-relaxed text-slate-600">
              You're browsing as a guest — there are no account settings yet.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <PillButton variant="secondary" onClick={() => navigate("/verify")}>
                <Icon name="plus" className="h-4 w-4" /> Sign up
              </PillButton>
              <PillButton variant="ghost" onClick={() => navigate("/login")}>
                Log in
              </PillButton>
            </div>
          </div>
        )}
      </section>

      {/* Preferences */}
      <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <h2 className="border-b border-slate-100 px-5 py-3.5 text-[15px] font-bold text-slate-900">Preferences</h2>
        <ul className="divide-y divide-slate-100">
          <li className="flex items-center justify-between gap-3 px-5 py-3.5">
            <span className="text-[14px] font-medium text-slate-700">City</span>
            <span className="text-[14px] text-slate-500">
              {city.name}, {city.state}
              {signedIn && hasHomeCity ? " (home)" : ""}
            </span>
          </li>
          <li>
            <button
              type="button"
              onClick={() => setNotificationsOn((v) => !v)}
              className="flex min-h-11 w-full items-center justify-between gap-3 px-5 py-3.5 text-left active:bg-slate-50"
            >
              <span className="text-[14px] font-medium text-slate-700">Reminders & notifications</span>
              <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${notificationsOn ? "bg-[#0b2b22]" : "bg-slate-300"}`}>
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${notificationsOn ? "left-6" : "left-1"}`} />
              </span>
            </button>
          </li>
        </ul>
        <p className="border-t border-slate-100 px-5 py-3 text-[11px] leading-relaxed text-slate-400">
          Guest city choice and notification preferences are saved on this device only. Your home city is saved to your
          account. Verification records are never stored on your device.
        </p>
      </section>

      {/* Home city — account-owned, server-validated */}
      {signedIn ? (
        <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
          <h2 className="border-b border-slate-100 px-5 py-3.5 text-[15px] font-bold text-slate-900">Home city</h2>
          {!hasHomeCity ? (
            <div className="border-b border-amber-100 bg-amber-50 px-5 py-3.5">
              <p className="flex items-start gap-2 text-[13px] font-semibold leading-relaxed text-amber-900">
                <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0" />
                You haven't chosen a home city yet — your runs, races, and forum default to it.
              </p>
            </div>
          ) : null}
          <ul className="space-y-2 p-4" role="radiogroup" aria-label="Home city">
            {CITIES.map((c) => {
              const active = (pendingCityId ?? (hasHomeCity ? cityId : null)) === c.id;
              const disabled = !c.live;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={disabled}
                    onClick={() => {
                      setPendingCityId(c.id);
                      setCitySaveError(null);
                    }}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                      active ? "border-[#0b2b22] bg-[#0b2b22] text-white" : "border-slate-200 bg-white text-slate-800"
                    } ${disabled ? "opacity-60" : "active:bg-slate-50"}`}
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                        active ? "bg-white/15 text-[#c8f169]" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      <Icon name="pin" className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-bold">
                        {c.name}, {c.state}
                      </span>
                      <span className={`block truncate text-[11px] ${active ? "text-white/70" : "text-slate-500"}`}>{c.tagline}</span>
                    </span>
                    {active ? <Icon name="check" className="h-4 w-4 shrink-0 text-[#c8f169]" /> : disabled ? <Chip tone="amber">Coming soon</Chip> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {citySaveError ? (
            <p role="alert" className="px-4 pb-1 text-xs font-medium text-red-600">
              {citySaveError}
            </p>
          ) : null}
          <div className="flex gap-2 border-t border-slate-100 px-4 py-3.5">
            <PillButton variant="primary" className="flex-1" disabled={cityBusy || pendingCityId === null || pendingCityId === cityId} onClick={() => void saveHomeCity()}>
              {cityBusy ? "Saving…" : "Save home city"}
            </PillButton>
            {pendingCityId !== null ? (
              <PillButton variant="ghost" onClick={() => { setPendingCityId(null); setCitySaveError(null); }}>
                Cancel
              </PillButton>
            ) : null}
          </div>
          <p className="border-t border-slate-100 px-5 py-3 text-[11px] leading-relaxed text-slate-400">
            One home city, validated server-side against the supported city list. Changing it re-scopes your community
            content (events, races, forum).
          </p>
        </section>
      ) : null}

      {/* Owner-only */}
      {isOwner ? (
        <section className="mt-4 overflow-hidden rounded-2xl bg-[#0b2b22] text-white shadow-sm ring-1 ring-[#0b2b22]/20">
          <h2 className="flex items-center gap-2 border-b border-white/10 px-5 py-3.5 text-[15px] font-bold">
            <Icon name="lock" className="h-4 w-4 text-[#c8f169]" /> Owner / Super Admin
          </h2>
          <ul className="divide-y divide-white/10">
            <li>
              <button
                type="button"
                onClick={() => navigate("/admin")}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-5 py-3.5 text-left active:bg-white/10"
              >
                <span>
                  <span className="block text-[14px] font-semibold">Admin control center</span>
                  <span className="block text-xs text-white/60">Pending users, approval & audit</span>
                </span>
                <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-[#c8f169]" />
              </button>
            </li>
            <li className="px-5 py-3.5">
              <span className="block text-[13px] font-semibold">Deployment status</span>
              <dl className="mt-1.5 space-y-1 text-xs text-white/70">
                <div className="flex justify-between gap-3">
                  <dt>Email verification (Supabase Auth)</dt>
                  <dd className="text-right">{supabaseLabel}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Admin key (safety tool)</dt>
                  <dd className="text-right">{health?.adminConfigured ? "Configured" : "Not configured"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Retention window</dt>
                  <dd className="text-right">{health ? `${health.retentionYears} year(s)` : "…"}</dd>
                </div>
              </dl>
              <p className="mt-2 text-[11px] leading-relaxed text-white/50">
                Only you can see this section. Every admin access still requires a reason and is audited.
              </p>
            </li>
          </ul>
        </section>
      ) : null}

      {/* Danger zone */}
      {account ? (
        <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
          <h2 className="border-b border-slate-100 px-5 py-3.5 text-[15px] font-bold text-slate-900">Session</h2>
          <ul className="divide-y divide-slate-100">
            <li>
              <button
                type="button"
                onClick={() => void signOut().then(() => toast("Signed out.", "neutral"))}
                className="flex min-h-11 w-full px-5 text-left text-[14px] font-semibold text-slate-700 active:bg-slate-50"
              >
                Sign out
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => void doDelete()}
                className={`flex min-h-11 w-full px-5 text-left text-[14px] font-semibold ${confirmingDelete ? "text-red-700" : "text-red-600"} active:bg-red-50`}
              >
                {confirmingDelete ? "Tap again to confirm — deletes phone, selfie & photo" : "Delete my profile"}
              </button>
            </li>
          </ul>
          <p className="border-t border-slate-100 px-5 py-3 text-[11px] leading-relaxed text-slate-400">
            Verification records (phone, selfie, timestamps, IP history) are stored securely, retained up to 3 years
            after your last activity, and deleted immediately when you delete your account. Only a Verified badge is
            ever shown publicly.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function ActivityConnections() {
  const providers = [{ id: "strava", label: "Strava" }, { id: "garmin", label: "Garmin" }, { id: "coros", label: "Coros" }, { id: "suunto", label: "Suunto" }] as const;
  const [status, setStatus] = useState<Record<string, string>>({});
  const [mode, setMode] = useState("manual");
  return <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70"><h2 className="border-b border-slate-100 px-5 py-3.5 text-[15px] font-bold text-slate-900">Activity connections</h2><p className="px-5 py-3 text-xs leading-relaxed text-slate-500">Manual sharing is the default. Auto sharing is opt-in; Private keeps activities off the community feed.</p>{providers.map((p) => <div key={p.id} className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3"><div><strong className="text-sm text-slate-800">{p.label}</strong><p className="text-xs text-slate-500">{status[p.id] ?? (p.id === "strava" ? "Not connected · Strava credentials are not configured" : "Not connected · partner API scaffold")}</p></div><PillButton variant="ghost" onClick={() => void api.getConnection(p.id).then((r) => setStatus((x) => ({ ...x, [p.id]: r.ok ? "Connected" : (r.error.message ?? "Not configured") })))}>Connect</PillButton></div>)}<label className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm font-medium">Share mode<select aria-label="Activity share mode" className="rounded-lg border border-slate-300 px-2 py-1" value={mode} onChange={(e) => setMode(e.target.value)}><option value="manual">Manual</option><option value="auto">Auto</option><option value="private">Private</option></select></label></section>;
}
