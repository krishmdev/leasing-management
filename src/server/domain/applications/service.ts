import type { z } from "zod";
import { uuidv7 } from "@/lib/ids";
import { fields } from "@/server/crypto/fieldEncryption";
import { deriveToken, sha256Hex } from "@/server/crypto/tokens";
import { enqueueEmail } from "@/server/outbox/outbox";
import { audit } from "@/server/audit/audit";
import { tenantDb, type TenantTx } from "@/server/tenant";
import { sendInTx, Q } from "@/server/jobs/queues";
import { withTxRetry } from "@/server/txRetry";
import { advanceStage, ensureOpportunity, upsertLead } from "@/server/domain/leads/service";
import { activeCriteria } from "@/server/domain/screening/criteriaStore";
import { lockApplication, lockUnit } from "@/server/domain/locks";
import { CONSENT_TEXT, Step1, Step2, Step3, Step4, Step5 } from "./steps";

export class ApplicationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ApplicationError";
  }
}

export const REFERENCE_TTL_DAYS = 14;
export const REFERENCE_REMINDER_DAYS = [3, 7];

type RawTx = Parameters<typeof sendInTx>[0];

/** Starts (or resumes) a draft for a signed-in applicant. One live application per lead and unit. */
export async function startApplication(agencyId: string, unitId: string, user: { id: string; email: string; name: string }) {
  return tenantDb(agencyId).$transaction(async (tx) => {
    const unit = await tx.unit.findUnique({ where: { id: unitId } });
    if (!unit || unit.status === "OFF_MARKET" || unit.status === "LEASED") throw new ApplicationError("This home isn't taking applications", 409);
    const lead = await upsertLead(tx, agencyId, { name: user.name || user.email, email: user.email }, "application");
    await ensureOpportunity(tx, agencyId, lead.id, unitId);
    const existing = await tx.application.findFirst({ where: { leadId: lead.id, unitId, status: { not: "WITHDRAWN" } } });
    if (existing) {
      if (!existing.userId) await tx.application.update({ where: { id: existing.id }, data: { userId: user.id } });
      return existing;
    }
    const app = await tx.application.create({ data: { id: uuidv7(), agencyId, leadId: lead.id, unitId, userId: user.id } });
    await audit({ agencyId, actorType: "APPLICANT", actorId: user.id, action: "application.started", entity: "Application", entityId: app.id }, tx);
    return app;
  });
}

/** Applicant-facing load, checked against the signed-in user. */
export async function applicationForUser(agencyId: string, id: string, userId: string) {
  const app = await tenantDb(agencyId).application.findUnique({ where: { id }, include: { unit: { include: { property: true } }, residences: true, consents: true } });
  if (!app || app.userId !== userId) return null;
  return app;
}

export function decryptApplication(app: { id: string; agencyId: string; legalNameEnc: string | null; phoneEnc: string | null }) {
  const f = fields({ agencyId: app.agencyId, model: "Application", id: app.id });
  return { legalName: f.decOpt("legalNameEnc", app.legalNameEnc), phone: f.decOpt("phoneEnc", app.phoneEnc) };
}

export function decryptResidence(r: { id: string; agencyId: string; addressEnc: string | null; landlordNameEnc: string | null; landlordEmailEnc: string | null; landlordPhoneEnc: string | null }) {
  const f = fields({ agencyId: r.agencyId, model: "ResidenceHistory", id: r.id });
  return {
    address: f.decOpt("addressEnc", r.addressEnc),
    landlordName: f.decOpt("landlordNameEnc", r.landlordNameEnc),
    landlordEmail: f.decOpt("landlordEmailEnc", r.landlordEmailEnc),
    landlordPhone: f.decOpt("landlordPhoneEnc", r.landlordPhoneEnc),
  };
}

async function draftFor(tx: TenantTx, id: string, userId: string) {
  const app = await tx.application.findUnique({ where: { id } });
  if (!app || app.userId !== userId) throw new ApplicationError("Application not found", 404);
  if (app.status !== "DRAFT") throw new ApplicationError("This application was already submitted", 409);
  return app;
}

