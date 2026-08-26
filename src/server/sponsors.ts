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
}

function toPublic(s: SponsorRecord): PublicSponsor {
  return {
    id: s.id,
    tier: s.tier,
    businessName: s.businessName,
    tagline: s.tagline,
    linkUrl: s.linkUrl,
    logoUrl: s.logoRef ? `/uploads/public/${s.logoRef}` : null,
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
}

/**
 * GET /api/sponsors/:id/payment — public, no admin auth. Knowing the id is
 * the authorization here: this is a one-time link the owner sends directly
 * to a specific business for a deal already agreed on, not a discoverable
 * or listable resource. Works whether the sponsor is still pending (not yet
 * paid) or already active (so a business revisiting a paid link sees a
 * clear "already active" state instead of an error).
 */
export function publicSponsorPayment(db: Db, id: string, priceUsd: (tier: "featured" | "standard") => number): SponsorPaymentView | null {
  const s = db.getSponsor(id);
  if (!s) return null;
  return { id: s.id, tier: s.tier, businessName: s.businessName, active: s.active, priceUsd: priceUsd(s.tier) };
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

/** POST /api/admin/sponsors — create a new placement. Returns 409 slot_full if the tier is already at capacity while active. */
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
  const logoRef = typeof input.logoRef === "string" && input.logoRef ? input.logoRef : null;
  const active = input.active !== false;
  const at = now.toISOString();
  const rec = db.createSponsor({ id: newId(), cityId, tier, businessName, tagline, linkUrl, logoRef, active, createdAt: at, updatedAt: at });
  if (!rec) return { ok: false, status: 409, error: "slot_full", message: `The ${tier} tier is already full (${SPONSOR_TIER_CAPS[tier]} max). Deactivate one first.` };
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
  if (typeof input.logoRef === "string") patch.logoRef = input.logoRef || null;
  if (input.tier === "featured" || input.tier === "standard") patch.tier = input.tier;
  if (typeof input.active === "boolean") patch.active = input.active;
  const updated = db.updateSponsor(id, patch);
  if (!updated) return { ok: false, status: 409, error: "slot_full", message: `That tier is already full. Deactivate another placement first.` };
  return { ok: true, data: { sponsor: toAdminView(updated) } };
}

/** DELETE /api/admin/sponsors/:id — real deletion, no notes-field workaround. */
export function deleteSponsor(db: Db, ctx: AdminCtx, id: string, now = new Date()): AdminResult<{ deleted: true }> {
  const existing = db.getSponsor(id);
  if (!existing) return { ok: false, status: 404, error: "not_found" };
  const auth = authorizeAdmin(db, ctx, "admin.sponsor_delete", id, now);
  if (!auth.ok) return auth;
  db.deleteSponsor(id);
  return { ok: true, data: { deleted: true } };
}
