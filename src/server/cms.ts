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
import type { CmsCity, SiteSettings } from "./types";

export const DEFAULT_SETTINGS: SiteSettings = { title:"Run Local", wordmark:"Run Local", tagline:"Find your local run.", primary:"#0b2b22", accent:"#c8f169", surface:"#f7f8f3", strings:{}, tags:{runTypes:["Social run","Track","Trail","Long run"],credentialBodies:["RRCA"],qa:["Training","Shoes","Routes"],ratings:["Easy","Moderate","Hard"]}, providers:{strava:true,garmin:true,coros:true,suunto:true}, bottomNav:["home","races","clubs","forum"], announcement:null, logoRef:null, faviconRef:null };

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
  const city: CmsCity = {
    id,
    name,
    state,
    slug,
    status: input.status === "inactive" ? "inactive" : "active",
    headerImageRef,
    accent,
  };
  db.setCity(city);
  return { ok: true, data: { city } };
}

/** Deactivate (soft delete) a city — active status flips to inactive. */
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
  if (bytes.length > MAX_CMS_IMAGE_BYTES) return { ok: false, error: "image_too_large" };
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
 * city store on first boot — idempotent, never overwrites admin edits, and
 * non-live placeholder cities start inactive so only launched cities are
 * public.
 */
export function seedCmsCities(db: Db): void {
  for (const c of CITIES) {
    if (db.getCity(c.id)) continue;
    db.setCity({
      id: c.id,
      name: c.name,
      state: c.state,
      slug: c.id,
      status: c.live ? "active" : "inactive",
      headerImageRef: null,
      accent: null,
    });
  }
}

/**
 * Whether a city id is valid for signup/home-city selection: known static
 * entity OR an ACTIVE CMS-managed city. Inactive CMS cities stop accepting
 * new members while existing members keep their home city.
 */
export function citySupported(db: Db, id: string): boolean {
  if (CITIES.some((c) => c.id === id)) return true;
  const c = db.getCity(id);
  return Boolean(c && c.status === "active");
}
