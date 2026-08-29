/**
 * Log in / Sign up — primary auth is Supabase email + password.
 *
 * Signup flow (honest, no fake auth):
 *  1. supabase.signUp(email, password) creates the Supabase auth user. The
 *     password is NEVER sent to Kimbio and never stored client-side.
 *  2. The local Pending profile is then created through POST /api/accounts
 *     with ONLY profile metadata (name, username, email, birthdate, optional
 *     phone, optional profile photo) — this is the fix for the bug where
 *     Supabase created auth.users but Kimbio never created the matching
 *     account. Username uniqueness is enforced server-side (see
 *     src/lib/username.ts).
 *  3a. If Supabase returns an immediate session (email confirmation off):
 *      the local account is created with a Kimbio session, the Supabase
 *      identity is linked via /api/login/check, and the user is signed in.
 *  3b. If email confirmation is required (no Supabase session): the local
 *      pending account is created with `noSession: true` — NO Kimbio
 *      session is claimed without a valid Supabase session. The user confirms
 *      by email link, then logs in; /api/login/check then links the verified
 *      Supabase identity to the pending account and signs them in.
 *
 * No six-digit OTP anywhere in this primary auth UI — it is email/password
 * with a confirmation link only. Verification (selfie + manual review) lives
 * on /verify.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Chip, Icon, PillButton } from "../components/ui";
import { ResendConfirmationBox } from "../components/ResendConfirmationBox";
import * as api from "../lib/api";
import { getStoredUtm } from "../lib/analytics";
import { validateBirthdate } from "../lib/birthdate";
import * as supabase from "../lib/supabase";
import { normalizeUsername, USERNAME_HINT } from "../lib/username";
import { normalizeErrorMessage } from "../lib/errors";
import { CITIES } from "../data/cities";
import { useAccount } from "../state/account";

export const PASSWORD_REQUIREMENTS = [
  { key: "length", label: "At least 6 characters", test: (value: string) => value.length >= 6 },
  { key: "lowercase", label: "One lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { key: "uppercase", label: "One uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { key: "digit", label: "One digit", test: (value: string) => /\d/.test(value) },
] as const;

export function passwordRequirements(value: string): boolean[] {
  return PASSWORD_REQUIREMENTS.map((requirement) => requirement.test(value));
}

export function usernameFormatValid(value: string): boolean {
  return normalizeUsername(value) !== null;
}

/** Pure signup gate used by the form and regression tests. */
export function signupFieldsValid(password: string, username: string, usernameAvailable: boolean): boolean {
  return password.length > 0 && passwordRequirements(password).every(Boolean) && usernameFormatValid(username) && usernameAvailable;
}

export const USERNAME_AVAILABILITY_DEBOUNCE_MS = 400;
export function isCurrentUsernameRequest(requestId: number, currentRequestId: number): boolean {
  return requestId === currentRequestId;
}

/** Provider failures can be arbitrary values; never render an object as "[object Object]" or "{}". */
export function authErrorText(value: unknown): string {
  return normalizeErrorMessage(value, "Could not complete signup. Please try again.");
}

const inputCls =
  "h-12 w-full rounded-[10px] border border-slate-300 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";

/**
 * Explicit, honest caveat shown whenever we tell a user an email is coming but
 * this deployment hasn't confirmed an email-delivery provider. Never claims
 * delivery that isn't guaranteed.
 */
export function emailDeliveryCaveat(deliveryState: "provider-managed" | "not-configured"): string {
  return deliveryState === "not-configured"
    ? " Email delivery isn't confirmed on this deployment — if no email arrives, use the resend option below."
    : "";
}

/** Signup success notice for the email-confirmation-required path (caveat-aware). */
export function signupConfirmationNotice(deliveryState: "provider-managed" | "not-configured", photoIncluded: boolean): string {
  return (
    "Account created. Check your email and tap the confirmation link, then log in with your password." +
    emailDeliveryCaveat(deliveryState) +
    (photoIncluded ? " You can add your profile photo right after your first sign-in." : "")
  );
}

