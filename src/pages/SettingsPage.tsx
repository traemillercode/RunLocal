/**
 * Settings — account preferences with a clearly separated owner-only section.
 *
 * The owner-only section renders ONLY when the server-reported `isOwner` flag
 * is true (never derived from the email client-side). It links to the admin
 * control center and shows honest deployment status (Supabase Auth email
 * verification, admin key, retention) from the public /api/health endpoint —
 * no secrets.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { TrustedBadge } from "../components/TrustedBadge";
import { Chip, Icon, PillButton } from "../components/ui";
import { CITIES } from "../data/cities";
import { phaseLabel, roleLabel, type PublicAccount } from "../lib/accounts";
import * as api from "../lib/api";
import { useToast } from "../lib/toast";
import { useAccount } from "../state/account";
import { useNotifications } from "../state/notifications";
import { useSelectedCity } from "../state/city";
import { NOTIFICATION_CATEGORY_META } from "../lib/notifications";
import * as supabase from "../lib/supabase";
import { PASSWORD_REQUIREMENTS, passwordRequirements } from "./LoginPage";
import { normalizeUsername, USERNAME_HINT, USERNAME_PROMPT } from "../lib/username";
import { requestTourReplay } from "../lib/tour";

const inputCls =
  "h-12 w-full rounded-[10px] border border-slate-300 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";

/** Shared signup policy: password changes must satisfy the same checks. */
export function changePasswordValidation(password: string, confirmation: string): string | null {
  if (!passwordRequirements(password).every(Boolean)) {
    return "Password must be at least 6 characters and include a lowercase letter, uppercase letter, and digit.";
  }
  if (password !== confirmation) return "Passwords do not match.";
  return null;
}

/** Settings password changes require a live, verified, non-suspended account. */
export function passwordChangeEligibility(status: PublicAccount["status"], suspended: boolean): string | null {
  return status === "verified" && !suspended ? null : "Password changes are available only for verified, active accounts.";
}

/** Replay affordance for the verified-runner onboarding tour (Settings). */
function WelcomeTourSettings() {
  return (
    <section
      className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70"
      data-tour-target="settings-replay"
    >
      <h2 className="border-b border-slate-100 px-5 py-3.5 text-[15px] font-bold text-slate-900">Welcome tour</h2>
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <p className="text-[13px] leading-relaxed text-slate-600">
          Replay the seven-step tour of events, forum, My Runs, groups, profile, and Settings.
        </p>
        <button
          type="button"
          onClick={() => requestTourReplay(window.localStorage)}
          className="shrink-0 rounded-[10px] bg-[#14171C] px-4 py-2 text-sm font-semibold text-white active:bg-[#252a31]"
        >
          Show tour
        </button>
      </div>
    </section>
  );
}

