import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { tenantDb } from "@/server/tenant";
import { audit } from "@/server/audit/audit";
import { deleteObject, objectExists } from "@/server/storage";

export const RetentionConfig = z.object({ creditDataDays: z.number().int().min(1).default(120), declinedPiiDays: z.number().int().min(30).default(730) });

const RATIONALE_REMOVED = "Removed under the retention policy.";

/**
 * Nightly retention (confirm periods with counsel; FTC Disposal Rule, 16 CFR 682).
 *
 * creditDataDays after a decision, or after an application closed without one:
 *   the score, key factors, score model, range and date on ScreeningResult; the encrypted score
 *   block on the adverse-action notice; and the notice PDF (its sha256 row stays). The credit
 *   band and counts stay, since the decision record refers to them.
 *
 * declinedPiiDays after a decline or withdrawal:
 *   every encrypted PII column for the application, its residences, reference text and model
 *   analysis, prompt copies and model outputs, every agent step's input (the rubric input
 *   carries income and rent), the rationale text, interest messages, consent IP and user
 *   agent, and all of its PDFs. The rubric step's output keeps its derived line text (e.g.
 *   "3.10x tenant-portion rent") because the decision record shows it. The lead's contact fields go when the lead has no
 *   other live application or residency. What remains is the tombstone: status, decision,
 *   reason codes, notice record and document hashes.
 *
 * Better Auth users are shared across agencies, so they're handled in a second pass after every
 * agency has committed, with the base client: a user goes only when no agency has a membership,
 * an unpurged application or a residency for them.
 */
