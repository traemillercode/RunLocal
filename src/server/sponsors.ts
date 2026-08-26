import { newId, type Db } from "./store";
import type { SponsorRecord } from "./types";
import { authorizeAdmin, type AdminResult, type AdminCtx } from "./admin";

/** Real slot caps, mirrored client-side for display but enforced here — the actual source of truth. One featured + three standard per city, four total. */
export const SPONSOR_TIER_CAPS = { featured: 1, standard: 3 } as const;

export interface PublicSponsor {
  id: string;
  tier: "featured" | "standard";
  businessName: string;
  tagline: string;
  linkUrl: string;
  logoUrl: string | null;
  startDate: string;
  endDate: string;
}

function toPublic(s: SponsorRecord): PublicSponsor {
  return {
    id: s.id,
    tier: s.tier,
    businessName: s.businessName,
    tagline: s.tagline,
    linkUrl: s.linkUrl,
    logoUrl: s.logoRef ? `/uploads/public/${s.logoRef}` : null,
    startDate: s.startDate,
    endDate: s.endDate,
  };
}

/** GET /api/sponsors — public, no auth, only active placements. */
export function publicSponsors(db: Db, cityId: string): PublicSponsor[] {
  return db.listActiveSponsors(cityId).map(toPublic);
}

export interface SponsorPaymentView {
  id: string;
  tier: "featured" | "standard";
  businessName: string;
  active: boolean;
  priceUsd: number;
  startDate: string;
  endDate: string;
}

/**
 * GET /api/sponsors/:id/payment — public, no admin auth. Knowing the id is
 * the authorization here: this is a one-time link sent directly to a
 * specific business for a booking already created (either self-serve or by
 * the owner), not a discoverable or listable resource. Works whether the
 * sponsor is still pending (not yet paid) or already active (so a business
 * revisiting a paid link sees a clear "already active" state instead of an
 * error).
 */
export function publicSponsorPayment(db: Db, id: string, priceUsd: (tier: "featured" | "standard", startDate: string, endDate: string) => number): SponsorPaymentView | null {
  const s = db.getSponsor(id);
  if (!s) return null;
  return { id: s.id, tier: s.tier, businessName: s.businessName, active: s.active, priceUsd: priceUsd(s.tier, s.startDate, s.endDate), startDate: s.startDate, endDate: s.endDate };
}

interface AdminSponsorView extends PublicSponsor {
  active: boolean;
  createdAt: string;
}

function toAdminView(s: SponsorRecord): AdminSponsorView {
  return { ...toPublic(s), active: s.active, createdAt: s.createdAt };
}

/** GET /api/admin/sponsors — every sponsor for a city, active or not, for the management list. */
export function listAdminSponsors(db: Db, ctx: AdminCtx, cityId: string, now = new Date()): AdminResult<{ sponsors: AdminSponsorView[] }> {
  const auth = authorizeAdmin(db, ctx, "admin.sponsor_create", null, now);
  if (!auth.ok) return auth;
  return { ok: true, data: { sponsors: db.listAllSponsors(cityId).map(toAdminView) } };
}

interface SponsorInput {
  cityId?: unknown;
  tier?: unknown;
  businessName?: unknown;
  tagline?: unknown;
  linkUrl?: unknown;
  logoRef?: unknown;
  active?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Max single booking length — keeps a request from squatting on a slot for years. */
const MAX_BOOKING_DAYS = 90;

/** Validates a booking's date range: right format, start on/after today, end on/after start, and not absurdly long. Returns the validated pair or an error message. */
function validateDateRange(startRaw: unknown, endRaw: unknown, now: Date): { ok: true; startDate: string; endDate: string } | { ok: false; message: string } {
  const startDate = typeof startRaw === "string" ? startRaw : "";
  const endDate = typeof endRaw === "string" ? endRaw : "";
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) return { ok: false, message: "Pick a start and end date." };
  const today = now.toISOString().slice(0, 10);
  if (startDate < today) return { ok: false, message: "Start date can't be in the past." };
  if (endDate < startDate) return { ok: false, message: "End date must be on or after the start date." };
  const days = (new Date(endDate + "T00:00:00Z").getTime() - new Date(startDate + "T00:00:00Z").getTime()) / 86_400_000 + 1;
  if (days > MAX_BOOKING_DAYS) return { ok: false, message: `Bookings can't be longer than ${MAX_BOOKING_DAYS} days — contact Kimbio directly for a longer placement.` };
  return { ok: true, startDate, endDate };
}

function validateUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** POST /api/admin/sponsors — create a new placement booking. Returns 409 slot_full if the requested date range is already at capacity for that tier. */
export function createSponsor(db: Db, ctx: AdminCtx, input: SponsorInput, now = new Date()): AdminResult<{ sponsor: AdminSponsorView }> {
  const auth = authorizeAdmin(db, ctx, "admin.sponsor_create", null, now);
  if (!auth.ok) return auth;
  const cityId = typeof input.cityId === "string" && input.cityId ? input.cityId : "columbia-mo";
  const tier = input.tier === "featured" ? "featured" : "standard";
  const businessName = typeof input.businessName === "string" ? input.businessName.trim().slice(0, 60) : "";
  if (!businessName) return { ok: false, status: 400, error: "invalid_name", message: "Business name is required." };
  const tagline = typeof input.tagline === "string" ? input.tagline.trim().slice(0, 120) : "";
  const linkUrl = validateUrl(input.linkUrl);
  if (!linkUrl) return { ok: false, status: 400, error: "invalid_url", message: "Enter a valid https:// link for the business." };
  const dates = validateDateRange(input.startDate, input.endDate, now);
  if (!dates.ok) return { ok: false, status: 400, error: "invalid_dates", message: dates.message };
  const logoRef = typeof input.logoRef === "string" && input.logoRef ? input.logoRef : null;
  const active = input.active !== false;
  const at = now.toISOString();
  const rec = db.createSponsor({ id: newId(), cityId, tier, businessName, tagline, linkUrl, logoRef, active, startDate: dates.startDate, endDate: dates.endDate, createdAt: at, updatedAt: at });
  if (!rec) return { ok: false, status: 409, error: "slot_full", message: `The ${tier} tier is already booked for part of that date range. Try different dates.` };
  return { ok: true, data: { sponsor: toAdminView(rec) } };
}

