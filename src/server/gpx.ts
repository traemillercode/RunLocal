/**
 * Minimal, dependency-free GPX parser.
 *
 * GPX is just XML — a sequence of <trkpt lat="" lon=""><ele>meters</ele></trkpt>
 * elements. Rather than pull in a full XML parsing dependency for this one
 * use case, this extracts what's actually needed with targeted regexes: it's
 * intentionally narrow (won't handle every GPX extension in the wild) but it
 * gets real lat/lon/elevation out of real files from Garmin, Strava exports,
 * Apple Health, etc. — the formats people actually upload.
 *
 * Distance is computed via the haversine formula between consecutive points
 * (real geographic distance, not a straight-line guess). Elevation gain sums
 * only the positive deltas between consecutive points — small negative
 * noise in GPS elevation data doesn't get double-counted as "gain."
 */

export interface GpxPoint {
  lat: number;
  lon: number;
  /** Meters — null if the file has no elevation data for this point. */
  ele: number | null;
}

export interface GpxParseResult {
  points: GpxPoint[];
  distanceMiles: number;
  elevationGainFt: number;
}

const EARTH_RADIUS_MILES = 3958.8;

function haversineMiles(a: GpxPoint, b: GpxPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function parseGpx(xml: string): GpxParseResult | { error: string } {
  const trkptRe = /<trkpt\b[^>]*\blat="(-?\d+\.?\d*)"[^>]*\blon="(-?\d+\.?\d*)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  const eleRe = /<ele>(-?\d+\.?\d*)<\/ele>/;
  const points: GpxPoint[] = [];
  let match: RegExpExecArray | null;
  while ((match = trkptRe.exec(xml)) !== null) {
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const eleMatch = eleRe.exec(match[3]);
    const ele = eleMatch ? Number(eleMatch[1]) : null;
    points.push({ lat, lon, ele: ele !== null && Number.isFinite(ele) ? ele : null });
  }
  if (points.length < 2) return { error: "no_track_points" };

  let distanceMiles = 0;
  let elevationGainMeters = 0;
  for (let i = 1; i < points.length; i++) {
    distanceMiles += haversineMiles(points[i - 1], points[i]);
    const prevEle = points[i - 1].ele;
    const curEle = points[i].ele;
    if (prevEle !== null && curEle !== null && curEle > prevEle) elevationGainMeters += curEle - prevEle;
  }

  // A real GPX track easily has thousands of points; keep the file useful
  // for later map rendering without bloating storage — sample down to a
  // reasonable resolution while preserving start/end exactly.
  const MAX_STORED_POINTS = 500;
  const sampled = points.length <= MAX_STORED_POINTS
    ? points
    : points.filter((_, i) => i === 0 || i === points.length - 1 || i % Math.ceil(points.length / MAX_STORED_POINTS) === 0);

  return {
    points: sampled,
    distanceMiles: Math.round(distanceMiles * 10) / 10,
    elevationGainFt: Math.round(elevationGainMeters * 3.28084),
  };
}