export async function purgeExpired(opts: { dryRun: boolean; now?: Date; agencyId?: string }) {
  const now = opts.now ?? new Date();
  const agencies = await db().agencySettings.findMany({ where: opts.agencyId ? { agencyId: opts.agencyId } : {} });
  const report: Record<string, { credit: number; applicants: number; error?: string }> = {};
  const candidateUsers = new Set<string>();
  const filesToDelete: string[] = [];

  for (const s of agencies) {
    try {
      const r = await purgeAgency(s.agencyId, RetentionConfig.parse(s.retention ?? {}), now, opts.dryRun);
      r.users.forEach((u) => candidateUsers.add(u));
      filesToDelete.push(...r.files);
      report[s.agencyId] = { credit: r.credit, applicants: r.applicants };
    } catch (e) {
      // One agency's failure doesn't stop the others; the next night retries it.
      console.error(`retention purge failed for ${s.agencyId}:`, e);
      report[s.agencyId] = { credit: 0, applicants: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (opts.dryRun) return { perAgency: report, usersDeleted: 0 };

  // Files go only after their rows are marked purged. A failed delete is logged; the sweep
  // below retries it on every run for any purged document whose file is still on disk.
  await Promise.all(filesToDelete.map((k) => deleteObject(k).catch((e) => console.error(`retention: failed to delete ${k}:`, e))));
  await sweepPurgedFiles(opts.agencyId);

  let usersDeleted = 0;
  for (const userId of candidateUsers) if (await deleteUserIfUnused(userId)) usersDeleted++;
  if (usersDeleted) await audit({ agencyId: null, actorType: "SYSTEM", action: "pii.users_deleted", entity: "User", metadata: { userCount: usersDeleted } });
  return { perAgency: report, usersDeleted };
}

async function purgeAgency(agencyId: string, cfg: z.infer<typeof RetentionConfig>, now: Date, dryRun: boolean) {
  const t = tenantDb(agencyId);
  const creditCutoff = new Date(now.getTime() - cfg.creditDataDays * 86_400_000);
  const piiCutoff = new Date(now.getTime() - cfg.declinedPiiDays * 86_400_000);

  const decided = await t.decision.findMany({ where: { createdAt: { lt: creditCutoff } }, select: { applicationId: true } });
  const closed = await t.application.findMany({ where: { status: { in: ["DECLINED", "WITHDRAWN"] }, statusChangedAt: { lt: creditCutoff } }, select: { id: true } });
  const creditApps = [...new Set([...decided.map((d) => d.applicationId), ...closed.map((c) => c.id)])];
  const creditRows = await t.screeningResult.findMany({ where: { purgedAt: null, request: { applicationId: { in: creditApps } } }, select: { id: true } });
  const creditNotices = await t.adverseActionNotice.findMany({ where: { applicationId: { in: creditApps }, craScoreEnc: { not: null } }, select: { applicationId: true } });
  const stale = await t.application.findMany({
    where: { purgedAt: null, status: { in: ["DECLINED", "WITHDRAWN"] }, statusChangedAt: { lt: piiCutoff } },
    select: { id: true, leadId: true, userId: true, unitId: true },
  });
  const staleIds = stale.map((a) => a.id);
  const docs = await t.generatedDocument.findMany({
    where: {
      purgedAt: null,
      OR: [{ applicationId: { in: staleIds } }, { applicationId: { in: creditNotices.map((n) => n.applicationId) }, kind: "ADVERSE_ACTION" }],
    },
    select: { id: true, storageKey: true },
  });
  const result = { credit: creditRows.length + creditNotices.length, applicants: stale.length, users: [] as string[], files: docs.map((d) => d.storageKey) };
  if (dryRun) return result;

  await t.$transaction(async (tx) => {
    if (creditRows.length) {
      await tx.screeningResult.updateMany({
        where: { id: { in: creditRows.map((c) => c.id) } },
        data: { creditScoreEnc: null, keyFactorsEnc: null, scoreModel: null, scoreRangeMin: null, scoreRangeMax: null, scoreDate: null, purgedAt: now },
      });
    }
    if (creditNotices.length) {
      await tx.adverseActionNotice.updateMany({ where: { applicationId: { in: creditNotices.map((n) => n.applicationId) } }, data: { craScoreEnc: null } });
    }
    if (docs.length) await tx.generatedDocument.updateMany({ where: { id: { in: docs.map((d) => d.id) } }, data: { purgedAt: now } });

    for (const a of stale) {
      await tx.application.update({ where: { id: a.id }, data: { legalNameEnc: null, phoneEnc: null, monthlyIncomeCents: null, totalOccupants: null, purgedAt: now } });
      await tx.residenceHistory.updateMany({ where: { applicationId: a.id }, data: { addressEnc: null, landlordNameEnc: null, landlordEmailEnc: null, landlordPhoneEnc: null } });
      await tx.referenceResponse.updateMany({ where: { request: { applicationId: a.id } }, data: { freeTextEnc: null, aiAnalysis: Prisma.DbNull } });
      await tx.llmCall.updateMany({ where: { applicationId: a.id }, data: { redactedInputEnc: null, output: {} } });
      // Step inputs can carry income and rent (rubric.evaluate) or reference text; outputs of the
      // steps that carried model output (reference analyses, the rationale) go too.
      await tx.agentStep.updateMany({ where: { applicationId: a.id }, data: { inputJson: Prisma.DbNull } });
      await tx.agentStep.updateMany({ where: { applicationId: a.id, stepName: { in: ["references.analyze", "rationale.generate"] } }, data: { outputJson: Prisma.DbNull } });
      await tx.recommendation.updateMany({ where: { applicationId: a.id }, data: { rationale: RATIONALE_REMOVED } });
      await tx.consentRecord.updateMany({ where: { applicationId: a.id }, data: { ip: null, ua: null } });
      const opp = await tx.opportunity.findUnique({ where: { leadId_unitId: { leadId: a.leadId, unitId: a.unitId } } });
      if (opp) {
        await tx.indicationOfInterest.updateMany({ where: { opportunityId: opp.id }, data: { messageEnc: null } });
        if (opp.stage !== "LOST") await tx.opportunity.update({ where: { id: opp.id }, data: { stage: "LOST", stageChangedAt: now, lostReason: "closed" } });
      }
      const otherApps = await tx.application.count({ where: { leadId: a.leadId, id: { not: a.id }, purgedAt: null } });
      const residencies = await tx.residency.count({ where: { leadId: a.leadId } });
      if (otherApps === 0 && residencies === 0) {
        await tx.lead.update({ where: { id: a.leadId }, data: { nameEnc: null, emailEnc: null, phoneEnc: null, emailBidx: `purged:${a.leadId}` } });
      }
      if (a.userId) result.users.push(a.userId);
    }
    await audit(
      { agencyId, actorType: "SYSTEM", action: "pii.purged", entity: "Agency", entityId: agencyId, metadata: { creditCount: result.credit, applicantCount: stale.length, documentCount: docs.length } },
      tx,
    );
  });
  return result;
}

/** Retry file deletes for purged documents whose file still exists. */
async function sweepPurgedFiles(agencyId?: string) {
  const purged = await db().generatedDocument.findMany({ where: { purgedAt: { not: null }, ...(agencyId ? { agencyId } : {}) }, select: { storageKey: true } });
  for (const d of purged) {
    if (!(await objectExists(d.storageKey))) continue;
    await deleteObject(d.storageKey).catch((e) => console.error(`retention: sweep failed to delete ${d.storageKey}:`, e));
  }
}

/** Magic-link verification rows keep the address in `value` as JSON; match it exactly. */
async function deleteUserIfUnused(userId: string) {
  const [members, apps, residencies] = await Promise.all([
    db().member.count({ where: { userId } }),
    db().application.count({ where: { userId, purgedAt: null } }),
    db().residency.count({ where: { residentUserId: userId } }),
  ]);
  if (members || apps || residencies) return false;
  const u = await db().user.findUnique({ where: { id: userId } });
  if (!u) return false;
  const email = u.email.toLowerCase();
  const candidates = await db().verification.findMany({ where: { value: { contains: email, mode: "insensitive" } }, select: { id: true, value: true } });
  const mine = candidates.filter((v) => {
    try {
      return String((JSON.parse(v.value) as { email?: string }).email ?? "").toLowerCase() === email;
    } catch {
      return false;
    }
  });
  await db().$transaction([
    db().verification.deleteMany({ where: { id: { in: mine.map((v) => v.id) } } }),
    db().session.deleteMany({ where: { userId } }),
    db().account.deleteMany({ where: { userId } }),
    db().user.delete({ where: { id: userId } }),
  ]);
  return true;
}
