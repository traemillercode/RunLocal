import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PillButton } from "../components/ui";
import * as supabase from "../lib/supabase";
import { passwordRequirements } from "./LoginPage";
import { cancelCallback } from "../lib/callbackNavigation";
const inputCls="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-[16px] text-slate-900 outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";
export function recoveryPasswordError(password: string, confirmation: string): string | null {
  if (!passwordRequirements(password).every(Boolean)) return "Password must be at least 6 characters and include a lowercase letter, uppercase letter, and digit.";
  if (password !== confirmation) return "Passwords do not match.";
  return null;
}
export function RecoveryPage({ sessionError }: { sessionError?: string }) {
  const navigate=useNavigate(); const [password,setPassword]=useState(""); const [confirm,setConfirm]=useState(""); const [error,setError]=useState<string|null>(sessionError??null); const [done,setDone]=useState(false); const [busy,setBusy]=useState(false);
  const submit=async()=>{setError(null);const validationError=recoveryPasswordError(password,confirm);if(validationError){setError(validationError);return}setBusy(true);const r=await supabase.updatePassword(password);setBusy(false);if(!r.ok){setError(r.message);return}setDone(true)};
  return <div className="mx-auto w-full max-w-md px-4 pb-32 pt-8"><section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70"><h1 className="text-xl font-extrabold">Update your password</h1>{done?<><p className="mt-2 text-sm text-slate-600">Your password has been updated. You can now log in with your new password.</p><PillButton variant="primary" className="mt-5 w-full" onClick={()=>navigate("/login")}>Log in</PillButton></>:<><p className="mt-1 text-[13px] text-slate-600">Choose a new password for your Run Local account.</p><div className="mt-4 space-y-4"><label className="block"><span className="mb-1.5 block text-sm font-semibold">New password</span><input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} className={inputCls}/></label><label className="block"><span className="mb-1.5 block text-sm font-semibold">Confirm new password</span><input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} className={inputCls}/></label>{error&&<p className="rounded-xl bg-red-50 p-3.5 text-[13px] text-red-800">{error}</p>}<PillButton variant="primary" className="w-full" disabled={busy||Boolean(sessionError)} onClick={()=>void submit()}>{busy?"Updating…":"Update password"}</PillButton>{sessionError&&<button type="button" className="block w-full text-center text-sm font-semibold text-[#14171C] underline" onClick={()=>navigate("/login")}>Request a new reset email</button>}<button type="button" className="block w-full text-center text-sm font-semibold text-slate-600 underline" onClick={()=>cancelCallback(navigate, "/")}>Cancel</button></div></>}</section></div>;
}
