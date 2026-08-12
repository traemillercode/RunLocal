/**
 * Group Lead scoped moderation for group runs — server-side capability
 * computation + the PATCH /api/events/:id/moderation handler.
 *
 * Scope rule (owner-fixed): a Group Lead may hide / restore / delete ONLY the
 * recurring group runs of groups they lead (`event.groupId` non-empty and the
 * group resolves, same city, verified lead via `canManageGroupOps`). Races and
 * independent/community events (empty or unresolvable groupId) stay
 * City/Global-admin-only — a lead must NEVER receive moderation capabilities on
 * them. City Admins (scoped to the event's city) and the Global Admin receive
 * the same three keys regardless of groupId, matching the forum capability
 * model (`forumPostCapabilities`): the server is the only authority, the
 * client renders the list verbatim, and every listed action re-validates the
 * same predicate on the mutation endpoint.
 *
 * Capability list semantics (mirrors contentAdmin's event transitions):
 *  - hide      → `hidden=true, status="hidden"`  (dropped from publicEvents)
 *  - restore   → `hidden=false, status="published"` (reverse of hide)
 *  - delete    → `status="archived", archivedAt=now` (terminal, no restore)
 * An already-hidden event omits "hide" (["restore","delete"]); archived events
 * always return [].
 *
 * Audit model: leads are not operators — the mutation is audited with a
 * reason-free routine context (no reason prompt) and distinct action names
 * (`group_lead.event_hide` / `group_lead.event_restore` / `group_lead.event_delete`)
 * so the trail distinguishes scoped group-run moderation from the operator
 * `admin.event_*` / `admin.content_*` paths. The lead's account id is recorded
 * on the audit row (`accountId`). City/Global Admins using the same endpoint
 * are authorized through the existing `authorizeScoped` path (city scope
 * enforced server-side) and audited with the same distinct action names under
 * the routine reason — no operator reason prompt on this endpoint.
 */
import type { AdminCtx, AdminResult } from "./admin";
import { authorizeScoped, sessionAccount } from "./admin";
import { canManageGroupOps, isCityAdminForCity, isGlobalAdmin } from "./roles";
import type { Db } from "./store";
import type { AccountRecord, AdminAction, RunEventRecord } from "./types";

/** Actions accepted by PATCH /api/events/:id/moderation. */
export type EventModerationAction = "hide" | "restore" | "delete";
const EVENT_MODERATION_ACTIONS: readonly EventModerationAction[] = ["hide", "restore", "delete"];
/** Server-generated routine reason — leads/admins are not prompted for a reason on this endpoint. */
const ROUTINE_REASON = "Routine event moderation (scoped)";

/** Server-computed moderation capabilities for one canonical event row. */
export type EventCapability = "hide" | "restore" | "delete";

/**
 * Capability list for a canonical event as seen by `actor`:
 *  - Group Lead (owner or listed leader, verified, home city = group city)
 *    of the event's own group → hide / restore / delete. Only when
 *    `event.groupId` is non-empty, the group resolves, and the group's city
 *    equals the event's city. Hidden events omit "hide".
 *  - City Admin scoped to the event's city and the Global Admin → the same
 *    three keys on group runs AND independent events AND race-like records
 *    (any event, regardless of groupId).
 *  - Everyone else (guests, unverified/pending/rejected, deleted, cross-city,
 *    leads of OTHER groups) → [].
 *  - Archived events → [].
 */
export function eventCapabilities(db: Db, actor: AccountRecord | null | undefined, event: RunEventRecord | undefined): EventCapability[] {
  if (!actor || actor.deletedAt || !event) return [];
  if (event.archivedAt || event.status === "archived") return [];
  const admin = isGlobalAdmin(actor) || isCityAdminForCity(actor, event.cityId);
  const group = event.groupId ? db.getGroup(event.groupId) : undefined;
  const lead = Boolean(group && event.cityId === group.cityId && canManageGroupOps(db, group, actor));
  if (!admin && !lead) return [];
  return event.hidden ? ["restore", "delete"] : ["hide", "restore", "delete"];
}

function auditActionFor(action: EventModerationAction): AdminAction {
  return action === "hide" ? "group_lead.event_hide" : action === "restore" ? "group_lead.event_restore" : "group_lead.event_delete";
}

