import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { useToast } from "../lib/toast";
import { Icon } from "../components/ui";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Manage your recurring schedules - the actual place "edit all instances"
 * lives, since a rule you created can't just be created and forgotten.
 * Editing here updates the template and regenerates every day still tied
 * to the rule that hasn't been individually overridden - a day you edited
 * by hand directly survives this untouched, exactly the Outlook
 * "this instance vs all instances" split.
 */
export function RecurrenceManagementPage() {
  const toast = useToast();
  const [recurrences, setRecurrences] = useState<api.RecurrenceView[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => void api.listRecurrences().then((r) => { if (r.ok) setRecurrences(r.data.recurrences); });
  useEffect(load, []);

  const remove = async (id: string) => {
    setBusyId(id);
    const r = await api.deleteRecurrence(id);
    setBusyId(null);
    if (r.ok) { load(); toast("Removed. Days already scheduled from it are untouched.", "success"); }
  };

  return (
    <div className="desktop-reading-narrow mx-auto max-w-lg px-4 py-6 pb-24">
      <Link to="/training-plan" className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-slate-500">
        <Icon name="chevronRight" className="h-3.5 w-3.5 rotate-180" /> Back to training plan
      </Link>
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Training plan</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Recurring schedules</h1>
      <p className="mt-1 text-sm text-slate-500">Editing here updates every day still tied to the rule — any single day you've already changed by hand stays exactly as you left it.</p>

      {recurrences === null ? (
        <p className="mt-8 text-center text-sm text-slate-400">Loading…</p>
      ) : recurrences.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-400">No recurring schedules yet — create one from the training plan calendar.</p>
      ) : (
        <div className="mt-5 space-y-2">
          {recurrences.map((r) =>
            editingId === r.id ? (
              <RecurrenceEditor key={r.id} recurrence={r} onSaved={(_updated, count) => { load(); setEditingId(null); toast(`Updated — ${count} day${count === 1 ? "" : "s"} regenerated.`, "success"); }} onCancel={() => setEditingId(null)} />
            ) : (
              <div key={r.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
                <p className="text-[14px] font-bold text-slate-900">{r.title || r.workoutType} {r.distanceValue != null ? `— ${r.distanceValue} ${r.distanceUnit}` : ""}</p>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  {r.daysOfWeek.map((d) => DAY_LABELS[d]).join("/")} · {new Date(`${r.startDate}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })} – {new Date(`${r.endDate}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => setEditingId(r.id)} className="h-9 flex-1 rounded-full bg-slate-100 text-[12px] font-bold text-slate-700">Edit all instances</button>
                  <button type="button" disabled={busyId === r.id} onClick={() => void remove(r.id)} className="h-9 flex-1 rounded-full bg-rose-50 text-[12px] font-bold text-rose-600 disabled:opacity-50">Remove rule</button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function RecurrenceEditor({ recurrence, onSaved, onCancel }: { recurrence: api.RecurrenceView; onSaved: (r: api.RecurrenceView, generatedCount: number) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(recurrence.title);
  const [distanceValue, setDistanceValue] = useState(recurrence.distanceValue?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const fieldCls = "h-10 rounded-lg border border-slate-200 px-3 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";

  const save = async () => {
    setSaving(true);
    const r = await api.updateRecurrenceAllInstances(recurrence.id, { title: title.trim(), distanceValue: distanceValue.trim() ? Number(distanceValue) : null });
    setSaving(false);
    if (r.ok) onSaved(r.data.recurrence, r.data.generatedCount);
  };

  return (
    <div className="rounded-2xl bg-white p-4 ring-2 ring-[#14171C]">
      <p className="mb-2 text-[13px] font-bold text-slate-700">Editing all instances of this rule</p>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={`w-full ${fieldCls}`} maxLength={60} />
      <input type="number" min="0" value={distanceValue} onChange={(e) => setDistanceValue(e.target.value)} placeholder="Distance" className={`mt-2.5 w-full ${fieldCls}`} />
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onCancel} className="h-10 flex-1 rounded-full bg-slate-100 text-[13px] font-bold text-slate-700">Cancel</button>
        <button type="button" disabled={saving} onClick={() => void save()} className="h-10 flex-1 rounded-full bg-[#14171C] text-[13px] font-bold text-white disabled:opacity-50">{saving ? "Saving…" : "Save all"}</button>
      </div>
    </div>
  );
}
