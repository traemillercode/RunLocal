/**
 * Log in — email OTP sign-in (Supabase Auth).
 *
 * Honest auth: enter the account email, Supabase emails a one-time code, enter
 * it, done. There are no passwords and no fake SSO — every failure state is
 * explicit (unknown email, rejected account, unconfigured provider, wrong or
 * expired code, rejected Supabase session). The server validates the Supabase
 * identity before issuing its HttpOnly session cookie.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CodeEntry } from "../components/CodeEntry";
import { Icon, PillButton } from "../components/ui";
import * as api from "../lib/api";
import { emptyCodeState, type CodeState } from "../lib/numericCode";
import * as supabaseOtp from "../lib/supabase";
import { useAccount } from "../state/account";

const inputCls =
  "h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0b2b22] focus:ring-2 focus:ring-[#c8f169]/60";

type Step = "email" | "code" | "signed_in";

export function LoginPage() {
  const navigate = useNavigate();
  const { me, backendAvailable, refresh } = useAccount();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState<CodeState>(emptyCodeState());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const alreadySignedIn = me?.status === "signed_in";

  // Resend countdown while on the code step.
  useEffect(() => {
    if (step !== "code" || resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [step, resendIn]);

  const startLogin = async () => {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError("Enter a valid email.");
      return;
    }
    setBusy(true);
    // Server gate first (account exists, not rejected, provider configured,
    // rate limited) — then Supabase actually emails the code.
    const gate = await api.loginStart(email.trim());
    if (gate.ok) {
      const sent = await supabaseOtp.sendOtp(email.trim());
      setBusy(false);
      if (sent.ok) {
        setCode(emptyCodeState());
        setStep("code");
        setResendIn(gate.data.resendInSec ?? 30);
        return;
      }
      if (sent.code === "unconfigured") {
        setError("Email verification isn't configured on this deployment, so no sign-in code can be sent. Nothing is faked — try again later.");
      } else if (sent.code === "rate_limited") {
        setError(sent.message);
      } else {
        setError(sent.message);
      }
      return;
    }
    setBusy(false);
    switch (gate.error.code) {
      case "no_account":
        setError("No Run Local account found for that email — you can sign up instead.");
        break;
      case "account_rejected":
        setError(gate.error.message ?? "This account was rejected and can't sign in.");
        break;
      case "email_unconfigured":
        setError("Email verification isn't configured on this server yet, so no sign-in code can be sent. Nothing is faked — try again later.");
        break;
      case "rate_limited":
        setError("Too many codes requested for this email. Try again in about an hour.");
        break;
      default:
        setError(gate.error.message ?? "Could not send the code. Try again.");
    }
  };

  const checkLogin = async (c: string) => {
    setError(null);
    setBusy(true);
    // Verify the 6-digit code with Supabase, then hand the access token to the
    // server, which validates the Supabase identity before signing us in.
    const verified = await supabaseOtp.verifyOtp(email.trim(), c);
    if (!verified.ok) {
      setBusy(false);
      setCode(emptyCodeState());
      if (verified.code === "code_expired" || verified.code === "invalid_code" || verified.code === "rate_limited") {
        setError(verified.message);
      } else if (verified.code === "unconfigured") {
        setError("Email verification isn't configured on this deployment, so the code can't be checked. No success is faked.");
      } else {
        setError(verified.message);
      }
      return;
    }
    const result = await api.loginCheck(verified.accessToken);
    setBusy(false);
    if (result.ok) {
      setStep("signed_in");
      await refresh();
      return;
    }
    setCode(emptyCodeState());
    switch (result.error.code) {
      case "auth_failed":
        setError(result.error.message ?? "The sign-in session was rejected — request a new code.");
        break;
      case "email_unconfigured":
        setError("Email verification isn't configured on this server. No success is faked.");
        break;
      case "email_mismatch":
      case "identity_mismatch":
        setError(result.error.message ?? "This sign-in session doesn't match your account.");
        break;
      default:
        setError(result.error.message ?? "Could not sign in.");
    }
  };

  const resend = async () => {
    setError(null);
    setBusy(true);
    const gate = await api.loginStart(email.trim());
    if (!gate.ok) {
      setBusy(false);
      setError(
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
      setResendIn(gate.data.resendInSec ?? 30);
    } else if (sent.code === "unconfigured") {
      setError("Email verification isn't configured on this deployment. No code was sent — nothing is faked.");
    } else {
      setError(sent.message);
    }
  };

  if (alreadySignedIn) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6">
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/70">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#c8f169] text-[#0b2b22]">
            <Icon name="check" className="h-7 w-7" />
          </span>
          <h1 className="mt-3 text-xl font-extrabold text-slate-900">You're signed in</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            {me.status === "signed_in" ? `Signed in as ${me.account.name}.` : ""} Use the account menu (top right) for
            your status, settings, and sign out.
          </p>
          <PillButton variant="primary" className="mt-4 w-full" onClick={() => navigate("/profile")}>
            Go to my profile
          </PillButton>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-3 flex items-center gap-1 text-[13px] font-semibold text-slate-500 active:text-slate-700"
      >
        <Icon name="chevronRight" className="h-4 w-4 rotate-180" /> Back
      </button>

      {!backendAvailable ? (
        <p className="mb-4 rounded-xl bg-amber-50 p-3.5 text-[13px] leading-relaxed text-amber-900">
          The Run Local server is unreachable right now — sign-in is unavailable until it's back.
        </p>
      ) : null}

      {step === "email" && (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Log in</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
            Enter the email you signed up with and we'll send you a one-time code. No password needed.
          </p>
          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Email</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
              />
            </label>
            {error ? <p className="rounded-xl bg-red-50 p-3.5 text-[13px] leading-relaxed text-red-800">{error}</p> : null}
            <PillButton variant="primary" className="w-full" disabled={busy} onClick={() => void startLogin()}>
              {busy ? "Sending…" : "Send sign-in code"}
            </PillButton>
            <p className="text-center text-xs leading-relaxed text-slate-400">
              New here?{" "}
              <button
                type="button"
                onClick={() => navigate("/verify")}
                className="font-semibold text-[#0b2b22] underline underline-offset-2"
              >
                Sign up instead
              </button>
            </p>
          </div>
        </section>
      )}

      {step === "code" && (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Enter the code</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
            We emailed a 6-digit code to <span className="font-semibold">{email}</span>. Codes expire automatically — if
            yours expires, just request a new one.
          </p>
          <div className="mt-4">
            <CodeEntry value={code} onChange={setCode} onComplete={(c) => void checkLogin(c)} disabled={busy} />
          </div>
          {error ? <p className="mt-3 rounded-xl bg-red-50 p-3.5 text-[13px] leading-relaxed text-red-800">{error}</p> : null}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {resendIn > 0 ? `Resend available in ${resendIn}s` : "Didn't get it?"}
            </span>
            <button
              type="button"
              disabled={resendIn > 0 || busy}
              onClick={() => void resend()}
              className="text-sm font-semibold text-[#0b2b22] underline underline-offset-2 disabled:text-slate-300"
            >
              Resend code
            </button>
          </div>
          <button
            type="button"
            onClick={() => setStep("email")}
            className="mt-2 text-xs font-semibold text-slate-500 underline underline-offset-2"
          >
            Use a different email
          </button>
        </section>
      )}

      {step === "signed_in" && (
        <section className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/70">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#c8f169] text-[#0b2b22]">
            <Icon name="check" className="h-7 w-7" />
          </span>
          <h1 className="mt-3 text-xl font-extrabold text-slate-900">You're signed in</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">Your session is active on this device.</p>
          <PillButton variant="primary" className="mt-4 w-full" onClick={() => navigate("/profile")}>
            Go to my profile
          </PillButton>
        </section>
      )}
    </div>
  );
}
