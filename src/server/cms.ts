/**
 * Global Admin CMS: persisted site settings + city entities.
 *
 * Everything here is reason-gated and audited via authorizeAdmin (key admin
 * OR the owner's signed-in session). The public surface is deliberate:
 *   - /api/config exposes only *public* settings (never secrets) and ACTIVE
 *     cities;
 *   - settings responses carry opaque image refs, never data URLs or bytes;
 *   - provider integration state is "offered" (CMS toggle) + "configured"
 *     (deployment-managed env vars) — the UI can state honestly whether
 *     credentials exist, but no value is ever returned and nothing can be
 *     edited dynamically when the deployment owns the secrets.
 */
import type { AdminCtx, AdminResult } from "./admin";
import { authorizeAdmin } from "./admin";
import { adapters, configError } from "./activity";
import type { Db } from "./store";
import { newId } from "./store";
import { CITIES } from "../data/cities";
import type { CmsCity, CmsCityStatus, SiteSettings } from "./types";

export const CITY_STATUSES: CmsCityStatus[] = ["active", "coming_soon", "invite_only", "inactive"];

export const DEFAULT_SETTINGS: SiteSettings = { title:"Kimbio", wordmark:"Kimbio", tagline:"Find your local run.", primary:"#0b2b22", accent:"#c8f169", surface:"#f7f8f3", strings:{}, tags:{runTypes:["Social run","Track","Trail","Long run"],credentialBodies:["RRCA"],qa:["Training","Shoes","Routes"],ratings:["Easy","Moderate","Hard"]}, providers:{strava:true,garmin:false,coros:false,suunto:false}, bottomNav:["home","races","clubs","forum"], announcement:null, logoRef:null, faviconRef:null, trust:{ underReviewThreshold: 3 } };

export const BOTTOM_NAV_KEYS = ["home", "races", "clubs", "forum"] as const;
export const PROVIDER_KEYS = ["strava", "garmin", "coros", "suunto"] as const;
export const TAG_KEYS = ["runTypes", "credentialBodies", "qa", "ratings"] as const;
export const CMS_REF_PATTERN = /^cms-[a-f0-9]+\.(jpg|png|webp)$/;
export const MAX_CMS_IMAGE_BYTES = 4 * 1024 * 1024;

const hex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const https = (v: unknown): v is string => typeof v === "string" && /^https:\/\//i.test(v);
const bounded = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

function text(v: unknown, max: number, emptyOk: boolean): v is string {
  if (!bounded(v, max)) return false;
  const t = v.trim();
  return emptyOk ? t.length >= 0 : t.length > 0;
}

/** Public shape of settings — secrets are never part of the model, but strip defensively. */
function safe(s: SiteSettings): SiteSettings {
  const { secrets: _drop, ...rest } = s as SiteSettings & { secrets?: unknown };
  return rest;
}
export function publicSettings(db: Db): SiteSettings { return safe(db.getSettings(DEFAULT_SETTINGS)); }

/** CMS "offered" toggle for a provider (defaults to offered when unset). */
export function providerEnabled(db: Db, provider: string): boolean {
  return db.getSettings(DEFAULT_SETTINGS).providers[provider] !== false;
}

export interface CmsIntegration {
  provider: string;
  /** CMS toggle — whether the provider is offered to runners on this site. */
  offered: boolean;
  /** Deployment-managed — whether server env credentials exist for OAuth. */
  configured: boolean;
  /** Names of missing env vars ONLY (never values). */
  missing: string[];
}
/** Honest integration status: offered (CMS) × configured (deployment env). */
export function integrations(db: Db): CmsIntegration[] {
  const s = db.getSettings(DEFAULT_SETTINGS);
  return PROVIDER_KEYS.map((p) => {
    const offered = s.providers[p] !== false;
    const adapter = adapters[p];
    const configured = adapter.configured();
    return { provider: p, offered, configured, missing: configured ? [] : configError(p).missing };
  });
}