function changeFor(action: EventModerationAction): string {
  return action === "hide"
    ? "hidden (public rendering removed)"
    : action === "restore"
      ? "restored to public rendering"
      : "deleted (soft): event archived; no restore path";
}

/**
 * PATCH /api/events/:id/moderation — scoped hide/restore/delete of a canonical
 * event. Authorizes through the SAME predicate as `eventCapabilities`:
 *  - group lead (via `canManageGroupOps` on the event's group, city-enforced)
 *    — group-run events only; 403 otherwise;
 *  - city/global admin via the existing `authorizeScoped` AdminCtx path
 *    (enforceCity = event.cityId), which also writes the audit entry.
 * Unknown ids → 404. Unauthorized identities → 401. Authorized-but-not-scoped
 * (lead on a non-group event / event of another group, cross-city) → 403.
 * State guards mirror contentAdmin (already_hidden / not_hidden /
 * already_archived → 409). The event record transition reuses contentAdmin's
 * semantics (hidden flag / status / archivedAt) so `publicEvents` reflects the
 * decision. Audited with the distinct `group_lead.event_*` actions; leads
 * record their account id and a reason-free routine context.
 */
export function moderateEvent(db: Db, ctx: AdminCtx, id: string, action: string, now = new Date()): AdminResult<RunEventRecord> {
  const event = db.getEvent(id);
  if (!event) return { ok: false, status: 404, error: "not_found" };
  if (!(EVENT_MODERATION_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, status: 400, error: "invalid_action" };
  }
  const actor = sessionAccount(db, ctx);
  const keyAdmin = ctx.adminSessionId ? db.getSession(ctx.adminSessionId) : undefined;
  const keyAdminSession = Boolean(keyAdmin && keyAdmin.accountId === "__admin__");
  if (!actor && !keyAdminSession) return { ok: false, status: 401, error: "sign_in_required" };

  const group = event.groupId ? db.getGroup(event.groupId) : undefined;
  const isAdmin = keyAdminSession || Boolean(actor && (isGlobalAdmin(actor) || isCityAdminForCity(actor, event.cityId)));
  // Lead path is scoped to group-run events of groups the actor leads (same
  // city); admins are excluded here so their audit/scope flow stays uniform.
  const isLead = Boolean(actor && !isAdmin && group && event.cityId === group.cityId && canManageGroupOps(db, group, actor));
  if (!isAdmin && !isLead) return { ok: false, status: 403, error: "forbidden" };

  // State guards (mirror contentAdmin hide/restore/archive semantics).
  if (event.archivedAt || event.status === "archived") return { ok: false, status: 409, error: "already_archived" };
  if (action === "hide" && event.hidden) return { ok: false, status: 409, error: "already_hidden" };
  if (action === "restore" && !event.hidden) return { ok: false, status: 409, error: "not_hidden" };

  const auditAction = auditActionFor(action as EventModerationAction);
  const change = changeFor(action as EventModerationAction);
  const at = now.toISOString();
  const updatedBy = actor ? actor.id : "admin";

  if (isLead && actor) {
    // Lead path: audited directly, reason-free, with the actor's account id.
    db.appendAudit(
      {
        admin: actor.email,
        accountId: actor.id,
        action: auditAction,
        reason: ROUTINE_REASON,
        targetId: event.id,
        ip: "leader-action",
        cityId: event.cityId,
        owner: actor.email,
        change,
      },
      now,
    );
  } else {
    // Admin path: authorizeScoped enforces city scope and audits (routine
    // reason — this endpoint never prompts for an operator reason).
    const routineCtx: AdminCtx = { ...ctx, reason: ctx.reason?.trim() || ROUTINE_REASON };
    const auth = authorizeScoped(db, routineCtx, auditAction, event.id, now, {
      enforceCity: event.cityId,
      auditCity: event.cityId,
      owner: actor?.email ?? null,
      change,
    });
    if (!auth.ok) return auth;
  }

  const next: RunEventRecord =
    action === "hide"
      ? { ...event, hidden: true, status: "hidden", updatedAt: at, updatedBy }
      : action === "restore"
        ? { ...event, hidden: false, status: "published", updatedAt: at, updatedBy }
        : { ...event, status: "archived", archivedAt: at, updatedAt: at, updatedBy };
  db.setEvent(next);
  return { ok: true, data: next };
}
