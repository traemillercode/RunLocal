/**
 * Verification flow — mobile-first wizard.
 *
 * profile → email code → consent → camera → submitted
 *
 * Honesty rules baked in:
 *  - Phone is NOT collected in this flow — it remains an optional, unverified
 *    profile field reserved for a future upgrade. Verification is email code
 *    only; there is no SMS.
 *  - Email codes are delivered by Supabase Auth email verification (email verification /
 *    verification code, browser-safe anon key only). The server independently
 *    validates the Supabase identity before advancing the funnel — a code
 *    alone never grants the Verified badge.
 *  - Code uses auto-advancing numeric digit boxes (inputMode="numeric").
 *  - The camera opens ONLY after explicit consent (state machine enforced).
 *  - Selfie capture is getUserMedia-only; no gallery/file input.
 *  - No fake success: unconfigured/error/pending states are explicit.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CameraCapture } from "../components/CameraCapture";
import { CodeEntry } from "../components/CodeEntry";
import { Icon, PillButton } from "../components/ui";
import * as api from "../lib/api";
import { validateBirthdate } from "../lib/birthdate";
import { CODE_LENGTH, emptyCodeState, type CodeState } from "../lib/numericCode";
import * as supabaseOtp from "../lib/supabase";
import { canOpenCamera, initialState, verifyReducer } from "../lib/verificationFlow";
import { useAccount } from "../state/account";

// ---------------------------------------------------------------- utils
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

// ---------------------------------------------------------------- UI bits
function StepBadge({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-[#0b2b22] text-[12px] font-bold text-[#c8f169]">{step}</span>
      <span className="text-[13px] font-semibold text-slate-700">{label}</span>
      <span className="ml-auto text-[11px] font-medium text-slate-400">
        Step {step} of {total}
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0b2b22] focus:ring-2 focus:ring-[#c8f169]/60";

function Notice({ tone, children }: { tone: "amber" | "sky" | "emerald" | "red"; children: React.ReactNode }) {
  const tones = {
    amber: "bg-amber-50 text-amber-900",
    sky: "bg-sky-50 text-sky-900",
    emerald: "bg-emerald-50 text-emerald-900",
    red: "bg-red-50 text-red-800",
  };
  return <p className={`flex items-start gap-2 rounded-xl p-3.5 text-[13px] leading-relaxed ${tones[tone]}`}>{children}</p>;
}

// ------------------------------------------------------------------- page
export function VerifyPage() {
  const navigate = useNavigate();
  const { me, refresh } = useAccount();
  const [flow, dispatch] = useReducer(verifyReducer, initialState());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // profile step
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // profile contact fields
  const [birthdate, setBirthdate] = useState("");
  const [birthdateError, setBirthdateError] = useState<string | null>(null);
  // Optional role request (label only — the owner assigns the real role at
  // approval; requesting never grants anything by itself).
  const [requestedRole, setRequestedRole] = useState<"runner" | "group_leader" | null>(null);
  const [emailUnconfigured, setEmailUnconfigured] = useState(false);
  const [emailSendFailed, setEmailSendFailed] = useState<string | null>(null);

  // code step
  const [code, setCode] = useState<CodeState>(emptyCodeState());
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const resendTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // consent step
  const [consentChecked, setConsentChecked] = useState(false);

  // camera step
  const [retentionYears, setRetentionYears] = useState(3);

  // Resume from server-side phase once /api/me arrives
  useEffect(() => {
    if (me?.status === "signed_in" && me.account.status === "pending") {
      dispatch({ type: "RESUME", serverPhase: me.account.phase });
    }
  }, [me]);

  useEffect(() => {
    void api.getHealth().then((r) => {
      if (r.ok) setRetentionYears(r.data.retentionYears);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (resendTimer.current) clearInterval(resendTimer.current);
    };
  }, []);

  const startResendTimer = useCallback((secs: number) => {
    setResendIn(secs);
    if (resendTimer.current) clearInterval(resendTimer.current);
    resendTimer.current = setInterval(() => {
      setResendIn((s) => {
        if (s <= 1 && resendTimer.current) clearInterval(resendTimer.current);
        return Math.max(0, s - 1);
      });
    }, 1000);
  }, []);

  // --- step: profile -----------------------------------------------------
  const submitProfile = async () => {
    setError(null);
    if (name.trim().length < 2) {
      setError("Enter your name (at least 2 characters).");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError("Enter a valid email — we'll use it for your account.");
      return;
    }
    // Client-side birthdate guard: the date input is not inside a <form>, so
    // HTML `required` alone never blocks submission. The server still enforces
    // the same rule (400 minimum_age) — this just gives a clear inline error.
    const birthdateCheck = validateBirthdate(birthdate);
    if (!birthdateCheck.ok) {
      setBirthdateError(birthdateCheck.message);
      return;
    }
    setBirthdateError(null);
    setBusy(true);
    const created = await api.createAccount({ name: name.trim(), email: email.trim(), birthdate, requestedRole: requestedRole ?? undefined });
    if (!created.ok) {
      setBusy(false);
      setError(
        created.error.code === "email_taken"
          ? "That email already has an account on this device. Sign out from Profile first, or use a different email."
          : created.error.message ?? "Could not create your account. Try again.",
      );
      return;
    }
    if (photoDataUrl) {
      const up = await api.uploadProfilePhoto(photoDataUrl);
      if (!up.ok) {
        setBusy(false);
        setError("Your account was created but the profile photo failed to upload — you can skip it for now.");
        dispatch({ type: "GOTO", phase: "email" });
        await refresh();
        return;
      }
    }
    setBusy(false);
    dispatch({ type: "GOTO", phase: "email" });
    await refresh();
  };

  // --- step: email -------------------------------------------------------
  // Server gate first (phase + config + rate limit), then Supabase actually
  // sends the code. We only advance when Supabase confirmed the send.
  const sendEmailCode = async () => {
    setError(null);
    setEmailUnconfigured(false);
    setEmailSendFailed(null);
    setBusy(true);
    const gate = await api.requestOtp();
    if (gate.ok) {
      const sent = await supabaseOtp.sendOtp(email.trim());
      setBusy(false);
      if (sent.ok) {
        dispatch({ type: "GOTO", phase: "code" });
        startResendTimer(gate.data.resendInSec ?? 30);
        return;
      }
      if (sent.code === "unconfigured") {
        setEmailUnconfigured(true);
      } else if (sent.code === "rate_limited") {
        setError(sent.message);
      } else {
        setEmailSendFailed(sent.message);
      }
      return;
    }
    setBusy(false);
    if (gate.error.code === "email_unconfigured") {
      setEmailUnconfigured(true);
      setError(null);
    } else if (gate.error.code === "rate_limited") {
      setError(gate.error.message ?? "Too many codes sent. Try again in an hour.");
    } else if (gate.error.code === "wrong_step") {
      setError("Verification is already past the email step — continue from your profile.");
    } else {
      setError(gate.error.message ?? "Could not send the code. Try again.");
    }
  };

  // --- step: code --------------------------------------------------------
  const submitCode = async (c: string) => {
    setCodeError(null);
    setBusy(true);
    // Verify the 6-digit code with Supabase; on success hand the access token
    // to the server, which validates it before advancing the funnel.
    const verified = await supabaseOtp.verifyOtp(email.trim(), c);
    if (!verified.ok) {
      setBusy(false);
      setCode(emptyCodeState());
      if (verified.code === "code_expired") {
        setCodeError(verified.message);
      } else if (verified.code === "invalid_code") {
        setCodeError(verified.message);
      } else if (verified.code === "rate_limited") {
        setCodeError(verified.message);
      } else if (verified.code === "unconfigured") {
        setCodeError("Email verification isn't configured on this deployment, so the code can't be checked. No success is faked.");
      } else {
        setCodeError(verified.message);
      }
      return;
    }
    const result = await api.confirmEmailOtp(verified.accessToken);
    setBusy(false);
    if (result.ok) {
      setCode(emptyCodeState());
      dispatch({ type: "GOTO", phase: "consent" });
      await refresh();
      return;
    }
    setCode(emptyCodeState());
    switch (result.error.code) {
      case "auth_failed":
        setCodeError(result.error.message ?? "The verification session was rejected — request a new code.");
        break;
      case "email_unconfigured":
        setCodeError("Email verification isn't configured on this server. No success is faked.");
        break;
      case "email_mismatch":
      case "identity_mismatch":
        setCodeError(result.error.message ?? "This verification session doesn't match your account.");
        break;
      case "wrong_step":
        setCodeError("Verification is already past the email step — continue from your profile.");
        break;
      default:
        setCodeError(result.error.message ?? "Could not verify the code.");
    }
  };

  const resendCode = async () => {
    setCodeError(null);
    setBusy(true);
    const gate = await api.requestOtp();
    if (!gate.ok) {
      setBusy(false);
      setCodeError(
        gate.error.code === "email_unconfigured"
          ? "Email verification isn't configured on this server. No code was sent — nothing is faked."
          : gate.error.message ?? "Could not resend the code.",
      );
      return;
    }
    const sent = await supabaseOtp.sendOtp(email.trim());
    setBusy(false);
    if (sent.ok) {
      setCode(emptyCodeState());
      startResendTimer(gate.data.resendInSec ?? 30);
    } else if (sent.code === "unconfigured") {
      setCodeError("Email verification isn't configured on this deployment. No code was sent — nothing is faked.");
    } else {
      setCodeError(sent.message);
    }
  };

  // --- step: camera -> submit -------------------------------------------
  const submitSelfie = async (dataUrl: string) => {
    setError(null);
    setBusy(true);
    const result = await api.submitSelfie(dataUrl);
    setBusy(false);
    if (result.ok) {
      dispatch({ type: "SUBMITTED" });
      await refresh();
    } else {
      setError(result.error.message ?? "Your selfie could not be submitted. Please retry.");
      dispatch({ type: "GOTO", phase: "consent" });
    }
  };

  // Already verified?
  if (me?.status === "signed_in" && me.account.status === "verified") {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6">
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/70">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#c8f169] text-[#0b2b22]">
            <Icon name="shield" className="h-7 w-7" />
          </span>
          <h1 className="mt-3 text-xl font-extrabold text-slate-900">You're verified</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Your identity check is complete. Your profile shows the Verified badge and you can RSVP and post.
          </p>
          <PillButton variant="primary" className="mt-4 w-full" onClick={() => navigate("/profile")}>
            Go to my profile
          </PillButton>
        </div>
      </div>
    );
  }

  const back = () => {
    setError(null);
    if (flow.phase === "email") {
      dispatch({ type: "GOTO", phase: "profile" });
    } else if (flow.phase === "code") {
      dispatch({ type: "GOTO", phase: "email" });
    } else if (flow.phase === "consent") {
      dispatch({ type: "GOTO", phase: "code" });
    } else if (flow.phase === "camera") {
      dispatch({ type: "CLOSE_CAMERA" }); // unmounts CameraCapture → stops tracks
    } else {
      navigate("/profile");
    }
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4">
      <button type="button" onClick={back} className="mb-3 flex items-center gap-1 text-[13px] font-semibold text-slate-500 active:text-slate-700">
        <Icon name="chevronRight" className="h-4 w-4 rotate-180" /> Back
      </button>

      {flow.phase === "profile" && (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <StepBadge step={1} total={4} label="Create your runner profile" />
          <p className="mb-4 text-[13px] leading-relaxed text-slate-600">
            Your name, email, and birthdate start your account, then you'll verify your email with a
            one-time code and complete a live selfie check — all from this phone.
          </p>
          <div className="space-y-4">
            <Field label="Name">
              <input type="text" autoComplete="name" placeholder="Jordan Lee" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Email">
              <input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Birthdate (you must be at least 16)">
              <input
                type="date"
                value={birthdate}
                onChange={(e) => {
                  setBirthdate(e.target.value);
                  setBirthdateError(null);
                }}
                className={inputCls}
                required
                aria-invalid={birthdateError ? true : undefined}
                aria-describedby={birthdateError ? "birthdate-error" : undefined}
              />
              {birthdateError ? (
                <p id="birthdate-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">
                  {birthdateError}
                </p>
              ) : null}
            </Field>
            <Field label="I'd like to join as">
              <select
                value={requestedRole ?? "runner"}
                onChange={(e) => setRequestedRole(e.target.value === "group_leader" ? "group_leader" : null)}
                className={inputCls}
              >
                <option value="runner">A runner (default)</option>
                <option value="group_leader">A group leader — I run a club or group</option>
              </select>
              <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">
                Just a request — the owner confirms roles at approval. Everyone verifies the same way.
              </span>
            </Field>
            <Field label="Profile photo (shown on your public profile)">
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
              <p className="mt-1 text-[11px] text-slate-400">Optional — you can add it later. This photo is public.</p>
            </Field>
            {error ? <Notice tone="red">{error}</Notice> : null}
            <PillButton variant="primary" className="w-full" disabled={busy} onClick={() => void submitProfile()}>
              {busy ? "Creating…" : "Continue to email verification"}
            </PillButton>
          </div>
        </section>
      )}

      {flow.phase === "email" && (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <StepBadge step={2} total={4} label="Verify your email" />
          <p className="mb-4 text-[13px] leading-relaxed text-slate-600">
            We'll email a one-time {CODE_LENGTH}-digit code to <span className="font-semibold">{email}</span>.
            Codes expire automatically — if yours expires, just request a new one. No phone number or SMS needed.
          </p>
          <div className="space-y-4">
            {emailUnconfigured ? (
              <Notice tone="amber">
                <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="font-semibold">Email verification isn't configured on this deployment yet.</span>{" "}
                  No code was sent, and verification can't continue until the operator sets up Supabase Auth (the
                  VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables). Nothing is faked — this is an
                  explicit unconfigured state.
                </span>
              </Notice>
            ) : null}
            {emailSendFailed ? <Notice tone="red">{emailSendFailed}</Notice> : null}
            {error ? <Notice tone="red">{error}</Notice> : null}
            <PillButton variant="primary" className="w-full" disabled={busy} onClick={() => void sendEmailCode()}>
              {busy ? "Sending…" : "Send code"}
            </PillButton>
            <p className="text-center text-xs leading-relaxed text-slate-400">
              Email codes are delivered by Supabase Auth. The code alone doesn't finish verification — you'll still
              complete the selfie check, which a Run Local administrator reviews manually.
            </p>
          </div>
        </section>
      )}

      {flow.phase === "code" && (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <StepBadge step={3} total={4} label="Enter the code" />
          <p className="mb-4 text-[13px] leading-relaxed text-slate-600">
            We emailed a {CODE_LENGTH}-digit code to your email. It auto-advances as you type.
          </p>
          <CodeEntry value={code} onChange={setCode} onComplete={(c) => void submitCode(c)} disabled={busy} />
          {codeError ? <div className="mt-3"><Notice tone="red">{codeError}</Notice></div> : null}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {resendIn > 0 ? `Resend available in ${resendIn}s` : "Didn't get it?"}
            </span>
            <button
              type="button"
              disabled={resendIn > 0 || busy}
              onClick={() => void resendCode()}
              className="text-sm font-semibold text-[#0b2b22] underline underline-offset-2 disabled:text-slate-300"
            >
              Resend code
            </button>
          </div>
        </section>
      )}

      {flow.phase === "consent" && (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <StepBadge step={4} total={4} label="Selfie verification — your consent matters" />
          <div className="space-y-3 text-[13px] leading-relaxed text-slate-700">
            <p className="font-semibold text-slate-900">Before your camera opens, please read this:</p>
            <ul className="space-y-2.5">
              <li className="flex gap-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span><span className="font-semibold">Live capture only.</span> You'll take one live photo with your camera. Gallery uploads are not accepted.</span>
              </li>
              <li className="flex gap-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span><span className="font-semibold">Compared to your profile photo.</span> A Run Local staff member reviews that the live photo matches the profile photo you chose.</span>
              </li>
              <li className="flex gap-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span><span className="font-semibold">Never public, never used for discovery.</span> Your selfie is never shown on your profile, and is never used to match, message, or suggest other people.</span>
              </li>
              <li className="flex gap-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span><span className="font-semibold">Retention: {retentionYears} year{retentionYears === 1 ? "" : "s"}.</span> Your verification record (photo, phone, timestamps) is deleted after {retentionYears} year{retentionYears === 1 ? "" : "s"} without activity, or immediately if you delete your account.</span>
              </li>
              <li className="flex gap-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span><span className="font-semibold">Access is limited.</span> Only Run Local administrators can view verification records — for safety and moderation. Law enforcement may request records where the law requires it.</span>
              </li>
            </ul>
            <label className="mt-2 flex items-start gap-2.5 rounded-xl bg-slate-50 p-3.5">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => {
                  setConsentChecked(e.target.checked);
                  dispatch({ type: "SET_CONSENT", value: e.target.checked });
                }}
                className="mt-0.5 h-5 w-5 accent-[#0b2b22]"
              />
              <span className="text-[13px] font-semibold leading-snug text-slate-800">
                I agree to the live selfie verification described above, including storage for up to {retentionYears} year{retentionYears === 1 ? "" : "s"} and access by Run Local administrators.
              </span>
            </label>
            {error ? <Notice tone="red">{error}</Notice> : null}
            <PillButton
              variant="primary"
              className="w-full"
              disabled={!consentChecked || busy}
              onClick={() => {
                if (!canOpenCamera(flow)) return;
                dispatch({ type: "OPEN_CAMERA" });
              }}
            >
              <Icon name="shield" className="h-4 w-4" /> I agree — open my camera
            </PillButton>
            <p className="text-center text-[11px] leading-relaxed text-slate-400">
              Your camera opens only after you tap the button above. You can stop at any time.
            </p>
          </div>
        </section>
      )}

      {flow.phase === "camera" && (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <StepBadge step={4} total={4} label="Take your live selfie" />
          <CameraCapture
            onCapture={(dataUrl) => {
              void submitSelfie(dataUrl);
            }}
            onCancel={() => dispatch({ type: "CLOSE_CAMERA" })}
            confirmLabel="Submit for review"
          />
          {error ? <div className="mt-3"><Notice tone="red">{error}</Notice></div> : null}
        </section>
      )}

      {flow.phase === "submitted" && (
        <section className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/70">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-amber-700">
            <Icon name="clock" className="h-7 w-7" />
          </span>
          <h1 className="mt-3 text-xl font-extrabold text-slate-900">Verification submitted</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Your email and live selfie are in. A Run Local administrator will review them — this is a manual
            review, not an automated match. You're still in{" "}
            <span className="font-semibold">Pending Verification</span> and can browse, but can't RSVP or post yet.
          </p>
          <div className="mt-4 rounded-xl bg-slate-50 p-3.5 text-left text-xs leading-relaxed text-slate-500">
            <p className="font-semibold text-slate-700">What happens to your data</p>
            <p className="mt-1">
              Verification records are private and retained up to {retentionYears} year{retentionYears === 1 ? "" : "s"} after your last
              activity; deleting your account removes them immediately.
            </p>
          </div>
          <PillButton variant="primary" className="mt-4 w-full" onClick={() => navigate("/profile")}>
            Back to my profile
          </PillButton>
        </section>
      )}
    </div>
  );
}