function validateSettings(next: SiteSettings): string | null {
  if (!text(next.title, 100, false)) return "invalid_text";
  if (!text(next.wordmark, 100, false)) return "invalid_text";
  if (!text(next.tagline, 200, true)) return "invalid_text";
  if (!hex(next.primary) || !hex(next.accent) || !hex(next.surface)) return "invalid_color";
  const a = next.announcement;
  if (a !== null) {
    if (typeof a !== "object" || !text((a as { text?: unknown }).text, 300, false)) return "invalid_announcement";
    const link = (a as { link?: unknown }).link;
    if (link !== undefined && link !== null && !(https(link) && link.length <= 500)) return "invalid_url";
  }
  if (!Array.isArray(next.bottomNav)) return "invalid_bottom_nav";
  if (next.bottomNav.length > 10) return "invalid_bottom_nav";
  const seen = new Set<string>();
  for (const item of next.bottomNav) {
    if (typeof item !== "string" || !(BOTTOM_NAV_KEYS as readonly string[]).includes(item) || seen.has(item)) return "invalid_bottom_nav";
    seen.add(item);
  }
  if (typeof next.providers !== "object" || next.providers === null) return "invalid_provider_flags";
  for (const [k, v] of Object.entries(next.providers)) {
    if (!(PROVIDER_KEYS as readonly string[]).includes(k) || typeof v !== "boolean") return "invalid_provider_flags";
  }
  if (typeof next.tags !== "object" || next.tags === null) return "invalid_tags";
  for (const [k, v] of Object.entries(next.tags)) {
    if (!(TAG_KEYS as readonly string[]).includes(k) || !Array.isArray(v)) return "invalid_tags";
    if (v.length > 50) return "invalid_tags";
    for (const item of v) if (typeof item !== "string" || item.length > 60) return "invalid_tags";
  }
  if (typeof next.strings !== "object" || next.strings === null) return "invalid_strings";
  if (Object.keys(next.strings).length > 40) return "invalid_strings";
  for (const [k, v] of Object.entries(next.strings)) {
    if (k.length > 60 || typeof v !== "string" || v.length > 500) return "invalid_strings";
  }
  for (const ref of [next.logoRef, next.faviconRef]) {
    if (ref !== null && !(typeof ref === "string" && ref.length <= 200)) return "invalid_ref";
  }
  // Community-trust policy: an integer threshold in [1, 10] (default 3).
  const trust = next.trust as { underReviewThreshold?: unknown } | undefined;
  if (!trust || typeof trust !== "object") return "invalid_trust_threshold";
  const t = trust.underReviewThreshold;
  if (typeof t !== "number" || !Number.isInteger(t) || t < 1 || t > 10) return "invalid_trust_threshold";
  return null;
}

export function updateSettings(db: Db, ctx: AdminCtx, input: Partial<SiteSettings>, now = new Date()): AdminResult<{ settings: SiteSettings }> {
  const auth = authorizeAdmin(db, ctx, "admin.cms_settings", null, now);
  if (!auth.ok) return auth as AdminResult<{ settings: SiteSettings }>;
  const prev = db.getSettings(DEFAULT_SETTINGS);
  const next: SiteSettings = {
    ...prev,
    ...input,
    strings: { ...prev.strings, ...(input.strings ?? {}) },
    tags: { ...prev.tags, ...(input.tags ?? {}) },
    providers: { ...prev.providers, ...(input.providers ?? {}) },
    trust: { ...DEFAULT_SETTINGS.trust, ...(input.trust ?? prev.trust) },
  };
  const invalid = validateSettings(next);
  if (invalid) return { ok: false, status: 400, error: invalid };
  db.setSettings(next);
  db.appendAudit({ admin: auth.data.admin, action: "admin.cms_settings", reason: ctx.reason!.trim(), targetId: null, ip: ctx.ip }, now);
  return { ok: true, data: { settings: publicSettings(db) } };
}