function UsernameEditor({ account, refresh }: { account: PublicAccount; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(account.username == null); const [value, setValue] = useState(account.username ?? ""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  const save = async () => { setError(null); setSaved(false); const normalized = normalizeUsername(value); if (!normalized) { setError("Use 3–24 characters: letters, numbers, _ or -, starting with a letter."); return; } setBusy(true); const r = await api.setUsername(normalized); setBusy(false); if (r.ok) { setValue(r.data.account.username ?? normalized); setSaved(true); setOpen(false); await refresh(); } else setError(r.error.code === "username_taken" ? "That username is already taken — try another." : r.error.message ?? "Couldn't save your username. Try again."); };
  if (!open) return <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70"><div className="flex items-center justify-between"><div><h2 className="text-[15px] font-bold text-slate-900">Username</h2><p className="font-semibold">@{account.username ?? "not set"}</p></div><button type="button" onClick={() => setOpen(true)} className="rounded-[10px] bg-slate-100 px-4 py-2 text-sm font-semibold">{account.username ? "Change" : "Set"}</button></div><p className="mt-1 text-[11px] text-slate-400">{USERNAME_HINT}</p></section>;
  return <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70"><h2 className="text-[15px] font-bold">{account.username ? "Change username" : "Choose your username"}</h2><p className="mt-1 text-sm text-slate-600">{USERNAME_PROMPT}</p><input value={value} onChange={e => {setValue(e.target.value);setError(null)}} placeholder="jordanlee" className={inputCls+" mt-3"} autoComplete="username" />{error ? <p role="alert" className="mt-1 text-xs text-red-600">{error}</p> : null}{saved ? <p role="status" className="mt-1 text-xs text-emerald-700">Username saved.</p> : null}<div className="mt-3 flex gap-2"><PillButton variant="primary" className="flex-1" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save username"}</PillButton><PillButton variant="ghost" onClick={() => setOpen(false)}>Cancel</PillButton></div></section>;
}
function ChangePasswordSettings({ account }: { account: PublicAccount }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const checks = passwordRequirements(password);

  useEffect(() => {
    if (passwordChangeEligibility(account.status, account.suspended)) {
      setError("Password changes are available only for verified, active accounts.");
    }
  }, [account]);

  const submit = async () => {
    setError(null);
    if (passwordChangeEligibility(account.status, account.suspended)) {
      setError("Password changes are available only for verified, active accounts.");
      return;
    }
    setSaved(false);
    const validationError = changePasswordValidation(password, confirmation);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    // Passwords go directly to Supabase Auth. They are never sent to the
    // Run Local API or retained in local state after a successful update.
    const result = await supabase.updatePassword(password);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPassword("");
    setConfirmation("");
    setSaved(true);
  };

  return (
    <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <div className="border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-[15px] font-bold text-slate-900">Change password</h2>
        <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">Your active secure session verifies your account. Your password is handled only by Supabase Auth.</p>
      </div>
      <div className="space-y-4 px-5 py-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">New password</span>
          <input aria-label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setSaved(false); }} className={inputCls} />
        </label>
        {password.length > 0 ? (
          <ul aria-label="Password requirements" className="grid grid-cols-1 gap-1 text-xs text-slate-500">
            {PASSWORD_REQUIREMENTS.map((requirement, i) => <li key={requirement.key} className={checks[i] ? "text-emerald-700" : "text-slate-500"}><span aria-hidden="true">{checks[i] ? "✓" : "○"}</span>{" "}{requirement.label}</li>)}
          </ul>
        ) : null}
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Confirm new password</span>
          <input aria-label="Confirm new password" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => { setConfirmation(e.target.value); setSaved(false); }} className={inputCls} />
        </label>
        {error ? <p role="alert" className="rounded-xl bg-red-50 p-3.5 text-[13px] text-red-800">{error}</p> : null}
        {saved ? <p role="status" className="rounded-xl bg-emerald-50 p-3.5 text-[13px] text-emerald-800">Password updated successfully.</p> : null}
        <PillButton variant="primary" className="w-full" disabled={busy} onClick={() => void submit()}>{busy ? "Updating…" : "Update password"}</PillButton>
      </div>
    </section>
  );
}

