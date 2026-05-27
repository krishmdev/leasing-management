import { uuidv7 } from "@/lib/ids";
import { db } from "@/server/db";
import { deriveToken } from "@/server/crypto/tokens";
import { saveStep, startApplication, submitApplication } from "@/server/domain/applications/service";
import { submitReference } from "@/server/domain/references/service";
import { runEvaluation, runSubmitted } from "@/server/agent/pipeline";
import { completeHostedFlow, signWebhook, type Persona } from "@/mock-cra/service";
import { handleScreeningWebhook } from "@/server/domain/screening/webhook";

export interface PersonaSpec {
  key: string;
  name: string;
  email: string;
  unitIndex: number;
  incomeMultiple: number;
  screening: Persona;
  subsidyCents?: number;
  altEvidence?: boolean;
  references: { text: string; answers?: Partial<RefAnswers> }[];
  answerReferences?: number; // how many of the references answer (default: all)
  skipScreening?: boolean;
}

interface RefAnswers {
  paidOnTime: "ALWAYS" | "MOSTLY" | "RARELY";
  lateCount: number;
  leaseViolations: boolean;
  noticeGiven: boolean;
  propertyCondition: number;
  wouldRentAgain: "YES" | "MAYBE" | "NO";
}
const GOOD: RefAnswers = { paidOnTime: "ALWAYS", lateCount: 0, leaseViolations: false, noticeGiven: true, propertyCondition: 5, wouldRentAgain: "YES" };

/** One applicant, start to recommendation, through the same services the app and worker use. */
export async function seedApplicant(agencyId: string, unit: { id: string; rentCents: number }, p: PersonaSpec) {
  const user = await db().user.upsert({ where: { email: p.email }, create: { id: uuidv7(), email: p.email, name: p.name, emailVerified: true }, update: {} });
  const app = await startApplication(agencyId, unit.id, { id: user.id, email: user.email, name: user.name });
  await saveStep(agencyId, app.id, user.id, 1, { legalName: p.name, phone: "510-555-0142", desiredMoveIn: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), totalOccupants: 2 });
  await saveStep(agencyId, app.id, user.id, 2, {
    residences: p.references.map((_, i) => ({
      address: `${120 + i * 17} ${["Grand Ave", "Piedmont Ave", "Shattuck Ave"][i % 3]}, Oakland`, landlordName: ["Kim Nakamura", "Oscar Diaz", "Lena Park"][i % 3],
      landlordEmail: `landlord.${p.key}.${i}@example.com`, startDate: `${2020 + i}-02-01`, endDate: i === 0 ? "2026-08-31" : `${2021 + i}-01-31`, monthlyRent: 2300, consentToContact: true,
    })),
  });
  const rentPortion = unit.rentCents - (p.subsidyCents ?? 0);
  await saveStep(agencyId, app.id, user.id, 3, {
    incomeType: "EMPLOYMENT", monthlyIncome: Math.round((rentPortion * p.incomeMultiple) / 100),
    hasRentSubsidy: !!p.subsidyCents, subsidyMonthly: p.subsidyCents ? p.subsidyCents / 100 : undefined, altEvidenceProvided: !!p.altEvidence,
  });
  await submitApplication(agencyId, app.id, user.id, { fcra: true, referenceContact: true, esign: true, privacy: true, accurate: true }, { ip: "127.0.0.1", ua: "seed" });

  const reqs = await db().referenceRequest.findMany({ where: { applicationId: app.id }, include: { residence: true }, orderBy: { residence: { startDate: "desc" } } });
  const answering = p.answerReferences ?? reqs.length;
  for (const [i, r] of reqs.entries()) {
    if (i >= answering) continue;
    const spec = p.references[i];
    await submitReference(deriveToken("reference", r.id, r.tokenVersion).token, { ...GOOD, ...spec.answers, freeText: spec.text, respondentRole: "OWNER", attestation: true });
  }
  await runSubmitted({ agencyId, applicationId: app.id });
  if (!p.skipScreening) {
    const sr = await db().screeningRequest.findFirstOrThrow({ where: { applicationId: app.id } });
    const { inv, eventId } = await completeHostedFlow(sr.providerApplicantRef!, p.screening);
    const body = JSON.stringify({ id: eventId, type: "screening.completed", ref: inv.ref, reportId: inv.report_id });
    await handleScreeningWebhook("mock", new Request("http://seed/api/webhooks/screening/mock", { method: "POST", headers: { "x-mockcra-signature": signWebhook(body) }, body }));
  }
  const fresh = await db().application.findUniqueOrThrow({ where: { id: app.id } });
  if (fresh.status === "SCREENED") await runEvaluation({ agencyId, applicationId: app.id, criteriaVersionId: fresh.criteriaVersionId! });
  return { applicationId: app.id, userId: user.id };
}