export function saveCity(db: Db, ctx: AdminCtx, input: Partial<CmsCity> & { id?: string }, now = new Date()): AdminResult<{ city: CmsCity }> {
  // Generate the target id BEFORE authorizing so the audit entry carries the
  // city id that the action creates or updates.
  const id = input.id ?? newId();
  const auth = authorizeAdmin(db, ctx, "admin.cms_city", id, now);
  if (!auth.ok) return auth as AdminResult<{ city: CmsCity }>;
  if (typeof input.name !== "string" || typeof input.state !== "string" || typeof input.slug !== "string") return { ok: false, status: 400, error: "invalid_city" };
  const name = input.name.trim().slice(0, 80);
  const state = input.state.trim().slice(0, 40);
  const slug = input.slug.trim();
  if (!name || !state || !/^[a-z0-9-]{2,50}$/.test(slug)) return { ok: false, status: 400, error: "invalid_city" };
  if (input.id !== undefined && (typeof input.id !== "string" || input.id.length === 0 || input.id.length > 80)) return { ok: false, status: 400, error: "invalid_city" };
  const prev = input.id ? db.getCity(input.id) : undefined;
  // Slug uniqueness across OTHER cities — the slug is the public URL identity.
  const slugTaken = db.listCities().some((c) => c.id !== (input.id ?? "") && c.slug === slug);
  if (slugTaken) return { ok: false, status: 400, error: "duplicate_slug" };
  const headerImageRef = input.headerImageRef === undefined ? (prev?.headerImageRef ?? null) : typeof input.headerImageRef === "string" && input.headerImageRef.length <= 200 ? input.headerImageRef : null;
  const accent = input.accent === undefined ? (prev?.accent ?? null) : hex(input.accent) ? input.accent : null;
  // Status is one of the four lifecycle states; unknown values fall back to
  // the previous status (or "active" for new cities).
  const status: CmsCityStatus =
    input.status !== undefined && (CITY_STATUSES as readonly string[]).includes(String(input.status))
      ? (input.status as CmsCityStatus)
      : (prev?.status ?? "active");
  const city: CmsCity = {
    id,
    name,
    state,
    slug,
    status,
    headerImageRef,
    accent,
  };
  db.setCity(city);
  return { ok: true, data: { city } };
}

/** Deactivate (soft delete) a city — status flips to inactive. */
export function deleteCity(db: Db, ctx: AdminCtx, id: string, now = new Date()): AdminResult<{ city: CmsCity }> {
  const a = authorizeAdmin(db, ctx, "admin.cms_city", id, now);
  if (!a.ok) return a as AdminResult<{ city: CmsCity }>;
  const c = db.getCity(id);
  if (!c) return { ok: false, status: 404, error: "not_found" };
  c.status = "inactive";
  db.setCity(c);
  return { ok: true, data: { city: c } };
}

/**
 * Decode + validate a CMS image data URL (jpeg/png/webp, ≤4MB decoded).
 * Returns the raw bytes so the caller can persist them under an opaque ref.
 */
export function decodeCmsImage(data: unknown): { ok: true; bytes: Buffer; ext: "jpg" | "png" | "webp" } | { ok: false; error: string } {
  if (typeof data !== "string") return { ok: false, error: "invalid_image" };
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(data.trim());
  if (!m) return { ok: false, error: "invalid_image" };
  const ext = (m[1] === "jpeg" ? "jpg" : m[1]) as "jpg" | "png" | "webp";
  const bytes = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  if (bytes.length === 0) return { ok: false, error: "invalid_image" };
  // MAX_CMS_IMAGE_BYTES was declared and never referenced, so this docblock's
  // "≤4MB decoded" was aspirational: any image under the 6MB JSON body cap was
  // accepted. Same shape as the other declared-but-unused defects found this
  // week — the constant reads as enforcement without being any.
  if (bytes.length > MAX_CMS_IMAGE_BYTES) return { ok: false, error: "image_too_large" };
  // CMS remains separately scoped: it validates data-URL syntax and size only;
  // profile/selfie/group uploads use the stricter shared dimensional validator.
  return { ok: true, bytes, ext };
}

/** Boolean validator kept for callers that only need pass/fail. */
export function validateUpload(data: unknown): boolean {
  return decodeCmsImage(data).ok;
}

/** Persist an uploaded image under an opaque ref; returns the ref only. */
export async function storeCmsUpload(db: Db, data: unknown): Promise<{ ok: true; ref: string; ext: string } | { ok: false; error: string }> {
  const decoded = decodeCmsImage(data);
  if (!decoded.ok) return decoded;
  const ref = `cms-${newId()}.${decoded.ext}`;
  await db.saveRef(ref, decoded.bytes);
  return { ok: true, ref, ext: decoded.ext };
}

