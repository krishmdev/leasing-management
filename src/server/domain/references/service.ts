import { z } from "zod";
import { looksLikeSsn, NO_SSN_MESSAGE } from "@/lib/pii";
import { uuidv7 } from "@/lib/ids";
import { db } from "@/server/db";
import { fields } from "@/server/crypto/fieldEncryption";
import { hashToken } from "@/server/crypto/tokens";
import { audit } from "@/server/audit/audit";
import { tenantDb } from "@/server/tenant";
import { withTxRetry } from "@/server/txRetry";
import { StructuredReference } from "@/server/ai/guardrails/dto";
import { decryptApplication, decryptResidence, maybeStartEvaluation } from "@/server/domain/applications/service";
import { lockApplication } from "@/server/domain/locks";

export const ReferenceForm = StructuredReference.extend({
  lateCount: z.coerce.number().int().min(0).max(50),
  propertyCondition: z.coerce.number().int().min(1).max(5),
  leaseViolations: z.coerce.boolean(),
  noticeGiven: z.coerce.boolean(),
  freeText: z.string().trim().max(3000).refine((m) => !looksLikeSsn(m), NO_SSN_MESSAGE).optional().or(z.literal("")),
  respondentRole: z.enum(["OWNER", "PROPERTY_MANAGER", "OTHER"]),
  attestation: z.literal(true, { error: "Please confirm the information is accurate" }),
}).strict();

/** Token hashes are globally unique, so this lookup is the one place a reference is read unscoped. */
async function requestByToken(token: string) {
  return db().referenceRequest.findUnique({ where: { tokenHash: hashToken(token) } });
}

/** What the landlord sees: first name and last initial, the address, the dates. Nothing else. */
export async function referenceByToken(token: string) {
  const req = await requestByToken(token);
  if (!req) return null;
  const t = tenantDb(req.agencyId);
  const [app, res, org] = await Promise.all([
    t.application.findUniqueOrThrow({ where: { id: req.applicationId } }),
    t.residenceHistory.findUniqueOrThrow({ where: { id: req.residenceId } }),
    t.organization.findUniqueOrThrow({ where: { id: req.agencyId } }),
  ]);
  const name = decryptApplication(app).legalName ?? "";
  const [first, ...rest] = name.split(/\s+/);
  const expired = req.status === "EXPIRED" || req.expiresAt.getTime() < Date.now();
  if (req.status === "SENT" && !expired) await t.referenceRequest.updateMany({ where: { id: req.id, status: "SENT" }, data: { status: "OPENED" } });
  return {
    id: req.id,
    agencyName: org.name,
    agencySlug: org.slug,
    applicant: `${first} ${rest.length ? `${rest.at(-1)![0]}.` : ""}`.trim(),
    address: decryptResidence(res).address,
    startDate: res.startDate,
    endDate: res.endDate,
    status: expired && req.status !== "COMPLETED" ? ("EXPIRED" as const) : req.status,
  };
}

export class ReferenceClosed extends Error {
  constructor(reason: "COMPLETED" | "EXPIRED") {
    super(reason === "COMPLETED" ? "This reference was already submitted. Thank you." : "This reference link has expired.");
    this.name = "ReferenceClosed";
  }
}

export async function submitReference(token: string, input: z.input<typeof ReferenceForm>) {
  const d = ReferenceForm.parse(input);
  const req = await requestByToken(token);
  if (!req) throw new ReferenceClosed("EXPIRED");
  return withTxRetry(() =>
    tenantDb(req.agencyId).$transaction(async (tx) => {
      // Lock order: the application before its reference rows.
      await lockApplication(tx, req.agencyId, req.applicationId);
      // Single use: the status CAS lets exactly one submission through.
      const claimed = await tx.referenceRequest.updateMany({
        where: { id: req.id, status: { in: ["SENT", "OPENED"] }, expiresAt: { gt: new Date() } },
        data: { status: "COMPLETED", usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        const now = await tx.referenceRequest.findUniqueOrThrow({ where: { id: req.id } });
        throw new ReferenceClosed(now.status === "COMPLETED" ? "COMPLETED" : "EXPIRED");
      }
      const id = uuidv7();
      await tx.referenceResponse.create({
        data: {
          id, agencyId: req.agencyId, referenceRequestId: req.id,
          paidOnTime: d.paidOnTime, lateCount: d.lateCount, leaseViolations: d.leaseViolations, noticeGiven: d.noticeGiven,
          propertyCondition: d.propertyCondition, wouldRentAgain: d.wouldRentAgain,
          freeTextEnc: fields({ agencyId: req.agencyId, model: "ReferenceResponse", id }).encOpt("freeTextEnc", d.freeText),
          respondentRole: d.respondentRole, attestation: d.attestation,
        },
      });
      await audit({ agencyId: req.agencyId, actorType: "REFERENCE", action: "reference.completed", entity: "ReferenceRequest", entityId: req.id, metadata: { applicationId: req.applicationId } }, tx);
      await maybeStartEvaluation(tx, req.agencyId, req.applicationId);
      return { id };
    }),
  );
}

/** Hourly: close out references nobody answered, then let those applications move on. */
export async function expireReferences(now = new Date()) {
  const due = await db().referenceRequest.findMany({ where: { status: { in: ["SENT", "OPENED"] }, expiresAt: { lte: now } }, take: 200 });
  for (const r of due) {
    await tenantDb(r.agencyId).$transaction(async (tx) => {
      await lockApplication(tx, r.agencyId, r.applicationId);
      const n = await tx.referenceRequest.updateMany({ where: { id: r.id, status: { in: ["SENT", "OPENED"] } }, data: { status: "EXPIRED" } });
      if (n.count) await maybeStartEvaluation(tx, r.agencyId, r.applicationId);
    });
  }
  return due.length;
}

/**
 * Backstop for anything that slipped past the triggers above: applications whose report is in
 * and whose references are all answered or expired, but that never moved to SCREENED.
 */
export async function sweepStalledApplications() {
  const apps = await db().application.findMany({
    where: {
      status: { in: ["REFERENCES_PENDING", "SCREENING"] },
      screeningRequests: { some: { status: "COMPLETE" } },
      references: { none: { status: { in: ["SENT", "OPENED"] } } },
    },
    select: { id: true, agencyId: true },
    take: 200,
  });
  let started = 0;
  for (const a of apps) {
    if (await tenantDb(a.agencyId).$transaction((tx) => maybeStartEvaluation(tx, a.agencyId, a.id))) started++;
  }
  return started;
}
