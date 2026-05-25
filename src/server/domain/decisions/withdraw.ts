import { audit } from "@/server/audit/audit";
import { tenantDb } from "@/server/tenant";
import { withTxRetry } from "@/server/txRetry";
import { lockApplication, lockHoldForApplication, lockLease, lockUnit } from "@/server/domain/locks";
import { promoteHead } from "./holds";

const OPEN = ["DRAFT", "SUBMITTED", "REFERENCES_PENDING", "SCREENING", "SCREENED", "DECISION_PENDING", "APPROVED", "CONDITIONAL", "LEASE_SENT"];

/** Applicant withdraws. Frees their hold and passes the unit to the next person in line. */
export async function withdrawApplication(agencyId: string, applicationId: string, actor: { type: "APPLICANT" | "USER"; id: string | null }) {
  const t = tenantDb(agencyId);
  const pre = await t.application.findUnique({ where: { id: applicationId }, include: { lease: true } });
  if (!pre) return { status: "noop" as const };
  return withTxRetry(() =>
    t.$transaction(async (tx) => {
      const settings = await tx.agencySettings.findFirstOrThrow({});
      const unit = await lockUnit(tx, agencyId, pre.unitId);
      const app = await lockApplication(tx, agencyId, applicationId);
      if (!unit || !app || !OPEN.includes(app.status)) return { status: "noop" as const };
      if (pre.lease) await lockLease(tx, agencyId, pre.lease.id);
      const hold = await lockHoldForApplication(tx, agencyId, applicationId);
      await tx.application.update({ where: { id: applicationId }, data: { status: "WITHDRAWN", statusChangedAt: new Date() } });
      await tx.lease.updateMany({ where: { applicationId, status: { in: ["DRAFT", "SENT"] } }, data: { status: "VOID" } });
      if (hold && (hold.status === "ACTIVE" || hold.status === "WAITLISTED")) {
        await tx.unitHold.update({ where: { id: hold.id }, data: { status: "RELEASED" } });
        if (hold.status === "ACTIVE") {
          const promoted = await promoteHead(tx, agencyId, unit, settings.holdHours);
          if (!promoted) await tx.unit.updateMany({ where: { id: unit.id, status: "PENDING" }, data: { status: "AVAILABLE" } });
        }
      }
      await tx.approvalTask.updateMany({ where: { applicationId, status: "OPEN" }, data: { status: "DISMISSED", resolvedAt: new Date() } });
      await audit({ agencyId, actorType: actor.type, actorId: actor.id, action: "application.withdrawn", entity: "Application", entityId: applicationId }, tx);
      return { status: "withdrawn" as const };
    }),
  );
}
