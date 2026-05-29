import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { tenantDb } from "@/server/tenant";
import { audit } from "@/server/audit/audit";

export const RetentionConfig = z.object({ creditDataDays: z.number().int().min(1).default(120), declinedPiiDays: z.number().int().min(30).default(730) });

/**
 * Nightly retention (confirm periods with counsel; FTC Disposal Rule, 16 CFR 682).
 *  - creditDataDays after a decision: drop the credit score and key factors (the derived band
 *    stays, since the decision record refers to it).
 *  - declinedPiiDays after a decline or withdrawal: null every encrypted PII column for that
 *    applicant, delete reference free text, and drop their Better Auth user if they have no
 *    other applications or residencies. The decision, reason codes and notice hash remain as a
 *    tombstone.
 */
/**
 * A Better Auth user is shared across agencies, so whether it can go is a cross-tenant question
 * and is asked of the base client: no staff membership anywhere, no other unpurged application
 * anywhere, and no residency anywhere.
 */
async function userIsDisposable(userId: string, purgingApplicationId: string) {
  const [members, apps, residencies] = await Promise.all([
    db().member.count({ where: { userId } }),
    db().application.count({ where: { userId, purgedAt: null, id: { not: purgingApplicationId } } }),
    db().residency.count({ where: { residentUserId: userId } }),
  ]);
  return members === 0 && apps === 0 && residencies === 0;
}

export async function purgeExpired(opts: { dryRun: boolean; now?: Date; agencyId?: string }) {
  const now = opts.now ?? new Date();
  const agencies = await db().agencySettings.findMany({ where: opts.agencyId ? { agencyId: opts.agencyId } : {} });
  const report: Record<string, { credit: number; applicants: number; users: number }> = {};
  for (const s of agencies) {
    const cfg = RetentionConfig.parse(s.retention ?? {});
    const t = tenantDb(s.agencyId);
    const creditCutoff = new Date(now.getTime() - cfg.creditDataDays * 86_400_000);
    const piiCutoff = new Date(now.getTime() - cfg.declinedPiiDays * 86_400_000);
    // Credit detail goes creditDataDays after a decision, or after the application closed
    // (declined or withdrawn) whether or not a decision was ever recorded.
    const decided = await t.decision.findMany({ where: { createdAt: { lt: creditCutoff } }, select: { applicationId: true } });
    const closed = await t.application.findMany({ where: { status: { in: ["DECLINED", "WITHDRAWN"] }, statusChangedAt: { lt: creditCutoff } }, select: { id: true } });
    const ids = [...new Set([...decided.map((d) => d.applicationId), ...closed.map((c) => c.id)])];
    const creditRows = await t.screeningResult.findMany({ where: { purgedAt: null, request: { applicationId: { in: ids } } }, select: { id: true } });
    const stale = await t.application.findMany({ where: { purgedAt: null, status: { in: ["DECLINED", "WITHDRAWN"] }, statusChangedAt: { lt: piiCutoff } }, select: { id: true, leadId: true, userId: true } });
    let users = 0;
    if (!opts.dryRun) {
      await t.$transaction(async (tx) => {
        if (creditRows.length) {
          await tx.screeningResult.updateMany({ where: { id: { in: creditRows.map((c) => c.id) } }, data: { creditScoreEnc: null, keyFactors: [], scoreModel: null, scoreRangeMin: null, scoreRangeMax: null, purgedAt: now } });
        }
        for (const a of stale) {
          await tx.application.update({ where: { id: a.id }, data: { legalNameEnc: null, phoneEnc: null, monthlyIncomeCents: null, totalOccupants: null, purgedAt: now } });
          await tx.residenceHistory.updateMany({ where: { applicationId: a.id }, data: { addressEnc: null, landlordNameEnc: null, landlordEmailEnc: null, landlordPhoneEnc: null } });
          await tx.referenceResponse.updateMany({ where: { request: { applicationId: a.id } }, data: { freeTextEnc: null, aiAnalysis: Prisma.DbNull } });
          await tx.llmCall.updateMany({ where: { applicationId: a.id }, data: { redactedInputEnc: null } });
          const otherApps = await tx.application.count({ where: { leadId: a.leadId, id: { not: a.id }, purgedAt: null } });
          const residencies = await tx.residency.count({ where: { leadId: a.leadId } });
          if (otherApps === 0 && residencies === 0) {
            // Lead contact details go too; the row stays as a join target for the tombstone.
            await tx.lead.update({ where: { id: a.leadId }, data: { nameEnc: "", emailEnc: "", phoneEnc: null, emailBidx: `purged:${a.leadId}` } });
            if (a.userId && (await userIsDisposable(a.userId, a.id))) {
              await tx.session.deleteMany({ where: { userId: a.userId } });
              await tx.account.deleteMany({ where: { userId: a.userId } });
              const u = await tx.user.findUnique({ where: { id: a.userId } });
              if (u) {
                await tx.verification.deleteMany({ where: { identifier: { contains: u.email } } });
                await tx.user.delete({ where: { id: a.userId } });
                users++;
              }
            }
          }
        }
        await audit({ agencyId: s.agencyId, actorType: "SYSTEM", action: "pii.purged", entity: "Agency", entityId: s.agencyId, metadata: { creditCount: creditRows.length, applicantCount: stale.length, userCount: users } }, tx);
      });
    }
    report[s.agencyId] = { credit: creditRows.length, applicants: stale.length, users };
  }
  return report;
}