/** Refs that the PUBLIC site may serve right now (brand + active-city headers). */
export function referencedRefs(db: Db): Set<string> {
  const s = db.getSettings(DEFAULT_SETTINGS);
  const out = new Set<string>();
  for (const ref of [s.logoRef, s.faviconRef]) if (ref) out.add(ref);
  for (const c of db.listCities()) {
    if (c.status === "active" && c.headerImageRef) out.add(c.headerImageRef);
  }
  return out;
}
export function publicRefAllowed(db: Db, ref: string): boolean {
  return referencedRefs(db).has(ref);
}

export function refContentType(ref: string): string {
  if (ref.endsWith(".png")) return "image/png";
  if (ref.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/**
 * Mirror the known static city entities (src/data/cities.ts) into the CMS
 * city store on first boot — idempotent, never overwrites admin edits.
 * Non-live placeholder cities seed as `coming_soon` (visible but not
 * enterable) so only launched cities are open.
 */
export function seedCmsCities(db: Db): void {
  for (const c of CITIES) {
    if (db.getCity(c.id)) continue;
    db.setCity({
      id: c.id,
      name: c.name,
      state: c.state,
      slug: c.id,
      status: c.live ? "active" : "coming_soon",
      headerImageRef: null,
      accent: null,
    });
  }
}

/**
 * Resolve a city's lifecycle status from the server-authoritative runtime
 * registry, falling back to the seeded defaults when the store has no entry
 * yet (memory stores / pre-seed boot). This is the ONE place city status is
 * decided server-side; every signup / home-city / submission / content path
 * goes through it so validation is never hardcoded to a specific city.
 */
export function cityStatus(db: Db, id: string): CmsCityStatus | null {
  const c = db.getCity(id);
  if (c) return c.status;
  const seed = CITIES.find((x) => x.id === id);
  if (seed) return seed.live ? "active" : "coming_soon";
  return null;
}

/** Whether the id names a KNOWN city entity (store or seed). */
export function cityExists(db: Db, id: string): boolean {
  return cityStatus(db, id) !== null;
}

/**
 * Whether a city may be newly ENTERED (signup or home-city selection).
 *  - active → yes;
 *  - invite_only → yes ONLY with a redeemable invitation (validated by the
 *    caller via the invitations module against the account email + token);
 *  - coming_soon / inactive → no (history retained, no new entry).
 */
export function cityEnterable(db: Db, id: string): boolean {
  const status = cityStatus(db, id);
  return status === "active" || status === "invite_only";
}

/**
 * Whether new SUBMISSIONS are accepted for a city. Active and invite-only
 * cities accept submissions (existing members of an invite-only city keep
 * participating); coming_soon and inactive cities deny new submissions while
 * retaining their existing content history.
 */
export function cityAcceptsSubmissions(db: Db, id: string): boolean {
  const status = cityStatus(db, id);
  return status === "active" || status === "invite_only";
}

/** Error code + message for "known but not enterable" city states. */
export function cityNotOpenError(status: CmsCityStatus): { status: 400; error: string; message: string } {
  if (status === "inactive") {
    return { status: 400, error: "city_inactive", message: "That city is no longer active — its history stays, but it isn't accepting new members." };
  }
  if (status === "coming_soon") {
    return { status: 400, error: "city_coming_soon", message: "That city is coming soon — it isn't open yet." };
  }
  return { status: 400, error: "invitation_required", message: "That city is invite-only — enter your invitation code to join." };
}

/**
 * Public city registry rows — the server-authoritative list the client
 * renders in the switcher / signup / home-city flows. Includes every status
 * (active / coming_soon / invite_only / inactive are all visible; the client
 * renders enterability). Merges seeded defaults so unseeded stores still
 * serve the full registry.
 */
export interface PublicCityRow {
  id: string;
  name: string;
  state: string;
  slug: string;
  status: CmsCityStatus;
  headerImageRef: string | null;
  accent: string | null;
}
export function publicCities(db: Db): PublicCityRow[] {
  const rows = new Map<string, PublicCityRow>();
  for (const c of db.listCities()) {
    rows.set(c.id, { id: c.id, name: c.name, state: c.state, slug: c.slug, status: c.status, headerImageRef: c.headerImageRef, accent: c.accent });
  }
  for (const c of CITIES) {
    if (rows.has(c.id)) continue;
    rows.set(c.id, {
      id: c.id,
      name: c.name,
      state: c.state,
      slug: c.id,
      status: c.live ? "active" : "coming_soon",
      headerImageRef: null,
      accent: null,
    });
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}
