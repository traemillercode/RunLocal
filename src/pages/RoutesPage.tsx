import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { Chip, Icon } from "../components/ui";
import { useSelectedCity } from "../state/city";
import { useAccount } from "../state/account";
import { useToast } from "../lib/toast";

const SURFACE_LABELS: Record<string, string> = { trail: "Trail", gravel: "Gravel", road: "Road", track: "Track" };
const SURFACE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "trail", label: "Trail" },
  { id: "gravel", label: "Gravel" },
  { id: "road", label: "Road" },
  { id: "track", label: "Track" },
];

/** A small, dependency-free shape thumbnail from the route's own real GPS points — not a real map, just the trace's shape, scaled to fit a box. Real visual feedback without needing a map tile fetch per card. */
function RouteShapePreview({ points }: { points: [number, number][] }) {
  if (points.length < 2) {
    return <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-300"><Icon name="mapPin" className="h-5 w-5" /></div>;
  }
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const spanLat = Math.max(0.0001, maxLat - minLat);
  const spanLon = Math.max(0.0001, maxLon - minLon);
  const pad = 6;
  const size = 64;
  const coords = points.map(([lat, lon]) => {
    const x = pad + ((lon - minLon) / spanLon) * (size - pad * 2);
    const y = pad + (1 - (lat - minLat) / spanLat) * (size - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-slate-50">
      <svg viewBox={`0 0 ${size} ${size}`} width={56} height={56}>
        <polyline points={coords.join(" ")} fill="none" stroke="#FF5741" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function UploadRouteForm({ onUploaded }: { onUploaded: (route: api.RouteView) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [surfaceType, setSurfaceType] = useState("trail");
  const [fileName, setFileName] = useState<string | null>(null);
  const [gpxXml, setGpxXml] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".gpx")) { setError("That doesn't look like a .gpx file."); return; }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") { setGpxXml(reader.result); setFileName(file.name); } };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsText(file);
  };

  const submit = () => {
    if (!name.trim()) { setError("Give the route a name."); return; }
    if (!gpxXml) { setError("Attach a .gpx file — that's what the distance and elevation get computed from."); return; }
    setSubmitting(true);
    setError(null);
    void api.uploadRoute({ name: name.trim(), surfaceType, gpx: gpxXml }).then((r) => {
      setSubmitting(false);
      if (r.ok) {
        toast("Route added.", "success");
        onUploaded(r.data.route);
        setOpen(false);
        setName(""); setGpxXml(null); setFileName(null);
      } else {
        setError(r.error.message ?? "Couldn't upload that route.");
      }
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#14171C] text-sm font-bold text-white active:opacity-90">
        <Icon name="plus" className="h-4 w-4" /> Upload a route
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-bold text-slate-900">Upload a route</p>
        <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1 hover:bg-slate-100"><Icon name="close" className="h-4 w-4" /></button>
      </div>
      <p className="mt-1 text-[12px] text-slate-500">Export a .gpx from your watch, Strava, or Garmin — distance and elevation are computed from the real file, not typed in.</p>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 p-2.5 text-xs font-medium text-red-800">{error}</p> : null}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Route name, e.g. MKT Nature Trail"
        maxLength={80}
        className="mt-3 h-11 w-full rounded-xl border border-slate-200 px-3.5 text-[15px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
      />
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {SURFACE_OPTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSurfaceType(s.id)}
            className={`min-h-10 rounded-xl text-[12px] font-bold ${surfaceType === s.id ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <input ref={fileInputRef} type="file" accept=".gpx" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
      <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 text-[13px] font-semibold text-slate-500">
        <Icon name="download" className="h-4 w-4 rotate-180" /> {fileName ?? "Choose .gpx file"}
      </button>
      <button type="button" disabled={submitting} onClick={submit} className="mt-3 h-11 w-full rounded-full bg-[#FF5741] text-sm font-bold text-white disabled:opacity-50">
        {submitting ? "Uploading…" : "Upload route"}
      </button>
    </div>
  );
}

export function RoutesPage() {
  const { cityId } = useSelectedCity();
  const { me } = useAccount();
  const [routes, setRoutes] = useState<api.RouteView[] | null>(null);
  const [surfaceFilter, setSurfaceFilter] = useState<string | null>(null);

  useEffect(() => {
    void api.getRoutes(cityId).then((r) => { if (r.ok) setRoutes(r.data.routes); });
  }, [cityId]);

  const filtered = routes?.filter((r) => !surfaceFilter || r.surfaceType === surfaceFilter) ?? null;
  const counts = routes ? SURFACE_OPTIONS.reduce<Record<string, number>>((acc, s) => { acc[s.id] = routes.filter((r) => r.surfaceType === s.id).length; return acc; }, {}) : {};

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Routes</h1>
      <p className="mt-1 text-[13px] text-slate-500">Real GPX-backed routes — distance and elevation computed from the actual file, not a guess.</p>

      {routes && routes.length > 0 ? (
        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSurfaceFilter(null)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-[13px] font-bold ${!surfaceFilter ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}
          >
            All ({routes.length})
          </button>
          {SURFACE_OPTIONS.filter((s) => counts[s.id] > 0).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSurfaceFilter(surfaceFilter === s.id ? null : s.id)}
              className={`shrink-0 rounded-full px-3.5 py-2 text-[13px] font-bold ${surfaceFilter === s.id ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {s.label} ({counts[s.id]})
            </button>
          ))}
        </div>
      ) : null}

      {routes === null ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : routes.length === 0 ? (
        <div className="mt-6 rounded-2xl bg-slate-50 p-6 text-center">
          <p className="text-sm font-semibold text-slate-600">No routes uploaded yet.</p>
        </div>
      ) : filtered && filtered.length === 0 ? (
        <div className="mt-6 rounded-2xl bg-slate-50 p-6 text-center">
          <p className="text-sm font-semibold text-slate-600">No {surfaceFilter ? SURFACE_LABELS[surfaceFilter].toLowerCase() : ""} routes yet.</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {filtered!.map((route) => (
            <Link
              key={route.id}
              to={`/routes/${route.id}`}
              className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 active:bg-slate-50"
            >
              <RouteShapePreview points={route.previewPoints ?? []} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-slate-900">{route.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Chip tone="outline">{SURFACE_LABELS[route.surfaceType]}</Chip>
                </div>
                <p className="mt-1 text-[13px] text-slate-500">
                  {route.distanceMiles} mi · {route.hasElevationData ? `${route.elevationGainFt} ft gain` : "No elevation data"}
                </p>
              </div>
              <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-slate-300" />
            </Link>
          ))}
        </div>
      )}
      {me?.status === "signed_in" && me.account.status === "verified" ? (
        <UploadRouteForm onUploaded={(route) => setRoutes((prev) => [...(prev ?? []), route])} />
      ) : null}
    </div>
  );
}
