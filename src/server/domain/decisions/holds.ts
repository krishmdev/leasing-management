import { addMonths, subDays } from "date-fns";
import { uuidv7 } from "@/lib/ids";
import { deriveToken } from "@/server/crypto/tokens";
import { enqueueDocument, enqueueEmail } from "@/server/outbox/outbox";
import { audit } from "@/server/audit/audit";
import type { TenantTx } from "@/server/tenant";
import { dbNow, expireStaleHolds, type LockedUnit } from "@/server/domain/locks";

export const LEASE_TEMPLATE = "lease.v1";
export const leaseDocKey = (applicationId: string) => `doc:${applicationId}:LEASE:${LEASE_TEMPLATE}`;

/**
 * Everything below assumes the caller holds the Unit row lock (locks.ts order). The unique
 * partial index allows one ACTIVE hold row per unit; the exclusion constraint is a second
 * backstop on the time ranges.
 */

async function onExpired(tx: TenantTx, agencyId: string, expired: { id: string; applicationId: string }[]) {
  for (const h of expired) {
    const voided = await tx.lease.updateMany({ where: { applicationId: h.applicationId, status: "SENT" }, data: { status: "VOID" } });
    if (voided.count) {
      await enqueueEmail(tx, agencyId, `mail:hold:${h.id}:expired`, { template: "hold.expired", to: { kind: "lead", id: (await tx.application.findUniqueOrThrow({ where: { id: h.applicationId } })).leadId }, params: { applicationId: h.applicationId } });
    }
    await audit({ agencyId, actorType: "SYSTEM", action: "hold.expired", entity: "UnitHold", entityId: h.id, metadata: { applicationId: h.applicationId } }, tx);
  }
}

async function unitIsFree(tx: TenantTx, unit: LockedUnit) {
  if (unit.status !== "AVAILABLE" && unit.status !== "PENDING") return false;
  const [active, occupied] = await Promise.all([
    tx.unitHold.count({ where: { unitId: unit.id, status: "ACTIVE" } }),
    tx.residency.count({ where: { unitId: unit.id, status: { in: ["FUTURE", "CURRENT", "NOTICE"] } } }),
  ]);
  return active === 0 && occupied === 0;
}

/** Turn a hold ACTIVE (from the DB clock) and send its lease. */
async function activate(tx: TenantTx, agencyId: string, unit: LockedUnit, holdId: string, applicationId: string, holdHours: number) {
  const now = await dbNow(tx, agencyId);
  const expiresAt = new Date(now.getTime() + holdHours * 3_600_000);
  await tx.unitHold.update({ where: { id: holdId }, data: { status: "ACTIVE", startsAt: now, expiresAt } });
  await tx.unit.updateMany({ where: { id: unit.id, status: "AVAILABLE" }, data: { status: "PENDING" } });
  await createLease(tx, agencyId, unit, applicationId, expiresAt);
  return expiresAt;
}

async function createLease(tx: TenantTx, agencyId: string, unit: LockedUnit, applicationId: string, expiresAt: Date) {
  const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
  const start = app.desiredMoveIn && app.desiredMoveIn > unit.availableOn ? app.desiredMoveIn : unit.availableOn;
  const existing = await tx.lease.findUnique({ where: { applicationId } });
  const id = existing?.id ?? uuidv7();
  const version = (existing?.tokenVersion ?? 0) + 1;
  const { hash } = deriveToken("lease", id, version);
  if (existing) {
    // A re-promoted applicant gets a fresh link; the old one stops working.
    await tx.lease.update({ where: { id }, data: { status: "SENT", signTokenHash: hash, tokenVersion: version, signTokenExpiresAt: expiresAt, sentAt: new Date() } });
  } else {
    await tx.lease.create({
      data: {
        id, agencyId, applicationId, unitId: unit.id, signerId: app.leadId, rentCents: unit.rentCents, depositCents: unit.depositCents,
        startDate: start, endDate: subDays(addMonths(start, 12), 1), status: "SENT", signTokenHash: hash, tokenVersion: version, signTokenExpiresAt: expiresAt, sentAt: new Date(),
      },
    });
  }
  await enqueueDocument(tx, agencyId, leaseDocKey(applicationId), { kind: "LEASE", templateVersion: LEASE_TEMPLATE, applicationId, leaseId: id });
  await enqueueEmail(tx, agencyId, `mail:lease:${id}:sent:${version}`, { template: "lease.sent", to: { kind: "lead", id: app.leadId }, params: { leaseId: id, applicationId } });
  await tx.application.updateMany({ where: { id: applicationId, status: { in: ["APPROVED", "CONDITIONAL"] } }, data: { status: "LEASE_SENT", statusChangedAt: new Date() } });
}