const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function ProfilePhotoSettings({ account, refresh }: { account: PublicAccount; refresh: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(account.profilePhotoUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPreview(account.profilePhotoUrl);
  }, [account.profilePhotoUrl]);

  const choose = (file: File | undefined) => {
    setError(null);
    setSaved(false);
    if (!file) return;
    if (!PHOTO_TYPES.has(file.type)) {
      setError("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setError("That image is too large. Choose a photo under 4 MB.");
      return;
    }
    const nextPreview = URL.createObjectURL(file);
    setPreview(nextPreview);
    setBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const result = value ? await api.uploadProfilePhoto(value) : { ok: false as const, error: new api.ApiError(400, "invalid_image", "Choose a valid image.") };
      URL.revokeObjectURL(nextPreview);
      setBusy(false);
      if (result.ok) {
        setSaved(true);
        await refresh();
      } else {
        setPreview(account.profilePhotoUrl);
        setError(result.error.message ?? "Could not save your profile photo. Try again.");
      }
    };
    reader.onerror = () => {
      URL.revokeObjectURL(nextPreview);
      setBusy(false);
      setPreview(account.profilePhotoUrl);
      setError("Could not read that image. Try another photo.");
    };
    reader.readAsDataURL(file);
  };

  return (
    <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <div className="border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-[15px] font-bold text-slate-900">Profile photo</h2>
        <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">Add a photo to personalize your public runner profile.</p>
      </div>
      <div className="flex items-center gap-4 px-5 py-4">
        {preview ? <img src={preview} alt="Profile photo preview" className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-slate-100" /> : <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-slate-100 text-2xl font-bold text-slate-400" aria-label="No profile photo">?</div>}
        <div className="min-w-0 flex-1">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="user" className="sr-only" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
          <PillButton variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Saving…" : account.profilePhotoUrl ? "Change photo" : "Add photo"}</PillButton>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">JPG, PNG, or WebP · up to 4 MB. On supported phones, you can use the front camera.</p>
          {saved ? <p role="status" className="mt-2 text-xs font-semibold text-emerald-700">Profile photo saved.</p> : null}
          {error ? <p role="alert" className="mt-2 text-xs font-semibold text-red-600">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}

/**
 * One coherent Notifications section for Settings: category preferences
 * (each labeled with whether it delivers today), browser permission, and a
 * link to the private notification center. Presentational — driven by props
 * so UI tests render the real markup without providers.
 *
 * Honesty contract: `NOTIFICATION_CATEGORY_META` marks only categories with a
 * real server producer as active; everything else is clearly labeled
 * "Coming soon" and the browser copy never claims background push.
 */
export function NotificationPreferencesSection({
  prefs,
  unreadCount,
  browserPermission,
  error,
  onToggle,
  onAllowBrowser,
}: {
  prefs: api.NotificationPreferences;
  unreadCount: number | null;
  browserPermission: NotificationPermission | "unsupported";
  error: string | null;
  onToggle: (key: keyof api.NotificationPreferences) => void;
  onAllowBrowser: () => void;
}) {
  const unread = unreadCount ?? 0;
  return (
    <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <h2 className="border-b border-slate-100 px-5 py-3.5 text-[15px] font-bold text-slate-900">Notifications</h2>
      <ul className="divide-y divide-slate-100">
        {error ? <li role="alert" className="bg-red-50 px-5 py-3 text-xs font-medium text-red-800">{error}</li> : null}
        {NOTIFICATION_CATEGORY_META.map((meta) => {
          const value = prefs[meta.key];
          return (
            <li key={meta.key} className="px-5 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[14px] font-medium text-slate-700">{meta.label}</span>
                <div className="flex shrink-0 items-center gap-2">
                  {meta.available ? <Chip tone="emerald">Active</Chip> : <Chip tone="amber">Coming soon</Chip>}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={value}
                    aria-label={`${meta.label} ${value ? "on" : "off"}`}
                    onClick={() => onToggle(meta.key)}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${value ? "bg-[#14171C]" : "bg-slate-300"}`}
                  >
                    <span aria-hidden="true" className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${value ? "left-6" : "left-1"}`} />
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{meta.description}</p>
            </li>
          );
        })}
        <li className="px-5 py-3">
          <p className="text-sm font-semibold">Browser notifications</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {browserPermission === "unsupported" ? "This browser does not support notifications." : browserPermission === "denied" ? "Notifications are blocked in your browser settings." : browserPermission === "granted" ? "Allowed for foreground notices only." : "Not enabled."}
          </p>
          {browserPermission === "default" ? (
            <button type="button" className="mt-2 rounded-[10px] bg-slate-900 px-3 py-2 text-xs font-semibold text-white" onClick={onAllowBrowser}>Allow browser notifications</button>
          ) : null}
        </li>
        <li>
          <Link to="/notifications" className="flex min-h-11 w-full items-center justify-between gap-3 px-5 text-left active:bg-slate-50">
            <span className="text-[14px] font-medium text-slate-700">In-app notifications</span>
            <span className="flex items-center gap-1 text-[14px] font-semibold text-[#14171C]">
              {unread > 0 ? `${unread} unread` : "None unread"} <Icon name="chevronRight" className="h-4 w-4 text-slate-300" />
            </span>
          </Link>
        </li>
      </ul>
      <p className="border-t border-slate-100 px-5 py-3 text-[11px] leading-relaxed text-slate-400">
        Category preferences are saved to your account and default to off. Only Community updates delivers in-app
        notifications today; Account alerts and Run reminders are now real too. In-app notifications are private to your
        account. Browser permission is foreground-only; Run Local does not claim background push.
      </p>
    </section>
  );
}

/**
 * Privacy — who can see what on your public runner profile. Renders the
 * owner-specified controls IN ORDER with plain-language labels only (never raw
 * enum names). The safety line sits verbatim above "My upcoming runs & races",
 * and "My saved runs & races" deliberately has only two options — no
 * "Everyone", ever. Optimistic save with revert on error (mirrors
 * toggleNotification). All visibility enforcement stays server-side
 * (can_view); this section only persists the viewer's own preferences via
 * GET/PUT /api/profile/privacy.
 */
const PRIVACY_LABELS: Record<string, string> = {
  public: "Everyone",
  connections_only: "Only my connections",
  private: "Only me",
};

/** One slim radio row (Home-city card styling at px-3 py-2). */
function PrivacyRadioRow({
  question,
  value,
  options,
  onSelect,
}: {
  question: string;
  value: string;
  options: readonly string[];
  onSelect: (value: string) => void;
}) {
  return (
    <li className="px-5 py-3.5">
      <p className="text-[14px] font-medium text-slate-700">{question}</p>
      <ul role="radiogroup" aria-label={question} className="mt-2 space-y-1.5">
        {options.map((opt) => {
          const active = value === opt;
          return (
            <li key={opt}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelect(opt)}
                className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                  active ? "border-[#14171C] bg-[#14171C] text-white" : "border-slate-200 bg-white text-slate-800 active:bg-slate-50"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${active ? "border-[#FF5741]" : "border-slate-300"}`}
                >
                  {active ? <span className="h-2 w-2 rounded-full bg-[#FF5741]" /> : null}
                </span>
                <span className="text-[13px] font-semibold">{PRIVACY_LABELS[opt] ?? opt}</span>
                {active ? <Icon name="check" className="ml-auto h-4 w-4 text-[#FF5741]" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/** Presentational Privacy section — props only so SSR tests render the real markup. */
/** Self-reported profile fields shown on the public profile: name, bio, an optional custom title (e.g. "Founder"), pace, goal, training block, and upcoming races. All plain text, all optional except name. */
export function ProfileDetailsSection({
  account,
  onSave,
  saving = false,
  error = null,
}: {
  account: PublicAccount;
  onSave: (patch: api.ProfileDetailsPatch) => void;
  saving?: boolean;
  error?: string | null;
}) {
  const [draft, setDraft] = useState({
    name: account.name,
    bio: account.bio ?? "",
    customTitle: account.customTitle ?? "",
    paceLabel: account.paceLabel ?? "",
    runningGoal: account.runningGoal ?? "",
    trainingBlock: account.trainingBlock ?? "",
    upcomingRaces: account.upcomingRaces ?? "",
  });
  const fieldCls = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";
  const rows: { key: keyof typeof draft; label: string; placeholder: string; textarea?: boolean }[] = [
    { key: "name", label: "Display name", placeholder: "Your name" },
    { key: "customTitle", label: "Custom title (optional)", placeholder: "e.g. Founder, Pacer, Coach" },
    { key: "bio", label: "Bio", placeholder: "A few words about you", textarea: true },
    { key: "paceLabel", label: "Pace", placeholder: "e.g. 8:30/mi easy, 7:15/mi tempo" },
    { key: "runningGoal", label: "Goal", placeholder: "e.g. Sub-4 marathon by fall" },
    { key: "trainingBlock", label: "Current training block", placeholder: "e.g. Week 6 of 16 — marathon block" },
    { key: "upcomingRaces", label: "Upcoming races", placeholder: "e.g. Columbia Half — Oct 12" },
  ];
  return (
    <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 p-5" aria-busy={saving}>
      <h2 className="mb-3 text-[15px] font-bold text-slate-900">Profile details</h2>
      {error ? <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-xs font-medium text-red-800">{error}</p> : null}
      <div className="space-y-4">
        {rows.map((row) => (
          <label key={row.key} className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">{row.label}</span>
            {row.textarea ? (
              <textarea
                value={draft[row.key]}
                maxLength={280}
                placeholder={row.placeholder}
                onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))}
                className={`${fieldCls} h-20 resize-none py-2.5`}
              />
            ) : (
              <input
                type="text"
                value={draft[row.key]}
                maxLength={row.key === "name" ? 60 : 140}
                placeholder={row.placeholder}
                onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))}
                className={fieldCls}
              />
            )}
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={saving || !draft.name.trim()}
        onClick={() =>
          onSave({
            name: draft.name,
            bio: draft.bio || null,
            customTitle: draft.customTitle || null,
            paceLabel: draft.paceLabel || null,
            runningGoal: draft.runningGoal || null,
            trainingBlock: draft.trainingBlock || null,
            upcomingRaces: draft.upcomingRaces || null,
          })
        }
        className="mt-5 h-11 w-full rounded-full bg-[#14171C] text-sm font-bold text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save profile details"}
      </button>
    </section>
  );
}
export function PrivacySettingsSection({
  settings,
  onSave,
  saving = false,
  error = null,
}: {
  settings: api.PrivacySettings;
  onSave: (patch: Partial<api.PrivacySettings>) => void;
  saving?: boolean;
  error?: string | null;
}) {
  return (
    <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70" aria-busy={saving}>
      <h2 className="border-b border-slate-100 px-5 py-3.5 text-[15px] font-bold text-slate-900">Privacy</h2>
      <ul className="divide-y divide-slate-100">
        {error ? <li role="alert" className="bg-red-50 px-5 py-3 text-xs font-medium text-red-800">{error}</li> : null}
        <PrivacyRadioRow
          question="Who can find my profile"
          value={settings.profile_visibility}
          options={["public", "connections_only"]}
          onSelect={(v) => onSave({ profile_visibility: v as api.ProfileVisibilitySetting })}
        />
        {/* Safety line — verbatim, directly ABOVE the upcoming-runs control. */}
        <li className="bg-amber-50 px-5 py-3.5">
          <p className="flex items-start gap-2 text-[13px] leading-relaxed text-amber-900">
            <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
            Runs you haven't done yet reveal where you'll be. We default this to connections only.
          </p>
        </li>
        <PrivacyRadioRow
          question="My upcoming runs & races"
          value={settings.show_upcoming_events}
          options={["public", "connections_only", "private"]}
          onSelect={(v) => onSave({ show_upcoming_events: v as api.ContentVisibilitySetting })}
        />
        <PrivacyRadioRow
          question="My saved runs & races"
          value={settings.show_saved_events}
          options={["connections_only", "private"]}
          onSelect={(v) => onSave({ show_saved_events: v as api.SavedEventsVisibilitySetting })}
        />
        <PrivacyRadioRow
          question="My past activity"
          value={settings.show_past_activity}
          options={["public", "connections_only", "private"]}
          onSelect={(v) => onSave({ show_past_activity: v as api.ContentVisibilitySetting })}
        />
        <PrivacyRadioRow
          question="My connections list"
          value={settings.show_connections_list}
          options={["public", "connections_only", "private"]}
          onSelect={(v) => onSave({ show_connections_list: v as api.ContentVisibilitySetting })}
        />
        <PrivacyRadioRow
          question="Posts I'm tagged in"
          value={settings.show_tagged_content}
          options={["public", "connections_only", "private"]}
          onSelect={(v) => onSave({ show_tagged_content: v as api.ContentVisibilitySetting })}
        />
        {/* searchable_by_name — its own switch, separated by the row border. */}
        <li className="border-t border-slate-100 px-5 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] font-medium text-slate-700">Let people find me by name</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.searchable_by_name}
              aria-label={`Let people find me by name ${settings.searchable_by_name ? "on" : "off"}`}
              onClick={() => onSave({ searchable_by_name: !settings.searchable_by_name })}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${settings.searchable_by_name ? "bg-[#14171C]" : "bg-slate-300"}`}
            >
              <span aria-hidden="true" className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${settings.searchable_by_name ? "left-6" : "left-1"}`} />
            </button>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Controls whether you appear in Find People.</p>
        </li>
      </ul>
      <p className="border-t border-slate-100 px-5 py-3 text-[11px] leading-relaxed text-slate-400">
        {saving ? "Saving…" : "Changes save as you tap."} These choices control what other runners can see on your
        public profile; verification records and your private activity stay private to your account.
      </p>
    </section>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { me, backendAvailable, signOut, deleteMyAccount, refresh } = useAccount();
  const { city, cityId, signedIn, hasHomeCity, selectCity } = useSelectedCity();
  const [notificationPrefs, setNotificationPrefs] = useState<api.NotificationPreferences>({run_reminders:false,community_updates:false,account_alerts:false});
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [privacySettings, setPrivacySettings] = useState<api.PrivacySettings | null>(null);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | "unsupported">(typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported");
  const { unreadCount } = useNotifications();
  useEffect(() => { if (!signedIn) return; void api.getNotificationPreferences().then(r => { if (r.ok) setNotificationPrefs(r.data.preferences); else setNotificationError(r.error.message); }).catch(() => setNotificationError("Couldn’t load notification preferences. Try again.")); }, [signedIn]);
  const toggleNotification = async (key: keyof api.NotificationPreferences) => { const next = {...notificationPrefs, [key]: !notificationPrefs[key]}; setNotificationError(null); setNotificationPrefs(next); const r = await api.updateNotificationPreferences({[key]: next[key]}); if (!r.ok) { setNotificationPrefs(notificationPrefs); setNotificationError(r.error.message ?? "Couldn’t save notification preference. Try again."); } };
  // Privacy settings load only when signed in; the section renders only after
  // the real server values arrive (never guessed defaults). Saves are
  // optimistic with revert on error, mirroring toggleNotification.
  useEffect(() => { if (!signedIn) return; void api.getPrivacy().then(r => { if (r.ok) setPrivacySettings(r.data.settings); else setPrivacyError(r.error.message ?? "Couldn't load privacy settings."); }); }, [signedIn]);
  const savePrivacy = async (patch: Partial<api.PrivacySettings>) => {
    if (!privacySettings) return;
    const prev = privacySettings;
    setPrivacySettings({ ...privacySettings, ...patch });
    setPrivacyError(null);
    setPrivacySaving(true);
    const r = await api.putPrivacy(patch);
    setPrivacySaving(false);
    if (!r.ok) { setPrivacySettings(prev); setPrivacyError(r.error.message ?? "Couldn't save privacy settings. Try again."); }
  };
  const [profileDetailsSaving, setProfileDetailsSaving] = useState(false);
  const [profileDetailsError, setProfileDetailsError] = useState<string | null>(null);
  const saveProfileDetails = async (patch: api.ProfileDetailsPatch) => {
    setProfileDetailsSaving(true);
    setProfileDetailsError(null);
    const r = await api.putProfileDetails(patch);
    setProfileDetailsSaving(false);
    if (r.ok) { await refresh(); toast("Profile details saved.", "success"); }
    else setProfileDetailsError(r.error.message ?? "Couldn't save profile details. Try again.");
  };
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
    if (!target || (hasHomeCity && target === cityId)) {
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
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading">
      <div data-tour-target="settings-main">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Settings</h1>
        <p className="mt-0.5 text-sm font-medium text-slate-500">Account preferences & status</p>
      </div>

      {!backendAvailable ? (
        <section className="mt-4 rounded-2xl bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <span className="font-semibold">Server API unreachable.</span> Identity, verification, and account settings
          are unavailable right now — you're browsing as a guest.
        </section>
      ) : null}

      {signedIn && account ? <UsernameEditor account={account} refresh={refresh} /> : null}
      {signedIn && account ? <ProfilePhotoSettings account={account} refresh={refresh} /> : null}
      {signedIn && account ? <ProfileDetailsSection account={account} onSave={saveProfileDetails} saving={profileDetailsSaving} error={profileDetailsError} /> : null}
      {signedIn && account ? <ChangePasswordSettings account={account} /> : null}
      {signedIn && account ? <ActivityConnections /> : null}
      {signedIn && account?.status === "verified" ? <WelcomeTourSettings /> : null}
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
                {verified ? <VerifiedBadge size="sm" /> : account.status === "rejected" ? <Chip tone="red">Denied</Chip> : <Chip tone="amber">{phaseLabel(account.phase)}</Chip>}
                {account.trustedMember ? <TrustedBadge size="sm" /> : null}
                {isOwner ? <Chip tone="brand">Super Admin</Chip> : <Chip tone="outline">{roleLabel(account.role)}</Chip>}
              </span>
            </li>
            {account.status === "rejected" ? (
              <li className="bg-red-50/70 px-5 py-3">
                <p className="text-[12px] leading-relaxed text-red-800">
                  <span className="font-semibold">Verification denied.</span> Your profile is read-only — no RSVPs,
                  posts, or submissions.
                  {account.rejectionReason ? (
                    <span className="mt-0.5 block"><span className="font-semibold">Why:</span> {account.rejectionReason}</span>
                  ) : null}
                </p>
              </li>
            ) : null}
            <li>
              <button
                type="button"
                onClick={() => navigate("/verify")}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-5 text-left active:bg-slate-50"
              >
                <span className="text-[14px] font-medium text-slate-700">Verification</span>
                <span className="flex items-center gap-1 text-[14px] font-semibold text-[#14171C]">
                  {verified || account.status === "rejected" ? "View status" : "Continue"} <Icon name="chevronRight" className="h-4 w-4 text-slate-300" />
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
        </ul>
      </section>

      {/* Privacy — who can see what on your public profile (between Preferences and Notifications) */}
      {signedIn && privacySettings ? (
        <PrivacySettingsSection
          settings={privacySettings}
          onSave={(patch) => void savePrivacy(patch)}
          saving={privacySaving}
          error={privacyError}
        />
      ) : null}

      {/* Notifications — one coherent section: category preferences, browser
          permission, and the link to the private notification center. */}
      {signedIn ? (
        <NotificationPreferencesSection
          prefs={notificationPrefs}
          unreadCount={unreadCount}
          browserPermission={browserPermission}
          error={notificationError}
          onToggle={(key) => void toggleNotification(key)}
          onAllowBrowser={() => void Notification.requestPermission().then(setBrowserPermission)}
        />
      ) : null}
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
                      active ? "border-[#14171C] bg-[#14171C] text-white" : "border-slate-200 bg-white text-slate-800"
                    } ${disabled ? "opacity-60" : "active:bg-slate-50"}`}
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                        active ? "bg-white/15 text-[#FF5741]" : "bg-slate-100 text-slate-500"
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
                    {active ? <Icon name="check" className="h-4 w-4 shrink-0 text-[#FF5741]" /> : disabled ? <Chip tone="amber">Coming soon</Chip> : null}
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
            <PillButton variant="primary" className="flex-1" disabled={cityBusy || pendingCityId === null || (hasHomeCity && pendingCityId === cityId)} onClick={() => void saveHomeCity()}>
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
        <section className="mt-4 overflow-hidden rounded-2xl bg-[#14171C] text-white shadow-sm ring-1 ring-[#14171C]/20">
          <h2 className="flex items-center gap-2 border-b border-white/10 px-5 py-3.5 text-[15px] font-bold">
            <Icon name="lock" className="h-4 w-4 text-[#FF5741]" /> Owner / Super Admin
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
                <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-[#FF5741]" />
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
  const providers = [{ id: "strava", label: "Strava" }, { id: "garmin", label: "Garmin" }, { id: "coros", label: "COROS" }, { id: "suunto", label: "Suunto" }] as const;
  const [providerState, setProviderState] = useState<Partial<Record<api.ActivityProvider, api.ProviderStatus>>>({});
  const [mode, setMode] = useState("manual");

  useEffect(() => {
    void Promise.all(providers.map(async (p) => {
      const result = await api.getProviderStatus(p.id);
      if (result.ok) setProviderState((current) => ({ ...current, [p.id]: result.data }));
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70"><h2 className="border-b border-slate-100 px-5 py-3.5 text-[15px] font-bold text-slate-900">Activity connections</h2><p className="px-5 py-3 text-xs leading-relaxed text-slate-500">Manual sharing is the default. Auto sharing is opt-in; Private keeps activities off the community feed.</p>{providers.map((p) => {
    const state = providerState[p.id];
    const value = state?.state ?? "unavailable";
    const copy = value === "coming_soon" ? "Coming soon" : value === "not_configured" ? "Not configured" : value === "connected" ? "Connected" : value === "available" ? "Available" : "Unavailable";
    const canConnect = p.id === "strava" && value === "available";
    return <div key={p.id} className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3"><div><strong className="text-sm text-slate-800">{p.label}</strong><p className="text-xs text-slate-500">{copy}</p></div><PillButton variant="ghost" disabled={!canConnect} onClick={() => { if (canConnect && state?.authorizeUrl) window.location.assign(state.authorizeUrl); }}>{canConnect ? "Connect" : value === "coming_soon" ? "Coming soon" : copy}</PillButton></div>;
  })}<label className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm font-medium">Share mode<select aria-label="Activity share mode" className="rounded-lg border border-slate-300 px-2 py-1" value={mode} onChange={(e) => setMode(e.target.value)}><option value="manual">Manual</option><option value="auto">Auto</option><option value="private">Private</option></select></label></section>;
}
