import { useNavigate, useSearchParams } from "react-router-dom";
import { PillButton } from "../components/ui";
export function ConfirmationPage() {
  const navigate = useNavigate(); const [params] = useSearchParams(); const error = params.get("error");
  return <div className="mx-auto w-full max-w-md px-4 pb-32 pt-8"><section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70"><h1 className="text-xl font-extrabold">{error ? "Confirmation link unavailable" : "Email confirmed"}</h1><p className="mt-2 text-sm text-slate-600">{error || "Your email is confirmed. Log in to continue."}</p><PillButton variant="primary" className="mt-5 w-full" onClick={() => navigate("/login")}>{error ? "Request a new confirmation email" : "Log in"}</PillButton></section></div>;
}