/**
 * Called from the decision transaction for an approval. FIFO: if anyone is already waiting, the
 * new approval joins the back of the queue and the head is promoted instead.
 */
export async function placeHold(tx: TenantTx, agencyId: string, unit: LockedUnit, applicationId: string, holdHours: number) {
  await onExpired(tx, agencyId, await expireStaleHolds(tx, agencyId, unit.id));
  const existing = await tx.unitHold.findUnique({ where: { applicationId } });
  if (existing) return { status: existing.status, holdId: existing.id };
  const hold = await tx.unitHold.create({ data: { agencyId, unitId: unit.id, applicationId, status: "WAITLISTED" } });
  const promoted = await promoteHead(tx, agencyId, unit, holdHours);
  return { status: promoted?.applicationId === applicationId ? ("ACTIVE" as const) : ("WAITLISTED" as const), holdId: hold.id, expiresAt: promoted?.expiresAt };
}

/** If the unit is free, make the oldest waiting hold ACTIVE. */
export async function promoteHead(tx: TenantTx, agencyId: string, unit: LockedUnit, holdHours: number) {
  if (!(await unitIsFree(tx, unit))) return null;
  const head = await tx.unitHold.findFirst({
    where: { unitId: unit.id, status: "WAITLISTED", application: { status: { in: ["APPROVED", "CONDITIONAL", "LEASE_SENT"] } } },
    orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
  });
  if (!head) return null;
  const expiresAt = await activate(tx, agencyId, unit, head.id, head.applicationId, holdHours);
  await audit({ agencyId, actorType: "SYSTEM", action: "hold.activated", entity: "UnitHold", entityId: head.id, metadata: { applicationId: head.applicationId } }, tx);
  return { applicationId: head.applicationId, expiresAt };
}

/** Sweeper body for one unit (caller has locked it with SKIP LOCKED). */
export async function sweepUnit(tx: TenantTx, agencyId: string, unit: LockedUnit, holdHours: number) {
  await onExpired(tx, agencyId, await expireStaleHolds(tx, agencyId, unit.id));
  if (unit.status === "LEASED") {
    // Someone signed. Tell everyone still waiting, and let them go.
    const waiting = await tx.unitHold.findMany({ where: { unitId: unit.id, status: "WAITLISTED" } });
    for (const h of waiting) {
      await tx.unitHold.update({ where: { id: h.id }, data: { status: "RELEASED" } });
      const app = await tx.application.findUniqueOrThrow({ where: { id: h.applicationId } });
      await enqueueEmail(tx, agencyId, `mail:hold:${h.id}:unit-leased`, { template: "hold.unit_leased", to: { kind: "lead", id: app.leadId }, params: { applicationId: h.applicationId } });
    }
    return { released: waiting.length, promoted: 0 };
  }
  const p = await promoteHead(tx, agencyId, unit, holdHours);
  if (!p && unit.status === "PENDING" && (await unitIsFree(tx, unit))) {
    await tx.unit.updateMany({ where: { id: unit.id, status: "PENDING" }, data: { status: "AVAILABLE" } });
  }
  return { released: 0, promoted: p ? 1 : 0 };
}
