import { useNavigate, useSearchParams } from "react-router-dom";
import { PillButton } from "../components/ui";
import { cancelCallback } from "../lib/callbackNavigation";

/** Honest landing page for deployments whose provider redirect is an SPA path.
 * Token exchange is only performed by /api/connections/:provider/callback; a
 * plain /callback must never imply that a connection succeeded. */
export function ProviderCallbackPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const denied = params.get("error") === "access_denied";
  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-8">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Strava connection</p>
        <h1 className="mt-2 text-xl font-extrabold">{denied ? "Connection cancelled" : "Connection not completed"}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {denied
            ? "Strava did not authorize Kimbio. No activity access was granted."
            : "This callback reached Kimbio, but this deployment cannot complete the Strava connection from this URL. No token was saved."}
        </p>
        <PillButton variant="primary" className="mt-5 w-full" onClick={() => navigate("/settings", { replace: true })}>Return to settings</PillButton>
        <button type="button" onClick={() => cancelCallback(navigate, "/")} className="mt-3 block w-full text-center text-sm font-semibold text-slate-600 underline">Cancel</button>
      </section>
    </div>
  );
}