/** Autosave one step. Validation errors bubble up as zod errors for the form to show. */
export async function saveStep(agencyId: string, id: string, userId: string, step: number, input: unknown) {
  return tenantDb(agencyId).$transaction(async (tx) => {
    const app = await draftFor(tx, id, userId);
    const f = fields({ agencyId, model: "Application", id });
    if (step === 1) {
      const d = Step1.parse(input);
      await tx.application.update({
        where: { id },
        data: { legalNameEnc: f.enc("legalNameEnc", d.legalName), phoneEnc: f.enc("phoneEnc", d.phone), desiredMoveIn: d.desiredMoveIn, totalOccupants: d.totalOccupants },
      });
    } else if (step === 2) {
      const d = Step2.parse(input);
      await tx.residenceHistory.deleteMany({ where: { applicationId: id } });
      for (const r of d.residences) {
        const rid = uuidv7();
        const rf = fields({ agencyId, model: "ResidenceHistory", id: rid });
        await tx.residenceHistory.create({
          data: {
            id: rid, agencyId, applicationId: id,
            addressEnc: rf.enc("addressEnc", r.address),
            landlordNameEnc: rf.encOpt("landlordNameEnc", r.landlordName),
            landlordEmailEnc: rf.encOpt("landlordEmailEnc", r.landlordEmail),
            landlordPhoneEnc: rf.encOpt("landlordPhoneEnc", r.landlordPhone),
            startDate: r.startDate, endDate: r.endDate ?? null, monthlyRentCents: r.monthlyRent, consentToContact: r.consentToContact,
          },
        });
      }
    } else if (step === 3) {
      const d = Step3.parse(input);
      await tx.application.update({
        where: { id },
        data: { incomeType: d.incomeType, monthlyIncomeCents: d.monthlyIncome, hasRentSubsidy: d.hasRentSubsidy, subsidyMonthlyCents: d.hasRentSubsidy ? (d.subsidyMonthly ?? 0) : null, altEvidenceProvided: d.hasRentSubsidy && d.altEvidenceProvided },
      });
    } else if (step === 4) {
      Step4.parse(input);
    } else if (step !== 5) {
      throw new ApplicationError("Unknown step");
    }
    await tx.application.update({ where: { id }, data: { currentStep: Math.max(app.currentStep, Math.min(5, step + 1)) } });
  });
}

export type SubmitInput = z.input<typeof Step5> & { fcra: boolean; referenceContact: boolean };

/**
 * Submit: lock the criteria version, record consents, issue reference requests, and enqueue the
 * screening invite, all in one transaction, so a crash leaves either a draft or a fully
 * submitted application with its jobs queued.
 */
