import { useEffect, useMemo, useState } from "react";
import { Chip, Icon, PillButton, Sheet } from "../components/ui";
import { ActionMenu } from "../components/ActionMenu";
import { ModerationConfirmSheet } from "../components/ModerationConfirmSheet";
import { HomeCityBanner } from "../components/HomeCityBanner";
import { ProfileCompletionBanner } from "../components/ProfileCompletionBanner";
import { RaceSubmissionSheet } from "../components/SubmissionSheets";
import { VerifiedGateSheet } from "../components/VerifiedGateSheet";
import { formatRaceDate } from "../lib/dates";
import { isPastCalendarDate } from "../lib/activityDates";
import { actionMenuItems, type ActionKey } from "../lib/actionModel";
import { useModerated } from "../state/moderated";
import { usePublicContent } from "../state/content";
import { useAccount } from "../state/account";
import { useToast } from "../lib/toast";
import * as api from "../lib/api";
import type { City, Race } from "../types";
import { RailCard, RailStack } from "../components/RailCard";

function RaceCard({ race, featured = false, pinned = false, capabilities = [], onAction }: { race: Race; featured?: boolean; pinned?: boolean; capabilities?: string[]; onAction?: (key: ActionKey) => void }) {
  const actionItems = actionMenuItems(capabilities);
  return (
    <article className="desktop-race-card overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold leading-snug text-slate-900">{race.name}</h3>
          <p className="mt-0.5 text-[13px] font-medium text-slate-500">{race.distance}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {actionItems.length > 0 && onAction ? <ActionMenu entityTitle={`${race.name} race listing`} items={actionItems} onSelect={onAction} /> : null}
          {featured ? (
            <Chip tone="volt">
              <Icon name="spark" className="h-3 w-3" /> Featured
            </Chip>
          ) : null}
          {pinned ? (
            <Chip tone="amber">
              <Icon name="pin" className="h-3 w-3" /> Pinned
            </Chip>
          ) : null}
          {race.registrationOpen ? <Chip tone="emerald">Registration open</Chip> : <Chip tone="amber">{race.registrationNote ?? "Registration TBA"}</Chip>}
        </div>
      </div>
      <div className="space-y-1.5 px-4 pb-4 text-[13px] text-slate-600">
        <p className="flex items-center gap-2">
          <Icon name="calendar" className="h-4 w-4 shrink-0 text-slate-400" />
          {formatRaceDate(race.date)}
        </p>
        <p className="flex items-center gap-2">
          <Icon name="mapPin" className="h-4 w-4 shrink-0 text-slate-400" />
          {race.location}
        </p>
        <p className="flex items-center gap-2">
          <Icon name="flag" className="h-4 w-4 shrink-0 text-slate-400" />
          {race.organizer} · {race.price}
        </p>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-slate-100 px-4 py-2.5 lg:flex-row lg:items-center lg:justify-between">
        <a
          href={race.registrationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[#14171C] text-sm font-semibold text-white active:bg-[#252a31] lg:w-auto lg:px-4"
        >
          {race.registrationOpen ? "Register" : "View details"}
          <Icon name="external" className="h-4 w-4 text-[#FF5741]" />
        </a>
        <p className="text-center text-[11px] text-slate-400 lg:text-right">{race.registrationNote ?? "Opens on the organizer's site"}</p>
      </div>
    </article>
  );
}

export function RacesPage({ city }: { city: City }) {
  const toast = useToast();
  const { hidden, highlights } = useModerated();
  const { races: userRaces } = usePublicContent();
  const { role, me } = useAccount();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  // Server-computed capabilities per race listing (edit/delete for scoped
  // admins); the client renders exactly what the server grants.
  const [raceCaps, setRaceCaps] = useState<Map<string, string[]>>(new Map());
  // Local overlays: admin edits merged over the base listing, and deleted ids
  // removed immediately (the server soft-deletes the registry row).
  const [raceEdits, setRaceEdits] = useState<Map<string, Race>>(new Map());
  const [localDeleted, setLocalDeleted] = useState<Set<string>>(new Set());
  const [editTarget, setEditTarget] = useState<{ id: string; name: string; distances: string; date: string; location: string; registrationUrl: string; description: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void api.getRaces(city.id).then((r) => {
      if (alive && r.ok) setRaceCaps(new Map(r.data.races.map((x) => [x.id, x.capabilities ?? []])));
    });
    return () => { alive = false; };
  }, [city.id]);
  const openRaceAction = (race: Race, key: ActionKey) => {
    if (key === "edit") {
      setEditTarget({ id: race.id, name: race.name, distances: race.distance, date: race.date, location: race.location, registrationUrl: race.registrationUrl, description: (race as Race & { description?: string }).description ?? "" });
      setEditError(null);
      return;
    }
    if (key === "delete") {
      setDeleteTarget({ id: race.id, name: race.name });
      setDeleteError(null);
    }
  };
  const saveEdit = () => {
    if (!editTarget || editBusy) return;
    const t = editTarget;
    setEditBusy(true);
    setEditError(null);
    void api.updateRace(t.id, { name: t.name.trim(), distances: t.distances.trim(), date: t.date, location: t.location.trim(), registrationUrl: t.registrationUrl.trim(), description: t.description.trim() }).then((r) => {
      setEditBusy(false);
      if (r.ok) {
        setEditTarget(null);
        const updated: Race = { id: r.data.race.id, name: r.data.race.name, date: r.data.race.date, distance: r.data.race.distance, location: r.data.race.location, organizer: r.data.race.organizer, price: r.data.race.price, registrationUrl: r.data.race.registrationUrl, registrationOpen: r.data.race.registrationOpen, registrationNote: r.data.race.registrationNote };
        setRaceEdits((cur) => { const n = new Map(cur); n.set(r.data.race.id, updated); return n; });
        toast("Race listing updated.", "success");
      } else {
        setEditError(r.error.message ?? "Couldn't save — try again.");
      }
    });
  };
  const runDelete = (reason: string) => {
    if (!deleteTarget || deleteBusy) return;
    const t = deleteTarget;
    setDeleteBusy(true);
    setDeleteError(null);
    void api.adminTransitionContent(`race:${t.id}`, "delete", reason).then((r) => {
      setDeleteBusy(false);
      if (r.ok) {
        setDeleteTarget(null);
        setLocalDeleted((s) => { const n = new Set(s); n.add(t.id); return n; });
        toast("Race listing removed.", "success");
      } else {
        setDeleteError(r.error.message ?? "Couldn't remove — try again.");
      }
    });
  };

  const races = useMemo(() => {
    // Approved community submissions are mapped onto the public Race shape so
    // they render in the same cards; only approved records ever arrive here.
    const userAsRaces: Race[] = userRaces.map((r) => ({
      id: r.id,
      name: r.name,
      date: r.date,
      distance: r.distance,
      location: r.location,
      organizer: r.organizer,
      price: r.price,
      registrationUrl: r.registrationUrl,
      registrationOpen: r.registrationOpen,
      registrationNote: r.registrationNote,
    }));
    const base = [...city.races, ...userAsRaces].map((r) => raceEdits.get(r.id) ?? r);
    return base
      // Owner-hidden races are excluded from public rendering.
      .filter((r) => !hidden.has(`race:${r.id}`) && !localDeleted.has(r.id) && !isPastCalendarDate(r.date))
      // Featured first, then pinned — server-driven ordering facts.
      .sort((a, b) => {
        const ha = highlights.get(`race:${a.id}`);
        const hb = highlights.get(`race:${b.id}`);
        const ra = Number(!!ha?.featured) * 2 + Number(!!ha?.pinned);
        const rb = Number(!!hb?.featured) * 2 + Number(!!hb?.pinned);
        return rb - ra;
      });
  }, [city.races, userRaces, hidden, highlights, raceEdits, localDeleted]);

  return (
    <>
    <div className="desktop-races-layout desktop-browse-layout mx-auto w-full px-4 pb-32 pt-4">
      <div className="min-w-0">
      <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-end min-[420px]:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Races</h1>
          <p className="mt-0.5 text-sm font-medium text-slate-500">
            Upcoming races in {city.name}, {city.state} — registration on the organizer's site.
          </p>
        </div>
        <PillButton
          variant="secondary"
          className="min-h-11 w-full justify-center px-4 min-[420px]:w-auto"
          onClick={() => {
            if (role === "verified") setSheetOpen(true);
            else setGateOpen(true);
          }}
        >
          <Icon name="plus" className="h-4 w-4" /> Submit a race
        </PillButton>
      </div>
      <HomeCityBanner />
      <ProfileCompletionBanner />

      <ul className="mt-4 space-y-3">
        {races.map((r) => {
          const hl = highlights.get(`race:${r.id}`);
          return (
            <li key={r.id}>
              <RaceCard race={r} featured={hl?.featured} pinned={hl?.pinned} capabilities={raceCaps.get(r.id) ?? []} onAction={(key) => openRaceAction(r, key)} />
            </li>
          );
        })}
      </ul>

      {userRaces.length > 0 ? (
        <p className="mt-3 text-center text-[11px] text-slate-400">
          Includes approved community-submitted races — always confirm details on the organizer's site.
        </p>
      ) : null}
      <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
        Sample seed listings plus approved community submissions — always confirm details on the organizer's site.
      </p>
      </div>
      <RailStack ariaLabel="Race listings guidance">
        <RailCard kicker="Race listings" title={`Upcoming in ${city.name}`}>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{races.length} approved listing{races.length === 1 ? "" : "s"} visible here. Check each organizer's site for current details.</p>
        </RailCard>
        <RailCard kicker="Registration">
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">Registration and event details are handled by each race organizer. Use the link on a listing to confirm availability and requirements.</p>
        </RailCard>
        <RailCard kicker="Community submissions">
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">Verified runners can submit a race for review using the Submit a race button above.</p>
        </RailCard>
      </RailStack>
    </div>

    <RaceSubmissionSheet open={sheetOpen} onClose={() => setSheetOpen(false)} cityId={city.id} />
    <VerifiedGateSheet open={gateOpen} onClose={() => setGateOpen(false)} role={role} actionLabel="Submitting races" pendingLabel="Your profile is still in review." rejectionReason={me?.status === "signed_in" ? me.account.rejectionReason ?? null : null} />

    <Sheet open={editTarget !== null} onClose={() => { if (!editBusy) { setEditTarget(null); setEditError(null); } }} title="Edit race listing" subtitle="Changes are reviewed against the same rules as new listings.">
      {editTarget ? (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Race name</span>
            <input type="text" value={editTarget.name} maxLength={120} onChange={(e) => setEditTarget({ ...editTarget, name: e.target.value })} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Distances</span>
              <input type="text" value={editTarget.distances} maxLength={80} onChange={(e) => setEditTarget({ ...editTarget, distances: e.target.value })} placeholder="5K / 10K" className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Date</span>
              <input type="date" value={editTarget.date} onChange={(e) => setEditTarget({ ...editTarget, date: e.target.value })} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[16px] text-slate-900 outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Location</span>
            <input type="text" value={editTarget.location} maxLength={160} onChange={(e) => setEditTarget({ ...editTarget, location: e.target.value })} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Registration link</span>
            <input type="url" value={editTarget.registrationUrl} onChange={(e) => setEditTarget({ ...editTarget, registrationUrl: e.target.value })} placeholder="https://…" className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Description <span className="font-normal text-slate-400">(optional)</span></span>
            <textarea value={editTarget.description} rows={3} maxLength={1000} onChange={(e) => setEditTarget({ ...editTarget, description: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
          </label>
          {editError ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-[13px] font-semibold text-rose-800">{editError}</p> : null}
          <div className="flex gap-3">
            <PillButton variant="ghost" className="flex-1" onClick={() => { if (!editBusy) { setEditTarget(null); setEditError(null); } }} disabled={editBusy}>Cancel</PillButton>
            <PillButton variant="primary" className="flex-1" disabled={editBusy || !editTarget.name.trim() || !editTarget.distances.trim() || !editTarget.date || !editTarget.location.trim()} onClick={saveEdit}>
              {editBusy ? "Saving…" : "Save changes"}
            </PillButton>
          </div>
        </div>
      ) : null}
    </Sheet>

    <ModerationConfirmSheet
      open={deleteTarget !== null}
      onClose={() => { if (!deleteBusy) { setDeleteTarget(null); setDeleteError(null); } }}
      title="Delete this race listing?"
      entity={deleteTarget?.name ?? ""}
      impact="This can't be undone. The listing will be removed from the city's Races page; the record and audit trail are preserved."
      confirmLabel="Delete listing"
      requireReason
      busy={deleteBusy}
      error={deleteError}
      onConfirm={runDelete}
    />
    </>
  );
}
