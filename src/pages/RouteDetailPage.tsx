/**
 * Route detail — a real interactive map (Leaflet + OpenStreetMap tiles, no
 * API key needed) and a real elevation profile, both built from the actual
 * uploaded GPX file, not illustrative placeholder data.
 *
 * The GPX is fetched and parsed client-side (reusing the exact same parser
 * the server uses to compute distance/elevation at upload time — see
 * src/server/gpx.ts, which is plain TS with no server-only dependencies, so
 * it's safe to import here too) rather than having the server ship a
 * separate points endpoint.
 */
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import * as api from "../lib/api";
import { parseGpx, type GpxPoint } from "../server/gpx";
import { Icon, Chip } from "../components/ui";

const SURFACE_LABELS: Record<string, string> = { trail: "Trail", gravel: "Gravel", road: "Road", track: "Track" };

function ElevationChart({ points }: { points: GpxPoint[] }) {
  const elevations = points.map((p) => p.ele).filter((e): e is number => e !== null);
  if (elevations.length < 2) return null;
  const w = 800;
  const h = 140;
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const range = Math.max(1, max - min);
  const step = w / (elevations.length - 1);
  const coords = elevations.map((ele, i) => `${i * step},${h - ((ele - min) / range) * (h - 12) - 6}`);
  const path = `M0,${h} L${coords.join(" L")} L${w},${h} Z`;
  const line = `M${coords.join(" L")}`;
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
      <p className="mb-2 text-[13px] font-bold text-slate-700">Elevation profile</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 140 }}>
        <path d={path} fill="#FF5741" fillOpacity="0.12" />
        <path d={line} fill="none" stroke="#FF5741" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-slate-400">
        <span>{Math.round(min * 3.28084)} ft</span>
        <span>{Math.round(max * 3.28084)} ft</span>
      </div>
    </div>
  );
}

export function RouteDetailPage() {
  const { routeId } = useParams<{ routeId: string }>();
  const [route, setRoute] = useState<api.RouteView | null | undefined>(undefined);
  const [points, setPoints] = useState<GpxPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!routeId) return;
    let live = true;
    // Routes aren't fetched by id server-side (only by city list) — find it
    // client-side from whichever city list contains it. Every route belongs
    // to exactly one city, and the list endpoint is cheap/cacheable, so this
    // avoids adding a second server endpoint for a single-record lookup.
    void (async () => {
      const cities = ["columbia-mo"]; // single-city launch; extend when more cities exist
      for (const cityId of cities) {
        const r = await api.getRoutes(cityId);
        if (r.ok) {
          const match = r.data.routes.find((x) => x.id === routeId);
          if (match && live) { setRoute(match); return; }
        }
      }
      if (live) setRoute(null);
    })();
    return () => { live = false; };
  }, [routeId]);

  useEffect(() => {
    if (!route) return;
    let live = true;
    void fetch(route.gpxUrl)
      .then((r) => r.text())
      .then((xml) => {
        if (!live) return;
        const parsed = parseGpx(xml);
        if ("error" in parsed) setError("Couldn't read the route's map data.");
        else setPoints(parsed.points);
      })
      .catch(() => { if (live) setError("Couldn't load the route's map data."); });
    return () => { live = false; };
  }, [route]);

  if (route === undefined) return <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-slate-500">Loading…</div>;
  if (route === null) return <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-slate-500">Route not found.</div>;

  const latLngs: [number, number][] = (points ?? []).map((p) => [p.lat, p.lon]);
  const bounds: [[number, number], [number, number]] | null = latLngs.length > 0
    ? [
        [Math.min(...latLngs.map((p) => p[0])), Math.min(...latLngs.map((p) => p[1]))],
        [Math.max(...latLngs.map((p) => p[0])), Math.max(...latLngs.map((p) => p[1]))],
      ]
    : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link to="/routes" className="text-[13px] font-bold text-slate-500 hover:underline underline-offset-2">← All routes</Link>
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">{route.name}</h1>
      <div className="mt-2 flex items-center gap-2">
        <Chip tone="outline">{SURFACE_LABELS[route.surfaceType]}</Chip>
        <span className="text-[13px] text-slate-500"><strong className="text-slate-800">{route.distanceMiles}</strong> mi</span>
        <span className="text-[13px] text-slate-500">
          {route.hasElevationData ? <><strong className="text-slate-800">{route.elevationGainFt}</strong> ft gain</> : "No elevation data"}
        </span>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl shadow-sm ring-1 ring-slate-200/70" style={{ height: 380 }}>
        {bounds ? (
          <MapContainer bounds={bounds} boundsOptions={{ padding: [24, 24] }} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Polyline positions={latLngs} pathOptions={{ color: "#FF5741", weight: 4 }} />
          </MapContainer>
        ) : (
          <div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-400">
            {error ?? "Loading map…"}
          </div>
        )}
      </div>

      {points ? (
        <div className="mt-4">
          <ElevationChart points={points} />
        </div>
      ) : null}

      <a
        href={route.gpxUrl}
        download
        className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#14171C] text-sm font-bold text-white active:opacity-90"
      >
        <Icon name="download" className="h-4 w-4" /> Download GPX
      </a>
    </div>
  );
}
