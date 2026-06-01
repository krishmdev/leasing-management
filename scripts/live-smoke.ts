// Small live check of the model path (not used by tests or the demo, which run offline).
//   GEMINI_API_KEY=... LLM_MODEL=gemini-3.5-flash-lite pnpm exec tsx scripts/live-smoke.ts
// Needs a seeded database. Writes results/live-smoke.json. If RUN_MANIFEST points at a
// manifest script, its JSON output is embedded.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) throw new Error("set GEMINI_API_KEY or OPENAI_API_KEY");
// .env normally pins the offline provider; this script is the one place that overrides it.
process.env.LLM_PROVIDER = process.env.GEMINI_API_KEY ? "gemini" : "openai";

const { db } = await import("@/server/db");
const { analyzeReference, writeRationale, triageTicket, providerConfig } = await import("@/server/ai/provider");
const { offlineAnalyzeReference, offlineTriage } = await import("@/server/ai/offline");
const { redact, mentionsProtected } = await import("@/server/ai/guardrails/redact");
const { evaluateRubric } = await import("@/server/domain/screening/rubric");
const { DEFAULT_CRITERIA } = await import("@/server/domain/screening/criteria");

const agency = await db().organization.findFirstOrThrow({ where: { slug: "bayview" } });
const structured = { paidOnTime: "ALWAYS", lateCount: 0, leaseViolations: false, noticeGiven: true, propertyCondition: 5, wouldRentAgain: "YES" } as const;
const REFS = [
  "Always paid on time and left the apartment spotless. I'd rent to her again.",
  "Paid late a few times last year and we had one noise complaint, but she caught up.",
  "Great tenant for three years. They have two kids and go to church every Sunday. Always paid on time and kept the unit clean.",
];
const TICKETS = [
  ["Kitchen sink", "Slow drip under the sink, small puddle in the cabinet."],
  ["Outlet", "The bedroom outlet stopped working, breaker looks fine."],
  ["Fridge", "Refrigerator is warm and food is spoiling."],
];
const base = { monthlyIncomeCents: 1_020_000, rentCents: 300_000, hasRentSubsidy: false, subsidyMonthlyCents: 0, altEvidenceProvided: false, llmGuardTripped: false,
  screening: { creditBand: "EXCELLENT", evictionJudgmentsInLookback: 0, collectionsNonMedicalCount: 0, collectionsNonMedicalCents: 0, identityVerified: true, incomeVerified: true } } as const;

const references = [];
for (const [i, text] of REFS.entries()) {
  const red = redact(text);
  const dto = { referenceId: `live-${i}`, structured, redactedText: red.text, tenancyMonths: 24 };
  const t0 = Date.now();
  const live = await analyzeReference({ agencyId: agency.id }, dto);
  const offline = offlineAnalyzeReference(dto);
  const score = (a: typeof offline) => evaluateRubric({ ...base, references: { expected: 1, received: [{ structured, text: a }] } }, DEFAULT_CRITERIA);
  references.push({
    redactions: red.count, latencyMs: Date.now() - t0, cached: live.cached, fallback: live.fallback, guardTripped: live.guardTripped,
    live: { paymentReliability: live.value.paymentReliability, propertyCare: live.value.propertyCare, leaseCompliance: live.value.leaseCompliance, redFlags: live.value.redFlags },
    offline: { paymentReliability: offline.paymentReliability, propertyCare: offline.propertyCare, leaseCompliance: offline.leaseCompliance, redFlags: offline.redFlags },
    rubricScoreLive: score(live.value).score, rubricScoreOffline: score(offline).score, llmPointsLive: score(live.value).llmPoints,
  });
}
const rationale = await writeRationale({ agencyId: agency.id }, { outcome: "CONDITIONAL", score: 71, breakdown: [{ factor: "income", points: 28, max: 35, detail: "2.60x" }, { factor: "credit", points: 14, max: 25, detail: "fair band" }], flags: [], conditions: ["Qualified guarantor"] });
const triage = [];
for (const [title, description] of TICKETS) {
  const dto = { title, redactedText: redact(description).text, month: 9 };
  triage.push({ title, live: await triageTicket({ agencyId: agency.id }, dto), offline: offlineTriage(dto) });
}
let manifest: unknown = null;
if (process.env.RUN_MANIFEST) {
  // Keep host facts; replace any scheduling details with a single flag.
  const m = JSON.parse(execFileSync(process.env.RUN_MANIFEST, [`model=${providerConfig().model}`, "task=live-smoke"], { encoding: "utf8" })) as Record<string, unknown>;
  const exclusive = m.exclusive_compute as { held?: boolean } | undefined;
  delete m.exclusive_compute;
  manifest = { ...m, exclusive_run: !!exclusive?.held };
}
const out = {
  recordedAt: new Date().toISOString(), provider: providerConfig(), references,
  rationale: { source: rationale.source, guardTripped: rationale.guardTripped, mentionsProtected: mentionsProtected(rationale.summary), chars: rationale.summary.length, text: rationale.summary },
  triage, manifest,
};
writeFileSync("results/live-smoke.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ references: references.map((r) => [r.rubricScoreLive, r.rubricScoreOffline, r.fallback]), rationale: out.rationale.source, triage: triage.map((t) => [t.live.category, t.live.urgency, t.live.source]) }));
await db().$disconnect();
