import type { Db } from "./store";

/** Public group DTO: deliberately contains no account email, phone, moderation notes, or private membership data. */
export function publicGroups(db: Db, cityId: string) {
  return db.listGroups().filter(g => g.cityId === cityId && (g.status ?? "published") === "published" && !(g.archived ?? false)).map(g => ({
    id:g.id, ownerId:g.ownerId, cityId:g.cityId, name:g.name, groupType:g.groupType, description:g.description,
    coverPhotoUrl:g.coverPhotoRef ? `/uploads/public/${g.coverPhotoRef}` : null,
    logoPhotoUrl:g.logoPhotoRef ? `/uploads/public/${g.logoPhotoRef}` : null,
    websiteUrl:g.websiteUrl, groupmeUrl:g.groupmeUrl, facebookUrl:g.facebookUrl, instagramUrl:g.instagramUrl,
    membershipMode:g.membershipMode, rrcaVerified:g.rrcaBadge,
    leaders:(g.leaderIds ?? []).map(id => { const a=db.getAccount(id); return a ? {id:a.id,name:a.name,username:a.username,profilePhotoUrl:a.profilePhotoRef?`/uploads/public/${a.profilePhotoRef}`:null} : null }).filter(Boolean),
  }));
}
export function publicGroup(db: Db, id: string) { return publicGroups(db, db.getGroup(id)?.cityId ?? "").find(g=>g.id===id) ?? null; }