export const BAYVIEW_PERSONAS: PersonaSpec[] = [
  { key: "maya", name: "Maya Chen", email: "maya.chen@example.com", unitIndex: 0, incomeMultiple: 3.4, screening: "excellent", references: [{ text: "Maya always paid on time and left the apartment spotless. I'd happily rent to her again." }] },
  { key: "jordan", name: "Jordan Ellis", email: "jordan.ellis@example.com", unitIndex: 1, incomeMultiple: 2.6, screening: "fair", references: [{ text: "Paid late a few times but always caught up. Unit was in normal shape.", answers: { paidOnTime: "MOSTLY", lateCount: 3, propertyCondition: 3, wouldRentAgain: "MAYBE" } }] },
  { key: "sam", name: "Sam Okafor", email: "sam.okafor@example.com", unitIndex: 2, incomeMultiple: 3.1, screening: "thin", subsidyCents: 220_000, altEvidence: true, references: [{ text: "Reliable, quiet, no complaints. Rent came in on time every month." }] },
  { key: "taylor", name: "Taylor Brooks", email: "taylor.brooks@example.com", unitIndex: 3, incomeMultiple: 3.2, screening: "eviction", references: [{ text: "Tenant for one year. No issues I can recall." }] },
  { key: "alex", name: "Alex Moreno", email: "alex.moreno@example.com", unitIndex: 4, incomeMultiple: 1.8, screening: "poor", references: [{ text: "Was behind on rent several times and we set up a payment plan.", answers: { paidOnTime: "RARELY", lateCount: 7, propertyCondition: 3, wouldRentAgain: "MAYBE" } }] },
  { key: "priya", name: "Priya Shah", email: "priya.shah@example.com", unitIndex: 5, incomeMultiple: 3.3, screening: "good", references: [{ text: "Great tenant, took good care of the place." }, { text: "" }], answerReferences: 1 },
  { key: "morgan", name: "Morgan Lee", email: "morgan.lee@example.com", unitIndex: 6, incomeMultiple: 3.5, screening: "excellent", references: [{ text: "Great tenant for three years. They have two kids and go to church every Sunday. Always paid on time and kept the unit clean." }] },
];

export const PENINSULA_PERSONAS: PersonaSpec[] = [
  { key: "chris", name: "Chris Tanaka", email: "chris.tanaka@example.com", unitIndex: 0, incomeMultiple: 3.6, screening: "excellent", references: [{ text: "Paid on time every month, left it spotless, would recommend without hesitation." }] },
  { key: "robin", name: "Robin Alvarez", email: "robin.alvarez@example.com", unitIndex: 1, incomeMultiple: 3.2, screening: "thin", references: [{ text: "Some noise complaints from neighbors, otherwise fine.", answers: { wouldRentAgain: "MAYBE", propertyCondition: 4 } }] },
  { key: "dana", name: "Dana Whitfield", email: "dana.whitfield@example.com", unitIndex: 2, incomeMultiple: 3.8, screening: "excellent", references: [{ text: "Always on time, very tidy, a pleasure to rent to." }] },
];
