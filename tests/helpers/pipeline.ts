import { uuidv7 } from "@/lib/ids";
import { db } from "@/server/db";
import { deriveToken } from "@/server/crypto/tokens";
import { startApplication, saveStep, submitApplication } from "@/server/domain/applications/service";
import { submitReference } from "@/server/domain/references/service";
import { runEvaluation, runSubmitted } from "@/server/agent/pipeline";
import { completeHostedFlow, signWebhook, type Persona } from "@/mock-cra/service";
import { handleScreeningWebhook } from "@/server/domain/screening/webhook";
import { drain } from "@/server/outbox/outbox";
import { composeEmail } from "@/server/email/compose";
import { renderDocument } from "@/worker/documents/render";
import { FakeIdempotentProvider } from "./fakeEmail";
import { makeAgency, makeUnit, makeUser } from "./db";

export async function agencyWith(level: "MANUAL" | "ASSISTED" | "AUTONOMOUS", opts: { cap?: number; paused?: boolean } = {}) {
  const a = await makeAgency(undefined, { automation: { level, autoApproveMinScore: 85, dailyCap: opts.cap ?? 5, allowedCreditBands: ["EXCELLENT", "GOOD"] }, paused: opts.paused });
  await db().agencySettings.update({ where: { agencyId: a.id }, data: { theme: THEME, contact: CONTACT, timezone: "America/Los_Angeles" } });
  const unit = await makeUnit(a.id);
  return { agency: a, unit };
}

export const THEME = { brand: "#123456", brandInk: "#fff", accent: "#f59e0b", paper: "#fff", ink: "#111", font: "fraunces", tagline: "t", heroLine: "h", about: "a" };
export const CONTACT = { phone: "(510) 555-0100", email: "office@test.test", office: "1 Main", hours: "9-5", license: "x" };

export interface ApplicantOpts {
  incomeCents?: number;
  referenceText?: string;
  withReference?: boolean;
  name?: string;
}

export async function submittedApplication(agencyId: string, unitId: string, o: ApplicantOpts = {}) {
  const email = `app-${uuidv7().slice(-10)}@example.com`;
  const user = await makeUser(email, o.name ?? "Maya Chen");
  const app = await startApplication(agencyId, unitId, { id: user.id, email, name: user.name });
  await saveStep(agencyId, app.id, user.id, 1, { legalName: o.name ?? "Maya Chen", phone: "510-555-0101", desiredMoveIn: "2026-11-01", totalOccupants: 2 });
  await saveStep(agencyId, app.id, user.id, 2, {
    residences: [{ address: "12 Oak St, Oakland", landlordName: "Pat Landlord", landlordEmail: o.withReference === false ? "" : `ll-${uuidv7().slice(-8)}@example.com`, startDate: "2023-01-01", endDate: "2026-05-01", monthlyRent: 2400, consentToContact: o.withReference !== false }],
  });
  await saveStep(agencyId, app.id, user.id, 3, { incomeType: "EMPLOYMENT", monthlyIncome: (o.incomeCents ?? 1_020_000) / 100, hasRentSubsidy: false, altEvidenceProvided: false });
  await submitApplication(agencyId, app.id, user.id, { fcra: true, referenceContact: o.withReference !== false, esign: true, privacy: true, accurate: true });
  return { applicationId: app.id, userId: user.id, email };
}

export async function answerReferences(applicationId: string, text = "Always paid on time. Left the place spotless. Would recommend.") {
  const reqs = await db().referenceRequest.findMany({ where: { applicationId } });
  for (const r of reqs) {
    await submitReference(deriveToken("reference", r.id, r.tokenVersion).token, {
      paidOnTime: "ALWAYS", lateCount: 0, leaseViolations: false, noticeGiven: true, propertyCondition: 5, wouldRentAgain: "YES", freeText: text, respondentRole: "OWNER", attestation: true,
    });
  }
}

export function webhookRequest(body: object) {
  const text = JSON.stringify(body);
  return new Request("http://localhost/api/webhooks/screening/mock", { method: "POST", headers: { "x-mockcra-signature": signWebhook(text) }, body: text });
}

export async function completeScreening(agencyId: string, applicationId: string, persona: Persona = "excellent") {
  await runSubmitted({ agencyId, applicationId });
  const sr = await db().screeningRequest.findFirstOrThrow({ where: { applicationId } });
  const { inv, eventId } = await completeHostedFlow(sr.providerApplicantRef!, persona);
  return handleScreeningWebhook("mock", webhookRequest({ id: eventId, type: "screening.completed", ref: inv.ref, reportId: inv.report_id }));
}

export async function evaluate(agencyId: string, applicationId: string) {
  const app = await db().application.findUniqueOrThrow({ where: { id: applicationId } });
  return runEvaluation({ agencyId, applicationId, criteriaVersionId: app.criteriaVersionId! });
}

/** Full pipeline to a recommendation. */
export async function throughEvaluation(agencyId: string, unitId: string, persona: Persona = "excellent", o: ApplicantOpts = {}) {
  const s = await submittedApplication(agencyId, unitId, o);
  if (o.withReference !== false) await answerReferences(s.applicationId, o.referenceText);
  await completeScreening(agencyId, s.applicationId, persona);
  const result = await evaluate(agencyId, s.applicationId);
  return { ...s, result };
}

export const mail = new FakeIdempotentProvider();
export const flushOutbox = () => drain({ transport: mail, compose: composeEmail, renderDocument, workerId: "test" }, { max: 50 });
