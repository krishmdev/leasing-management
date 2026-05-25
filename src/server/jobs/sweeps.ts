import { db } from "@/server/db";
import { tenantDb } from "@/server/tenant";
import { lockUnit } from "@/server/domain/locks";
import { sweepUnit } from "@/server/domain/decisions/holds";

/**
 * Units that need attention: an ACTIVE hold past its window, people waiting on a unit that has
 * no active hold, or people waiting on a unit that was just leased. Each unit is handled in its
 * own transaction and skipped if someone else (a signing, a decision) holds its lock right now;
 * the next sweep gets it.
 */
export async function sweepHolds() {
  const units = await db().$queryRaw<{ agencyId: string; unitId: string }[]>`
    SELECT DISTINCT h."agencyId", h."unitId" FROM "UnitHold" h JOIN "Unit" u ON u.id = h."unitId"
    WHERE (h.status = 'ACTIVE' AND h."expiresAt" <= clock_timestamp())
       OR (h.status = 'WAITLISTED' AND (u.status = 'LEASED' OR NOT EXISTS (
            SELECT 1 FROM "UnitHold" a WHERE a."unitId" = h."unitId" AND a.status = 'ACTIVE')))
    LIMIT 500`;
  let promoted = 0;
  let released = 0;
  for (const { agencyId, unitId } of units) {
    const r = await tenantDb(agencyId).$transaction(async (tx) => {
      const settings = await tx.agencySettings.findFirstOrThrow({});
      const unit = await lockUnit(tx, agencyId, unitId, { skipLocked: true });
      if (!unit) return null;
      return sweepUnit(tx, agencyId, unit, settings.holdHours);
    });
    promoted += r?.promoted ?? 0;
    released += r?.released ?? 0;
  }
  return { units: units.length, promoted, released };
}
