import type { Prisma } from "@/generated/prisma/client";
import { tenantRaw, type TenantTx } from "@/server/tenant";

/**
 * Row locks, always taken in this order within one transaction:
 *
 *   AgencySettings -> Unit -> Application -> Lease -> UnitHold
 *
 * Every path that touches holds, leases or decisions (decide, sign, sweep, withdraw, staff
 * listing toggles) follows it, which is what keeps them from deadlocking each other. Callers
 * that need a row's foreign keys to know what to lock read them unlocked first.
 */
type Raw = { $queryRaw: (sql: Prisma.Sql) => Promise<unknown>; $executeRaw: (sql: Prisma.Sql) => Promise<number> };
const raw = (tx: TenantTx, agencyId: string) => tenantRaw(agencyId, tx as unknown as Raw);

export interface LockedSettings { automation: unknown; automationPaused: boolean; timezone: string; holdHours: number }
export interface LockedUnit { id: string; status: "AVAILABLE" | "PENDING" | "LEASED" | "OFF_MARKET"; rentCents: number; depositCents: number; availableOn: Date }
export interface LockedApplication { id: string; status: string; unitId: string; leadId: string; criteriaVersionId: string | null; desiredMoveIn: Date | null }
export interface LockedLease { id: string; status: string; applicationId: string; unitId: string; signerId: string; signTokenExpiresAt: Date; startDate: Date; endDate: Date }
export interface LockedHold { id: string; status: string; unitId: string; applicationId: string; startsAt: Date | null; expiresAt: Date | null; live: boolean }

export async function lockSettings(tx: TenantTx, agencyId: string) {
  const r = await raw(tx, agencyId).query<LockedSettings[]>`
    SELECT automation, "automationPaused", timezone, "holdHours" FROM "AgencySettings" WHERE "agencyId" = ${agencyId} FOR UPDATE`;
  if (!r[0]) throw new Error("agency settings missing");
  return r[0];
}

export async function lockUnit(tx: TenantTx, agencyId: string, unitId: string, opts: { skipLocked?: boolean } = {}) {
  const r = opts.skipLocked
    ? await raw(tx, agencyId).query<LockedUnit[]>`
        SELECT id, status, "rentCents", "depositCents", "availableOn" FROM "Unit" WHERE "agencyId" = ${agencyId} AND id = ${unitId} FOR UPDATE SKIP LOCKED`
    : await raw(tx, agencyId).query<LockedUnit[]>`
        SELECT id, status, "rentCents", "depositCents", "availableOn" FROM "Unit" WHERE "agencyId" = ${agencyId} AND id = ${unitId} FOR UPDATE`;
  return r[0] ?? null;
}

export async function lockApplication(tx: TenantTx, agencyId: string, id: string) {
  const r = await raw(tx, agencyId).query<LockedApplication[]>`
    SELECT id, status::text AS status, "unitId", "leadId", "criteriaVersionId", "desiredMoveIn" FROM "Application" WHERE "agencyId" = ${agencyId} AND id = ${id} FOR UPDATE`;
  return r[0] ?? null;
}

export async function lockLease(tx: TenantTx, agencyId: string, id: string) {
  const r = await raw(tx, agencyId).query<LockedLease[]>`
    SELECT id, status::text AS status, "applicationId", "unitId", "signerId", "signTokenExpiresAt", "startDate", "endDate"
    FROM "Lease" WHERE "agencyId" = ${agencyId} AND id = ${id} FOR UPDATE`;
  return r[0] ?? null;
}

/** `live` is computed with clock_timestamp(), not now(): now() is frozen at transaction start. */
export async function lockHoldForApplication(tx: TenantTx, agencyId: string, applicationId: string) {
  const r = await raw(tx, agencyId).query<LockedHold[]>`
    SELECT id, status::text AS status, "unitId", "applicationId", "startsAt", "expiresAt",
           (status = 'ACTIVE' AND "startsAt" <= clock_timestamp() AND clock_timestamp() < "expiresAt") AS live
    FROM "UnitHold" WHERE "agencyId" = ${agencyId} AND "applicationId" = ${applicationId} FOR UPDATE`;
  return r[0] ?? null;
}

/** Flip ACTIVE holds whose window has passed on this unit. Call only while holding the Unit lock. */
export async function expireStaleHolds(tx: TenantTx, agencyId: string, unitId: string) {
  return raw(tx, agencyId).query<{ id: string; applicationId: string }[]>`
    UPDATE "UnitHold" SET status = 'EXPIRED', "updatedAt" = clock_timestamp()
    WHERE "agencyId" = ${agencyId} AND "unitId" = ${unitId} AND status = 'ACTIVE' AND "expiresAt" <= clock_timestamp()
    RETURNING id, "applicationId"`;
}

export async function dbNow(tx: TenantTx, agencyId: string): Promise<Date> {
  const r = await raw(tx, agencyId).query<{ now: Date }[]>`SELECT clock_timestamp() AS now FROM "AgencySettings" WHERE "agencyId" = ${agencyId}`;
  return r[0].now;
}
