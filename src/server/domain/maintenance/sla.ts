import { db } from "@/server/db";
import { tenantDb } from "@/server/tenant";
import { enqueueEmail } from "@/server/outbox/outbox";
import { audit } from "@/server/audit/audit";

export const DEFAULT_SLA = {
  EMERGENCY: { respondMins: 60, resolveMins: 24 * 60 },
  HIGH: { respondMins: 240, resolveMins: 72 * 60 },
  NORMAL: { respondMins: 24 * 60, resolveMins: 7 * 24 * 60 },
  LOW: { respondMins: 72 * 60, resolveMins: 14 * 24 * 60 },
} as const;

export interface SlaClock {
  createdAt: Date;
  slaRespondBy: Date | null;
  slaResolveBy: Date | null;
  firstRespondedAt: Date | null;
  resolvedAt: Date | null;
  onHoldSince: Date | null;
  pausedMs: number;
}

/** Resolve deadline, pushed out by any time spent ON_HOLD (including the current hold). */
export function effectiveResolveBy(t: SlaClock, now: Date): Date | null {
  if (!t.slaResolveBy) return null;
  const heldNow = t.onHoldSince ? now.getTime() - t.onHoldSince.getTime() : 0;
  return new Date(t.slaResolveBy.getTime() + t.pausedMs + heldNow);
}

export type SlaState = { respond: "met" | "ok" | "warn" | "breached" | "n/a"; resolve: "met" | "ok" | "warn" | "breached" | "paused" | "n/a"; resolveMsLeft: number | null };

export function slaState(t: SlaClock, now: Date): SlaState {
  const band = (deadline: Date | null, doneAt: Date | null, total: number) => {
    if (!deadline) return "n/a" as const;
    if (doneAt) return doneAt <= deadline ? ("met" as const) : ("breached" as const);
    const left = deadline.getTime() - now.getTime();
    if (left < 0) return "breached" as const;
    return left < total * 0.25 ? ("warn" as const) : ("ok" as const);
  };
  const respondTotal = t.slaRespondBy ? t.slaRespondBy.getTime() - t.createdAt.getTime() : 1;
  const resolveBy = effectiveResolveBy(t, now);
  const resolveTotal = t.slaResolveBy ? t.slaResolveBy.getTime() - t.createdAt.getTime() : 1;
  const resolve = t.onHoldSince && !t.resolvedAt ? ("paused" as const) : band(resolveBy, t.resolvedAt, resolveTotal);
  return { respond: band(t.slaRespondBy, t.firstRespondedAt, respondTotal), resolve, resolveMsLeft: resolveBy && !t.resolvedAt ? resolveBy.getTime() - now.getTime() : null };
}

/** Five-minute cron: mark breaches once and email the agency. */
export async function checkSla(now = new Date()) {
  const open = await db().maintenanceTicket.findMany({
    where: { status: { in: ["NEW", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] }, OR: [{ respondBreached: false }, { resolveBreached: false }] },
    take: 1000,
  });
  let breaches = 0;
  for (const t of open) {
    const s = slaState(t, now);
    const respond = s.respond === "breached" && !t.respondBreached;
    const resolve = s.resolve === "breached" && !t.resolveBreached;
    if (!respond && !resolve) continue;
    breaches++;
    await tenantDb(t.agencyId).$transaction(async (tx) => {
      await tx.maintenanceTicket.update({ where: { id: t.id }, data: { respondBreached: t.respondBreached || respond, resolveBreached: t.resolveBreached || resolve, escalatedAt: t.escalatedAt ?? now } });
      await enqueueEmail(tx, t.agencyId, `mail:ticket:${t.id}:breach:${respond ? "respond" : "resolve"}`, { template: "ticket.escalation", to: { kind: "agency-staff", roles: ["owner", "admin"] }, params: { ticketId: t.id, kind: respond ? "respond" : "resolve" } });
      await audit({ agencyId: t.agencyId, actorType: "SYSTEM", action: "ticket.sla_breached", entity: "MaintenanceTicket", entityId: t.id, metadata: { respond, resolve } }, tx);
    });
  }
  return breaches;
}