export async function submitApplication(agencyId: string, id: string, userId: string, input: SubmitInput, meta: { ip?: string | null; ua?: string | null } = {}) {
  Step5.parse(input);
  Step4.parse({ fcra: input.fcra });
  return withTxRetry(() =>
    tenantDb(agencyId).$transaction(async (tx) => {
      const pre = await tx.application.findUnique({ where: { id } });
      if (!pre || pre.userId !== userId) throw new ApplicationError("Application not found", 404);
      // May create criteria v1 and touch AgencySettings, which comes first in the lock order.
      const criteria = await activeCriteria(tx, agencyId);
      // Then Unit before Application.
      const unit = await lockUnit(tx, agencyId, pre.unitId);
      const app = await lockApplication(tx, agencyId, id);
      if (!app || !unit) throw new ApplicationError("Application not found", 404);
      if (app.status !== "DRAFT") return { id, alreadySubmitted: true };
      const full = await tx.application.findUniqueOrThrow({ where: { id }, include: { residences: true } });
      if (!full.legalNameEnc || !full.monthlyIncomeCents || !full.incomeType) throw new ApplicationError("Some steps are incomplete", 422);
      if (full.residences.length === 0) throw new ApplicationError("Add at least one place you've lived", 422);

      const now = new Date();
      const moved = await tx.application.updateMany({
        where: { id, status: "DRAFT" },
        data: { status: "REFERENCES_PENDING", criteriaVersionId: criteria.id, submittedAt: now, statusChangedAt: now, currentStep: 5 },
      });
      if (moved.count !== 1) return { id, alreadySubmitted: true };

      const types: (keyof typeof CONSENT_TEXT)[] = ["FCRA_AUTHORIZATION", "ESIGN", "PRIVACY", ...(input.referenceContact ? (["REFERENCE_CONTACT"] as const) : [])];
      const consents = types.map((type) => ({
        agencyId, applicationId: id, type, textVersion: CONSENT_TEXT[type].version, textSha256: sha256Hex(CONSENT_TEXT[type].text), ip: meta.ip ?? null, ua: meta.ua?.slice(0, 300) ?? null,
      }));
      await tx.consentRecord.createMany({ data: consents, skipDuplicates: true });

      let refCount = 0;
      if (input.referenceContact) {
        for (const r of full.residences.filter((x) => x.consentToContact && x.landlordEmailEnc)) {
          const reqId = uuidv7();
          await tx.referenceRequest.create({
            data: { id: reqId, agencyId, applicationId: id, residenceId: r.id, tokenHash: deriveToken("reference", reqId, 1).hash, expiresAt: new Date(now.getTime() + REFERENCE_TTL_DAYS * 86_400_000) },
          });
          await enqueueEmail(tx, agencyId, `mail:ref:${reqId}:request:1`, { template: "reference.request", to: { kind: "reference", id: reqId }, params: { referenceRequestId: reqId } });
          for (const d of REFERENCE_REMINDER_DAYS) {
            await enqueueEmail(tx, agencyId, `mail:ref:${reqId}:reminder:${d}`, { template: "reference.reminder", to: { kind: "reference", id: reqId }, params: { referenceRequestId: reqId } }, new Date(now.getTime() + d * 86_400_000));
          }
          refCount++;
        }
      }
      await enqueueEmail(tx, agencyId, `mail:app:${id}:submitted`, { template: "application.submitted", to: { kind: "lead", id: app.leadId }, params: { applicationId: id } });
      await advanceStage(tx, agencyId, app.leadId, app.unitId, "APPLIED", now);
      await sendInTx(tx as unknown as RawTx, Q.submitted, { agencyId, applicationId: id }, `submitted:${id}`);
      await audit({ agencyId, actorType: "APPLICANT", actorId: userId, action: "application.submitted", entity: "Application", entityId: id, metadata: { criteriaVersion: criteria.version, referenceCount: refCount } }, tx);
      return { id, alreadySubmitted: false };
    }),
  );
}

/**
 * Called whenever screening or a reference finishes. When the report is in and no reference is
 * still outstanding, move to SCREENED and queue the evaluation. Safe to call repeatedly: the
 * status change is a compare-and-set and the job has a singleton key.
 *
 * Callers lock the Application row first (see lockApplication). Two references finishing at
 * once, or the last reference racing the screening webhook, then run this one after the other,
 * and the second one sees the first one's committed row, so exactly one of them queues the
 * evaluation instead of each seeing the other as still pending.
 */
export async function maybeStartEvaluation(tx: TenantTx, agencyId: string, applicationId: string) {
  await lockApplication(tx, agencyId, applicationId);
  const app = await tx.application.findUnique({ where: { id: applicationId } });
  if (!app?.criteriaVersionId || !["REFERENCES_PENDING", "SCREENING"].includes(app.status)) return false;
  const sr = await tx.screeningRequest.findFirst({ where: { applicationId, criteriaVersionId: app.criteriaVersionId } });
  const pending = await tx.referenceRequest.count({ where: { applicationId, status: { in: ["SENT", "OPENED"] } } });
  if (sr?.status !== "COMPLETE") {
    if (pending === 0 && app.status === "REFERENCES_PENDING") {
      await tx.application.updateMany({ where: { id: applicationId, status: "REFERENCES_PENDING" }, data: { status: "SCREENING", statusChangedAt: new Date() } });
    }
    return false;
  }
  if (pending > 0) return false;
  const moved = await tx.application.updateMany({ where: { id: applicationId, status: { in: ["REFERENCES_PENDING", "SCREENING"] } }, data: { status: "SCREENED", statusChangedAt: new Date() } });
  if (moved.count !== 1) return false;
  await advanceStage(tx, agencyId, app.leadId, app.unitId, "SCREENED");
  await sendInTx(tx as unknown as RawTx, Q.evaluate, { agencyId, applicationId, criteriaVersionId: app.criteriaVersionId }, `evaluate:${applicationId}:${app.criteriaVersionId}`);
  return true;
}
