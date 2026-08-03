/**
 * Log in / Sign up — primary auth is Supabase email + password.
 *
 * Signup flow (honest, no fake auth):
 *  1. supabase.signUp(email, password) creates the Supabase auth user. The
 *     password is NEVER sent to Run Local and never stored client-side.
 *  2. The local Pending profile is then created through POST /api/accounts
 *     with ONLY profile metadata (name, email, birthdate, optional phone,
 *     optional profile photo) — this is the fix for the bug where Supabase
 *     created auth.users but Run Local never created the matching account.
 *  3a. If Supabase returns an immediate session (email confirmation off):
 *      the local account is created with a Run Local session, the Supabase
 *      identity is linked via /api/login/check, and the user is signed in.
 *  3b. If email confirmation is required (no Supabase session): the local
 *      pending account is created with `noSession: true` — NO Run Local
 *      session is claimed without a valid Supabase session. The user confirms
 *      by email link, then logs in; /api/login/check then links the verified
 *      Supabase identity to the pending account and signs them in.
 *
 * No six-digit OTP anywhere in this primary auth UI — it is email/password
 * with a confirmation link only. Verification (selfie + manual review) lives
 * on /verify.
 */
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon, PillButton } from "../components/ui";
import * as api from "../lib/api";
import { validateBirthdate } from "../lib/birthdate";
import * as supabase from "../lib/supabase";
import { useAccount } from "../state/account";

const inputCls =
  "h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0b2b22] focus:ring-2 focus:ring-[#c8f169]/60";

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
  const [searchParams] = useSearchParams();
  const { me, backendAvailable, refresh } = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // signup-only profile metadata
  const [name, setName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [birthdateError, setBirthdateError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "signup">(() => (searchParams.get("mode") === "signup" ? "signup" : "login"));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Best-effort profile photo upload. Only called AFTER a valid Run Local
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
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (mode === "signup") {
      if (name.trim().length < 2) {
        setError("Enter your name (at least 2 characters).");
        return;
      }
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

    if (mode === "signup") {
      const r = await supabase.signUp(e, password);
      if (!r.ok) {
        setBusy(false);
        setError(r.message);
        return;
      }
      if (r.emailConfirmationRequired) {
        // Supabase requires an email confirmation link (no session). Create
        // the local Pending profile WITHOUT a Run Local session — signed-in
        // status is never claimed without a valid Supabase session. The
        // account links to the confirmed identity on first login.
        const created = await api.createAccount({ name: name.trim(), email: e, birthdate, phone: phone.trim() || undefined, noSession: true });
        setBusy(false);
        if (created.ok || created.error.code === "email_taken") {
          setNotice(
            "Account created. Check your email and tap the confirmation link, then log in with your password. " +
              (photoDataUrl ? "You can add your profile photo right after your first sign-in." : ""),
          );
        } else {
          setNotice(
            "Your Supabase account was created, but Run Local couldn't save your profile right now. Confirm your email and log in — your account will finish setting up then.",
          );
        }
        setMode("login");
        setPassword("");
        setConfirm("");
        return;
      }
      if (!r.accessToken) {
        setBusy(false);
        setError("Supabase returned no session token. Nothing is faked.");
        return;
      }
      // Immediate session: create the local Pending account (this establishes
      // the Run Local session cookie) — never the password, only metadata.
      const created = await api.createAccount({ name: name.trim(), email: e, birthdate, phone: phone.trim() || undefined });
      if (!created.ok && created.error.code !== "email_taken") {
        setBusy(false);
        setError(
          created.error.code === "email_taken"
            ? "That email already has an account. Log in instead."
            : created.error.message ?? "Could not create your Run Local profile. Try again.",
        );
        return;
      }
      // Link the verified Supabase identity to the local account and confirm
      // the Run Local session (the server trusts the token, not client email).
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
      return;
    }
    if (!r.accessToken) {
      setBusy(false);
      setError("Supabase returned no session token. Nothing is faked.");
      return;
    }
    // /api/login/check links the verified Supabase identity and — if the
    // matching local account is missing (the signup-account bug) — creates it
    // from the verified identity before issuing the Run Local session.
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
    if (r.ok) setNotice("If that email has a Run Local account, Supabase will send password reset instructions.");
    else setError(r.message);
  };

  if (me?.status === "signed_in")
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6">
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/70">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#c8f169] text-[#0b2b22]">
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
        <p className="mb-4 rounded-xl bg-amber-50 p-3.5 text-[13px] text-amber-900">The Run Local server is unreachable — sign-in is unavailable.</p>
      )}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
        <h1 className="text-xl font-extrabold">{mode === "login" ? "Log in" : "Create your account"}</h1>
        <p className="mt-1 text-[13px] text-slate-600">
          {mode === "login"
            ? "Use your email and password. Your Run Local session is secured by server-side token validation."
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
                {photoError ? <p className="mt-1.5 text-xs font-medium text-red-600">{photoError}</p> : null}
                <span className="mt-1 block text-[11px] text-slate-400">Optional — you can add it later. This photo is public.</span>
              </label>
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
              className={inputCls}
            />
          </label>
          {mode === "signup" && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">Confirm password</span>
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} />
            </label>
          )}
          {error && <p className="rounded-xl bg-red-50 p-3.5 text-[13px] text-red-800">{error}</p>}
          {notice && <p className="rounded-xl bg-emerald-50 p-3.5 text-[13px] text-emerald-900">{notice}</p>}
          <PillButton variant="primary" className="w-full" disabled={busy} onClick={() => void submit()}>
            {busy ? (mode === "login" ? "Logging in…" : "Creating account…") : mode === "login" ? "Log in" : "Create account"}
          </PillButton>
          {mode === "login" && (
            <button type="button" disabled={busy} onClick={() => void reset()} className="block w-full text-center text-sm font-semibold text-[#0b2b22] underline">
              Forgot password?
            </button>
          )}
          <p className="text-center text-xs text-slate-400">
            {mode === "login" ? "New here?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setError(null);
                setNotice(null);
              }}
              className="font-semibold text-[#0b2b22] underline"
            >
              {mode === "login" ? "Create an account" : "Log in instead"}
            </button>
          </p>
        </div>
      </section>
    </div>
  );
}