/**
 * Map the URL's `mode` search param to the login/signup mode. The URL is the
 * single source of truth for which form is shown: the header "Log in" CTA
 * navigates to /login (no param), the account menu "Sign up" entry navigates
 * to /login?mode=signup, and the in-form toggles update the param. Deriving
 * the mode from the URL (instead of copying it into state once) guarantees a
 * navigation while the page is already mounted — e.g. tapping header "Log in"
 * while on #/login?mode=signup — always switches the rendered form, with no
 * hard reload and no stale state.
 */
export function loginModeFromSearch(search: URLSearchParams): "login" | "signup" {
  return search.get("mode") === "signup" ? "signup" : "login";
}

/** Downscale a chosen image to a compact JPEG data URL (same as the profile step). */
async function fileToDataUrl(file: File, maxEdge = 512, quality = 0.82): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image decode failed"));
    el.src = dataUrl;
  });
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { me, backendAvailable, refresh } = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // signup-only profile metadata
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameAvailability, setUsernameAvailability] = useState<"idle" | "loading" | "available" | "taken" | "error">("idle");
  const usernameRequest = useRef(0);
  const [birthdate, setBirthdate] = useState("");
  const [birthdateError, setBirthdateError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Required home city — exactly one supported city, chosen at signup. The
  // server re-validates it against the known city entities; this state is
  // only the in-form selection.
  const [cityId, setCityId] = useState<string | null>(null);
  const [cityError, setCityError] = useState<string | null>(null);
  // Which form is shown is derived from the URL (`?mode=signup`), never copied
  // into state: navigating to /login while this page is mounted (header "Log
  // in" CTA) re-derives login mode without a reload, and the in-form toggle
  // writes the param back so the URL always reflects the visible form.
  const mode = loginModeFromSearch(searchParams);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailDeliveryState] = useState(() => supabase.supabaseClientConfig().emailDelivery);
  // Email of the account whose confirmation link hasn't arrived yet — when set,
  // a visible "Resend confirmation email" action is rendered. Set on the
  // email-confirmation-required signup path and on the email-not-confirmed
  // login error; cleared on mode switch and on each fresh submit.
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  const passwordChecks = passwordRequirements(password);
  const passwordValid = password.length > 0 && passwordChecks.every(Boolean);
  const usernameTyped = username.length > 0;
  const usernameValid = usernameFormatValid(username);

  useEffect(() => {
    const requestId = ++usernameRequest.current;
    setUsernameAvailability(usernameValid ? "loading" : "idle");
    if (!usernameValid) return;
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.checkUsernameAvailability(username);
        if (requestId !== usernameRequest.current) return;
        setUsernameAvailability(result.ok && result.data.available ? "available" : result.ok ? "taken" : "error");
      } catch {
        if (requestId === usernameRequest.current) setUsernameAvailability("error");
      }
    }, USERNAME_AVAILABILITY_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [username, usernameValid]);

  /**
   * Resend the signup confirmation email to the address used at signup. Success
   * means the provider accepted the request — delivery is never claimed, and
   * the not-configured caveat stays visible via the box.
   */
  const resendConfirmation = async () => {
    if (!pendingConfirmationEmail) return;
    setResendError(null);
    setResendNotice(null);
    setResending(true);
    const r = await supabase.resendConfirmationEmail(pendingConfirmationEmail);
    setResending(false);
    if (!r.ok) {
      setResendError(r.message);
      return;
    }
    setResendNotice("Confirmation email requested. If that address exists, check your inbox (and spam folder) — delivery depends on the configured email provider.");
  };

  /**
   * Best-effort profile photo upload. Only called AFTER a valid Kimbio
   * session exists (never before). On failure the data URL is kept so the
   * next successful login retries it — nothing is silently dropped or faked.
   */
  const uploadPendingPhoto = async (): Promise<string | null> => {
    if (!photoDataUrl) return null;
    const up = await api.uploadProfilePhoto(photoDataUrl);
    if (!up.ok) return "Your account is set up, but the profile photo couldn't upload yet — it will retry on your next sign-in.";
    setPhotoDataUrl(null);
    return null;
  };

  const finishSignedIn = async (account: api.ApiResult<{ status: string; account: import("../lib/accounts").PublicAccount }>) => {
    if (!account.ok) return;
    const photoMsg = await uploadPendingPhoto();
    if (photoMsg) setNotice(photoMsg);
    await refresh();
    navigate(account.data.account.status === "verified" ? "/profile" : "/verify");
  };

  const submit = async () => {
    setError(null);
    setNotice(null);
    const e = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) {
      setError("Enter a valid email.");
      return;
    }
    if (!passwordValid) {
      setError("Password must be at least 6 characters and include a lowercase letter, uppercase letter, and digit.");
      return;
    }
    if (mode === "signup") {
      if (name.trim().length < 2) {
        setError("Enter your name (at least 2 characters).");
        return;
      }
      if (!usernameValid) {
        setError("Choose a username — 3–24 characters: letters, numbers, _ or -, starting with a letter.");
        return;
      }
      if (usernameAvailability !== "available") {
        setError(usernameAvailability === "taken" ? "That username is already taken — try another." : "Wait for username availability to finish checking, then try again.");
        return;
      }
      // Exactly one supported city must be chosen before signup proceeds; the
      // server re-validates the id against the known city entities.
      if (!cityId) {
        setCityError("Choose your home city — this is required.");
        return;
      }
      setCityError(null);
      const birthdateCheck = validateBirthdate(birthdate);
      if (!birthdateCheck.ok) {
        setBirthdateError(birthdateCheck.message);
        return;
      }
      setBirthdateError(null);
      const digits = phone.replace(/[\s().-]/g, "");
      if (phone.trim() && !/^\+?\d{10,15}$/.test(digits)) {
        setError("Enter a valid phone number, or leave it blank.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
    }
    setBusy(true);
    setPendingConfirmationEmail(null);
    setResendError(null);
    setResendNotice(null);

    if (mode === "signup") {
      const r = await supabase.signUp(e, password, { data: { username: normalizeUsername(username)!, display_name: name.trim() } });
      if (!r.ok) {
        setBusy(false);
        setError(r.message);
        return;
      }
      if (r.emailConfirmationRequired) {
        // Supabase requires an email confirmation link (no session). Create
        // the local Pending profile WITHOUT a Kimbio session — signed-in
        // status is never claimed without a valid Supabase session. The
        // account links to the confirmed identity on first login.
        const created = await api.createAccount({ name: name.trim(), username: username.trim(), email: e, birthdate, cityId: cityId!, phone: phone.trim() || undefined, noSession: true, ...getStoredUtm() });
        setBusy(false);
        if (created.ok || created.error.code === "email_taken") {
          setPendingConfirmationEmail(e);
          setNotice(signupConfirmationNotice(emailDeliveryState, Boolean(photoDataUrl)));
          setSearchParams({}, { replace: true });
          setPassword("");
          setConfirm("");
        } else if (created.error.code === "username_taken") {
          // The Supabase auth user exists but the local profile wasn't saved —
          // let the runner pick a free name and finish here. Nothing is faked:
          // the account is linked on first confirmed login.
          setError("That username is already taken — try another.");
        } else if (created.error.code === "invalid_username") {
          setError(created.error.message ?? "Pick a valid username.");
        } else if (created.error.code === "invalid_city" || created.error.code === "city_required") {
          setCityError(created.error.message ?? "Pick a supported city.");
        } else {
          setPendingConfirmationEmail(e);
          setNotice(
            "Your Supabase account was created, but Kimbio couldn't save your profile right now. Confirm your email and log in — your account will finish setting up then." +
              emailDeliveryCaveat(emailDeliveryState),
          );
          setSearchParams({}, { replace: true });
          setPassword("");
          setConfirm("");
        }
        return;
      }
      if (!r.accessToken) {
        setBusy(false);
        setError("Supabase returned no session token. Nothing is faked.");
        return;
      }
      // Immediate session: create the local Pending account (this establishes
      // the Kimbio session cookie) — never the password, only metadata.
      const created = await api.createAccount({ name: name.trim(), username: username.trim(), email: e, birthdate, cityId: cityId!, phone: phone.trim() || undefined, ...getStoredUtm() });
      if (!created.ok) {
        setBusy(false);
        if (created.error.code === "email_taken") setError(supabase.ACCOUNT_EXISTS_MESSAGE);
        else if (created.error.code === "username_taken") setError("That username is already taken — try another.");
        else if (created.error.code === "invalid_username") setError(created.error.message ?? "Pick a valid username.");
        else if (created.error.code === "invalid_city" || created.error.code === "city_required") setCityError(created.error.message ?? "Pick a supported city.");
        else setError(created.error.message ?? "Could not create your Kimbio profile. Try again.");
        return;
      }
      // Link the verified Supabase identity to the local account and confirm
      // the Kimbio session (the server trusts the token, not client email).
      const checked = await api.loginCheck(r.accessToken);
      setBusy(false);
      if (!checked.ok) {
        setError(checked.error.message ?? "The server rejected this session.");
        return;
      }
      await finishSignedIn(checked);
      return;
    }

    // ---- login mode -----------------------------------------------------
    const r = await supabase.signInWithPassword(e, password);
    if (!r.ok) {
      setBusy(false);
      setError(r.message);
      // An unconfirmed email blocks login — offer the resend action right here
      // instead of leaving the runner stuck ("Confirm your email... then try
      // again" with no way to get a fresh link).
      if (r.code === "email_not_confirmed") setPendingConfirmationEmail(e);
      return;
    }
    if (!r.accessToken) {
      setBusy(false);
      setError("Supabase returned no session token. Nothing is faked.");
      return;
    }
    // /api/login/check links the verified Supabase identity and — if the
    // matching local account is missing (the signup-account bug) — creates it
    // from the verified identity before issuing the Kimbio session.
    const checked = await api.loginCheck(r.accessToken);
    setBusy(false);
    if (!checked.ok) {
      setError(checked.error.message ?? "The server rejected this session.");
      return;
    }
    await finishSignedIn(checked);
  };

  const reset = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setBusy(true);
    const r = await supabase.resetPasswordForEmail(email.trim());
    setBusy(false);
    if (r.ok) setNotice(`If that email has a Kimbio account, Supabase will send password reset instructions. ${emailDeliveryState === "not-configured" ? "Email delivery provider status is not configured in this deployment; delivery is not guaranteed." : "Delivery is handled by the configured provider."}`);
    else setError(r.message);
  };

  if (me?.status === "signed_in")
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6">
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/70">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-[10px] bg-[#FF5741] text-[#14171C]">
            <Icon name="check" className="h-7 w-7" />
          </span>
          <h1 className="mt-3 text-xl font-extrabold">You're signed in</h1>
          <PillButton variant="primary" className="mt-4 w-full" onClick={() => navigate("/profile")}>
            Go to my profile
          </PillButton>
        </div>
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4">
      <button type="button" onClick={() => navigate(-1)} className="mb-3 flex items-center gap-1 text-[13px] font-semibold text-slate-500">
        <Icon name="chevronRight" className="h-4 w-4 rotate-180" /> Back
      </button>
      {!backendAvailable && (
        <p className="mb-4 rounded-xl bg-amber-50 p-3.5 text-[13px] text-amber-900">The Kimbio server is unreachable — sign-in is unavailable.</p>
      )}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
        <h1 className="text-xl font-extrabold">{mode === "login" ? "Log in" : "Create your account"}</h1>
        <p className="mt-1 text-[13px] text-slate-600">
          {mode === "login"
            ? "Use your email and password. Your Kimbio session is secured by server-side token validation."
            : "Sign up with email and password. We'll email you a confirmation link, then you'll finish identity verification from your profile."}
        </p>
        <div className="mt-4 space-y-4">
          {mode === "signup" && (
            <>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Name</span>
                <input type="text" autoComplete="name" placeholder="Jordan Lee" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Username</span>
                <input
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="jordanlee"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  aria-invalid={usernameTyped && (!usernameValid || usernameAvailability === "taken" || usernameAvailability === "error") ? true : undefined}
                  className={`${inputCls} ${usernameTyped && !usernameValid ? "border-red-400 focus:border-red-500 focus:ring-red-200" : usernameAvailability === "available" ? "border-emerald-500 focus:border-emerald-600 focus:ring-emerald-200" : usernameAvailability === "taken" || usernameAvailability === "error" ? "border-red-400 focus:border-red-500 focus:ring-red-200" : ""}`}
                />
                {usernameTyped && !usernameValid ? <p role="alert" className="mt-1 text-xs font-medium text-red-600"><span aria-hidden="true" className="mr-1">✕</span>Use 3–24 characters, starting with a letter; letters, numbers, _ and - only.</p> : null}
                {usernameTyped && usernameValid && usernameAvailability === "loading" ? <p className="mt-1 text-xs text-slate-500" role="status"><span aria-hidden="true" className="mr-1 inline-block animate-spin">◌</span>Checking availability…</p> : null}
                {usernameTyped && usernameValid && usernameAvailability === "available" ? <p className="mt-1 text-xs font-medium text-emerald-600" role="status"><span aria-hidden="true" className="mr-1">✓</span>Username available</p> : null}
                {usernameTyped && usernameValid && usernameAvailability === "taken" ? <p role="alert" className="mt-1 text-xs font-medium text-red-600"><span aria-hidden="true" className="mr-1">✕</span>Username already taken</p> : null}
                {usernameTyped && usernameValid && usernameAvailability === "error" ? <p role="alert" className="mt-1 text-xs font-medium text-red-600"><span aria-hidden="true" className="mr-1">✕</span>Couldn’t check availability. Try again.</p> : null}
                <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">{USERNAME_HINT}</span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Birthdate (you must be at least 16)</span>
                <input
                  type="date"
                  value={birthdate}
                  onChange={(e) => {
                    setBirthdate(e.target.value);
                    setBirthdateError(null);
                  }}
                  className={inputCls}
                  aria-invalid={birthdateError ? true : undefined}
                />
                {birthdateError ? (
                  <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
                    {birthdateError}
                  </p>
                ) : null}
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Phone (optional)</span>
                <input
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="(573) 555-0123"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputCls}
                />
                <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">Stored privately and never shown publicly. No SMS is ever sent.</span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Profile photo (optional)</span>
                <div className="flex items-center gap-3">
                  {photoDataUrl ? (
                    <img src={photoDataUrl} alt="Profile preview" className="h-16 w-16 rounded-full object-cover ring-2 ring-slate-200" />
                  ) : (
                    <span className="grid h-16 w-16 place-items-center rounded-full bg-slate-100 text-slate-400">
                      <Icon name="users" className="h-7 w-7" />
                    </span>
                  )}
                  <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-slate-100 px-4 text-sm font-semibold text-slate-700 active:bg-slate-200">
                    <Icon name="plus" className="h-4 w-4" />
                    {photoDataUrl ? "Change" : "Choose photo"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 8 * 1024 * 1024) {
                          setPhotoError("That image is too large — pick one under 8 MB.");
                          return;
                        }
                        try {
                          setPhotoDataUrl(await fileToDataUrl(file));
                          setPhotoError(null);
                        } catch {
                          setPhotoError("Couldn't read that image. Try a JPG or PNG.");
                        }
                      }}
                    />
                  </label>
                </div>
                {photoError ? <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{photoError}</p> : null}
                <span className="mt-1 block text-[11px] text-slate-400">Optional — you can add it later. This photo is public.</span>
              </label>
              <div>
                <span className="mb-1.5 block text-sm font-semibold">Home city</span>
                <ul className="space-y-2" role="radiogroup" aria-label="Home city">
                  {CITIES.map((c) => {
                    const active = cityId === c.id;
                    const disabled = !c.live;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={disabled}
                          onClick={() => {
                            setCityId(c.id);
                            setCityError(null);
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
                          {active ? (
                            <Icon name="check" className="h-4 w-4 shrink-0 text-[#FF5741]" />
                          ) : disabled ? (
                            <Chip tone="amber">Coming soon</Chip>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {cityError ? (
                  <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
                    {cityError}
                  </p>
                ) : null}
                <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">
                  Kimbio is city-scoped — this is the community your home, events, races, and forum default to. You can
                  change it later in Settings.
                </span>
              </div>
            </>
          )}
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Password</span>
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={mode === "signup" && password.length > 0 && !passwordValid ? true : undefined}
              className={`${inputCls} ${mode === "signup" && password.length > 0 ? passwordValid ? "border-emerald-500 focus:border-emerald-600 focus:ring-emerald-200" : "border-slate-400 focus:border-slate-500" : ""}`}
            />
            {mode === "signup" ? <ul aria-label="Password requirements" className="mt-2 space-y-1 text-xs">{PASSWORD_REQUIREMENTS.map((requirement, index) => { const met = passwordChecks[index]; return <li key={requirement.key} className={password.length > 0 && !met ? "text-red-600" : met ? "text-emerald-600" : "text-slate-500"}><span aria-hidden="true" className="mr-1">{met ? "✓" : "○"}</span>{requirement.label}</li>; })}</ul> : null}
          </label>
          {mode === "signup" && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">Confirm password</span>
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} />
            </label>
          )}
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3.5 text-[13px] text-red-800">{authErrorText(error)}</p>}
          {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3.5 text-[13px] text-emerald-900">{notice}</p>}
          {pendingConfirmationEmail && (
            <ResendConfirmationBox
              email={pendingConfirmationEmail}
              deliveryState={emailDeliveryState}
              resending={resending}
              error={resendError}
              notice={resendNotice}
              onResend={() => void resendConfirmation()}
            />
          )}
          <PillButton variant="primary" className="w-full" disabled={busy} onClick={() => void submit()}>
            {busy ? (mode === "login" ? "Logging in…" : "Creating account…") : mode === "login" ? "Log in" : "Create account"}
          </PillButton>
          {mode === "signup" ? (
            <p className="text-center text-[12px] text-slate-500">
              By creating an account, you agree to Kimbio's{" "}
              <Link to="/legal#terms" className="font-semibold text-slate-700 underline underline-offset-2">Terms of Service</Link>
              {" "}and{" "}
              <Link to="/legal#privacy" className="font-semibold text-slate-700 underline underline-offset-2">Privacy Policy</Link>.
            </p>
          ) : null}
          {mode === "login" && (
            <button type="button" disabled={busy} onClick={() => void reset()} className="block w-full text-center text-sm font-semibold text-[#14171C] underline">
              Forgot password?
            </button>
          )}
          <p className="text-center text-xs text-slate-400">
            {mode === "login" ? "New here?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                // Write the mode back to the URL (replace — no history spam) so
                // the header "Log in" CTA and deep links always land on the form
                // the URL advertises. Field state is preserved: only the param
                // changes, the page stays mounted.
                setSearchParams(mode === "login" ? { mode: "signup" } : {}, { replace: true });
                setError(null);
                setNotice(null);
                setCityError(null);
                setPendingConfirmationEmail(null);
                setResendError(null);
                setResendNotice(null);
              }}
              className="font-semibold text-[#14171C] underline"
            >
              {mode === "login" ? "Create an account" : "Log in instead"}
            </button>
          </p>
        </div>
      </section>
    </div>
  );
}
