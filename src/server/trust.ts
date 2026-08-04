import { newId } from "./store";
import type { Db } from "./store";
import { ALLOWED_TRUST_TAGS, type CredentialType, type TrustTag } from "./types";

const MAX_PROOF = 8 * 1024 * 1024;
const MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
export function expireCredentials(db: Db, now = new Date()) {
  for (const c of db.listCredentials()) {
    if (c.expiresOn && new Date(c.expiresOn).getTime() <= now.getTime() && c.status === "verified") db.updateCredential(c.id, { status: "expired", updatedAt: now.toISOString() });
    if (c.expiresOn && new Date(c.expiresOn).getTime() - now.getTime() <= 30 * 86400000 && !c.renewalNotifiedAt) db.updateCredential(c.id, { renewalNotifiedAt: now.toISOString(), updatedAt: now.toISOString() });
  }
}
export function publicTrust(db: Db, accountId: string) {
  const ratings = db.listRatings().filter(r => r.revieweeId === accountId);
  const positive = ratings.filter(r => r.positive).length;
  const tier = positive >= 10 ? "well-regarded" : positive >= 3 ? "recognized" : "new";
  return { tier, coach: db.listCredentials(accountId).some(c => c.type === "coach_certification" && c.status === "verified"), host: tier !== "new" };
}
export function validTags(tags: unknown): tags is TrustTag[] { return Array.isArray(tags) && tags.length <= 3 && tags.every(t => typeof t === "string" && (ALLOWED_TRUST_TAGS as readonly string[]).includes(t)); }
export function parseProof(body: Record<string, unknown>) {
  if (typeof body.proof !== "string" || typeof body.proofMime !== "string" || !MIME.has(body.proofMime)) return null;
  const m = /^data:[^;]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(body.proof); if (!m) return null;
  const bytes = Buffer.from(m[1].replace(/\s/g, ""), "base64"); if (!bytes.length || bytes.length > MAX_PROOF) return null; return { bytes, mime: body.proofMime };
}
export function credentialType(v: unknown): v is CredentialType { return v === "coach_certification" || v === "first_aid_cpr"; }
export { newId };