/** PATCH /api/admin/sponsors/:id */
export function updateSponsor(db: Db, ctx: AdminCtx, id: string, input: SponsorInput, now = new Date()): AdminResult<{ sponsor: AdminSponsorView }> {
  const existing = db.getSponsor(id);
  if (!existing) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeAdmin(db, ctx, "admin.sponsor_edit", id, now);
  if (!auth.ok) return auth;
  const patch: Partial<SponsorRecord> = {};
  if (typeof input.businessName === "string") patch.businessName = input.businessName.trim().slice(0, 60);
  if (typeof input.tagline === "string") patch.tagline = input.tagline.trim().slice(0, 120);
  if (input.linkUrl !== undefined) {
    const linkUrl = validateUrl(input.linkUrl);
    if (!linkUrl) return { ok: false, status: 400, error: "invalid_url", message: "Enter a valid https:// link for the business." };
    patch.linkUrl = linkUrl;
  }
  if (input.startDate !== undefined || input.endDate !== undefined) {
    const dates = validateDateRange(input.startDate ?? existing.startDate, input.endDate ?? existing.endDate, now);
    if (!dates.ok) return { ok: false, status: 400, error: "invalid_dates", message: dates.message };
    patch.startDate = dates.startDate;
    patch.endDate = dates.endDate;
  }
  if (typeof input.logoRef === "string") patch.logoRef = input.logoRef || null;
  if (input.tier === "featured" || input.tier === "standard") patch.tier = input.tier;
  if (typeof input.active === "boolean") patch.active = input.active;
  const updated = db.updateSponsor(id, patch);
  if (!updated) return { ok: false, status: 409, error: "slot_full", message: `That tier is already booked for part of that date range.` };
  return { ok: true, data: { sponsor: toAdminView(updated) } };
}

/**
 * POST /api/sponsors/inquire — public, no admin auth. A business picks a
 * tier and date range and submits their own info directly, rather than the
 * owner creating the booking manually. Always created with active:false
 * regardless of any active value in the input — a self-serve submission
 * only ever goes live after payment confirms via the webhook (see
 * activateSponsorFromEvent in payments.ts), never at submission time.
 * Returns 409 if the requested dates are already booked, so the business
 * finds out immediately rather than after "paying" for an unavailable slot.
 */
export function submitSponsorInquiry(db: Db, input: SponsorInput, now = new Date()): { ok: true; data: { sponsor: AdminSponsorView } } | { ok: false; status: number; error: string; message: string } {
  const cityId = typeof input.cityId === "string" && input.cityId ? input.cityId : "columbia-mo";
  const tier = input.tier === "featured" ? "featured" : "standard";
  const businessName = typeof input.businessName === "string" ? input.businessName.trim().slice(0, 60) : "";
  if (!businessName) return { ok: false, status: 400, error: "invalid_name", message: "Business name is required." };
  const tagline = typeof input.tagline === "string" ? input.tagline.trim().slice(0, 120) : "";
  const linkUrl = validateUrl(input.linkUrl);
  if (!linkUrl) return { ok: false, status: 400, error: "invalid_url", message: "Enter a valid https:// link for the business." };
  const dates = validateDateRange(input.startDate, input.endDate, now);
  if (!dates.ok) return { ok: false, status: 400, error: "invalid_dates", message: dates.message };
  if (!db.sponsorRangeAvailable(cityId, tier, dates.startDate, dates.endDate)) {
    return { ok: false, status: 409, error: "slot_full", message: "Those dates just got booked for this tier — try a different range." };
  }
  const logoRef = typeof input.logoRef === "string" && input.logoRef ? input.logoRef : null;
  const at = now.toISOString();
  const rec = db.createSponsor({ id: newId(), cityId, tier, businessName, tagline, linkUrl, logoRef, active: false, startDate: dates.startDate, endDate: dates.endDate, createdAt: at, updatedAt: at });
  if (!rec) return { ok: false, status: 409, error: "slot_full", message: "Those dates just got booked for this tier — try a different range." };
  return { ok: true, data: { sponsor: toAdminView(rec) } };
}

/**
 * GET /api/sponsors/availability — public. Given a tier and date range,
 * reports whether it's fully bookable, so the inquiry page can validate
 * before the business fills out the whole form.
 */
export function checkSponsorAvailability(db: Db, cityId: string, tier: "featured" | "standard", startDate: string, endDate: string): { available: boolean } {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || endDate < startDate) return { available: false };
  return { available: db.sponsorRangeAvailable(cityId, tier, startDate, endDate) };
}
export function deleteSponsor(db: Db, ctx: AdminCtx, id: string, now = new Date()): AdminResult<{ deleted: true }> {
  const existing = db.getSponsor(id);
  if (!existing) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeAdmin(db, ctx, "admin.sponsor_delete", id, now);
  if (!auth.ok) return auth;
  db.deleteSponsor(id);
  return { ok: true, data: { deleted: true } };
}
