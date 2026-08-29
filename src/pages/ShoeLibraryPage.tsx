import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { useToast } from "../lib/toast";
import { Icon } from "../components/ui";

/**
 * Your shoe library - real cumulative mileage per shoe (Strava-style),
 * and a genuine way to change which one is the default at any time. The
 * first shoe you add auto-becomes the default so there's always one, but
 * nothing here is permanent - "set as default" works on any shoe, whenever.
 */
export function ShoeLibraryPage() {
  const toast = useToast();
  const [shoes, setShoes] = useState<api.ShoeView[] | null>(null);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => void api.listShoes().then((r) => { if (r.ok) setShoes(r.data.shoes); });
  useEffect(load, []);

  const add = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    const r = await api.addShoe(newName.trim());
    setAdding(false);
    if (r.ok) { setNewName(""); load(); toast(`Added ${r.data.shoe.name}.`, "success"); }
  };

  const makeDefault = async (shoe: api.ShoeView) => {
    setBusyId(shoe.id);
    const r = await api.setDefaultShoe(shoe.id);
    setBusyId(null);
    if (r.ok) { load(); toast(`${shoe.name} is now your default.`, "success"); }
  };

  const remove = async (shoe: api.ShoeView) => {
    setBusyId(shoe.id);
    const r = await api.deleteShoe(shoe.id);
    setBusyId(null);
    if (r.ok) load();
  };

  return (
    <div className="desktop-reading-narrow mx-auto max-w-lg px-4 py-6 pb-24">
      <Link to="/training-plan" className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-slate-500">
        <Icon name="chevronRight" className="h-3.5 w-3.5 rotate-180" /> Back to training plan
      </Link>
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Shoe library</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Your shoes</h1>
      <p className="mt-1 text-sm text-slate-500">Mileage adds up automatically as you log runs done with each pair — the same way Strava tracks gear.</p>

      <div className="mt-4 flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Nike Pegasus 40" className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3.5 text-[15px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" maxLength={60} />
        <button type="button" disabled={adding} onClick={() => void add()} className="h-11 shrink-0 rounded-full bg-[#14171C] px-4 text-sm font-bold text-white disabled:opacity-50">
          {adding ? "Adding…" : "Add"}
        </button>
      </div>

      {shoes === null ? (
        <p className="mt-6 text-center text-sm text-slate-400">Loading…</p>
      ) : shoes.length === 0 ? (
        <p className="mt-6 text-center text-sm text-slate-400">No shoes yet — add your first one above.</p>
      ) : (
        <div className="mt-5 space-y-2">
          {shoes.map((s) => (
            <div key={s.id} className={`flex items-center justify-between rounded-2xl p-4 ring-1 ${s.isDefault ? "bg-[#FF5741]/5 ring-[#FF5741]/30" : "bg-white ring-slate-200/70"}`}>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900">
                  {s.name}
                  {s.isDefault ? <span className="rounded-full bg-[#FF5741] px-2 py-0.5 text-[11px] font-extrabold text-[#14171C]">DEFAULT</span> : null}
                </p>
                <p className="text-[13px] text-slate-500">{s.totalMiles.toFixed(1)} miles logged</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!s.isDefault ? (
                  <button type="button" disabled={busyId === s.id} onClick={() => void makeDefault(s)} className="rounded-full bg-slate-100 px-3 py-1.5 text-[12px] font-bold text-slate-700 disabled:opacity-50">
                    Set as default
                  </button>
                ) : null}
                <button type="button" disabled={busyId === s.id} onClick={() => void remove(s)} className="rounded-full p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${s.name}`}>
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
