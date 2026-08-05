/**
 * Verification flow — selfie step of the identity check.
 *
 * Primary signup/login is Supabase email + password with a confirmation link
 * (see LoginPage). Email ownership is proven there, so this page no longer
 * collects profile data or email codes — it starts at the consent step for
 * pending accounts that have logged in, and prompts sign-in for everyone
 * else. The funnel here is: consent → camera → submitted (manual review).
 *
 * Honesty rules baked in:
 *  - The camera opens ONLY after explicit consent (state machine enforced).
 *  - Selfie capture is getUserMedia-only; no gallery/file input.
 *  - No fake success: unconfigured/error/pending states are explicit.
 *  - Pending accounts stay read-only until the owner manually approves.
 */
import { useEffect, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CameraCapture } from "../components/CameraCapture";
import { Icon, PillButton } from "../components/ui";
import * as api from "../lib/api";
import { canOpenCamera, initialState, verifyReducer } from "../lib/verificationFlow";
import { useAccount } from "../state/account";

// ---------------------------------------------------------------- UI bits
function StepBadge({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="grid h-7 w-7 place-items-center rounded-[10px] bg-[#14171C] text-[12px] font-bold text-[#FF5741]">{step}</span>
      <span className="text-[13px] font-semibold text-slate-700">{label}</span>
      <span className="ml-auto text-[11px] font-medium text-slate-400">
        Step {step} of {total}
      </span>
    </div>
  );
}

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
  const { me, refresh, signOut } = useAccount();
  const [flow, dispatch] = useReducer(verifyReducer, initialState());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-[10px] bg-[#FF5741] text-[#14171C]">
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

  // Not signed in — identity verification needs an account first.
  if (me?.status !== "signed_in") {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-6">
        <section className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/70">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-[10px] bg-[#14171C] text-[#FF5741]">
            <Icon name="shield" className="h-7 w-7" />
          </span>
          <h1 className="mt-3 text-xl font-extrabold text-slate-900">Log in to verify</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Create an account with your email and password, confirm your email, then come back here to finish the
            live selfie check.
          </p>
          <PillButton variant="primary" className="mt-4 w-full" onClick={() => navigate("/login?mode=signup")}>
            Create an account
          </PillButton>
        </section>
      </div>
    );
  }

  const back = () => {
    setError(null);
    if (flow.phase === "camera") {
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

      {flow.phase === "login" && (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <StepBadge step={1} total={2} label="Verify your email" />
          <p className="mb-4 text-[13px] leading-relaxed text-slate-600">
            Log in with your password to prove you own this email — then continue with the selfie check. If you never
            set a password, use <span className="font-semibold">Forgot password?</span> on the log in page to create one.
          </p>
          <PillButton
            variant="primary"
            className="w-full"
            onClick={async () => {
              await signOut();
              navigate("/login");
            }}
          >
            Log in to continue
          </PillButton>
        </section>
      )}

      {flow.phase === "consent" && (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          <StepBadge step={1} total={2} label="Selfie verification — your consent matters" />
          <div className="space-y-3 text-[13px] leading-relaxed text-slate-700">
            <p className="font-semibold text-slate-900">Before your camera opens, please read this:</p>
            <ul className="space-y-2.5">
              <li className="flex gap-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span><span className="font-semibold">Live capture only.</span> You'll take one live photo with your camera. Gallery uploads are not accepted.</span>
              </li>
              <li className="flex gap-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span><span className="font-semibold">Compared to your profile photo.</span> A Run Local staff member reviews that the live photo matches the profile photo on your account.</span>
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
                className="mt-0.5 h-5 w-5 accent-[#14171C]"
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
          <StepBadge step={2} total={2} label="Take your live selfie" />
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
            Your selfie is in. A Run Local administrator will review it — this is a manual review, not an automated
            match. You're still in <span className="font-semibold">Pending Verification</span> and can browse, but
            can't RSVP or post yet.
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
