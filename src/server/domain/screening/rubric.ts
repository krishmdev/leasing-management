import type { CriteriaConfig } from "./criteria";
import type { ReferenceAnalysis, StructuredReference } from "@/server/ai/guardrails/dto";

export type CreditBand = "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "THIN_FILE";

/** Everything the rubric may look at. No names, no occupants, no pets, nothing protected. */
export interface RubricInput {
  monthlyIncomeCents: number;
  rentCents: number;
  hasRentSubsidy: boolean;
  subsidyMonthlyCents: number;
  altEvidenceProvided: boolean;
  screening: {
    creditBand: CreditBand;
    evictionJudgmentsInLookback: number;
    collectionsNonMedicalCount: number;
    collectionsNonMedicalCents: number;
    identityVerified: boolean;
    incomeVerified: boolean;
  };
  references: { expected: number; received: { structured: StructuredReference; text: ReferenceAnalysis | null }[] };
  llmGuardTripped: boolean;
}

export const ESCALATION_FLAGS = [
  "THIN_FILE", "SUBSIDY_ALT_EVIDENCE", "EVICTION_RECORD", "IDENTITY_UNVERIFIED", "DATA_CONFLICT", "REFERENCE_CONCERN", "LLM_GUARD_TRIPPED",
] as const;
export type Flag = (typeof ESCALATION_FLAGS)[number] | "INCOME_BELOW_MIN" | "NO_REFERENCES" | "REFERENCES_INCOMPLETE";

export type Basis = "CRA" | "THIRD_PARTY" | "APPLICANT_INFO";
export interface ReasonCode {
  code: string;
  factor: string;
  basis: Basis;
  pointsLost: number;
  text: string;
}

export interface Factor {
  factor: "income" | "credit" | "evictions" | "collections" | "references";
  points: number;
  max: number;
  detail: string;
}

export interface RubricResult {
  score: number;
  breakdown: Factor[];
  flags: Flag[];
  outcome: "APPROVE" | "CONDITIONAL" | "DECLINE" | "NEEDS_REVIEW";
  conditions: string[];
  reasonCodes: ReasonCode[];
  /** How many of the points came from LLM text scores. Bounded by weights.references * textShare. */
  llmPoints: number;
}

const REASONS: Record<Factor["factor"], { code: string; basis: Basis; text: string }> = {
  income: { code: "INSUFFICIENT_INCOME", basis: "APPLICANT_INFO", text: "Income is below the required multiple of your share of the rent" },
  credit: { code: "CREDIT_HISTORY", basis: "CRA", text: "Information in your credit report" },
  evictions: { code: "EVICTION_HISTORY", basis: "CRA", text: "Eviction judgment in the lookback period" },
  collections: { code: "COLLECTION_ACCOUNTS", basis: "CRA", text: "Non-medical collection accounts" },
  references: { code: "RENTAL_REFERENCES", basis: "THIRD_PARTY", text: "Information from prior landlord references" },
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function structuredScore(s: StructuredReference): number {
  const paid = { ALWAYS: 1, MOSTLY: 0.6, RARELY: 0 }[s.paidOnTime];
  const late = Math.max(0, 1 - s.lateCount / 6);
  const again = { YES: 1, MAYBE: 0.5, NO: 0 }[s.wouldRentAgain];
  const cond = (s.propertyCondition - 1) / 4;
  const comply = (s.leaseViolations ? 0 : 1) * 0.7 + (s.noticeGiven ? 0.3 : 0);
  return (paid + late + again + cond + comply) / 5;
}

export function textScore(a: ReferenceAnalysis): number {
  return (a.paymentReliability + a.propertyCare + a.leaseCompliance - 3) / 12;
}

/** Deterministic 100-point rubric. Pure: same input and criteria, same result. */
export function evaluateRubric(input: RubricInput, c: CriteriaConfig): RubricResult {
  const flags = new Set<Flag>();
  const w = c.weights;

  // Income against the tenant's portion (CA source-of-income: subsidy is subtracted first).
  const tenantRent = Math.max(1, input.rentCents - (input.hasRentSubsidy ? input.subsidyMonthlyCents : 0));
  const ratio = input.monthlyIncomeCents / tenantRent;
  const band = c.incomeBands.find((b) => ratio >= b.minRatio);
  const income: Factor = { factor: "income", points: band?.points ?? 0, max: w.income, detail: `${ratio.toFixed(2)}x tenant-portion rent` };
  if (!band) flags.add("INCOME_BELOW_MIN");

  // Credit. SB 267: a subsidized applicant who offers other evidence is judged on that instead.
  let credit: Factor;
  if (input.hasRentSubsidy && input.altEvidenceProvided) {
    credit = { factor: "credit", points: c.creditPoints.GOOD, max: w.credit, detail: "alternative evidence offered in place of credit (SB 267)" };
    flags.add("SUBSIDY_ALT_EVIDENCE");
  } else {
    const b = input.screening.creditBand;
    credit = { factor: "credit", points: c.creditPoints[b], max: w.credit, detail: b === "THIN_FILE" ? "no score (thin file), scored neutral" : `${b.toLowerCase()} band` };
    if (b === "THIN_FILE") flags.add("THIN_FILE");
  }

  const ev = input.screening.evictionJudgmentsInLookback;
  const evictions: Factor = { factor: "evictions", points: ev === 0 ? w.evictions : 0, max: w.evictions, detail: ev === 0 ? "none in lookback" : `${ev} in last ${c.evictionLookbackYears}y` };
  if (ev > 0) flags.add("EVICTION_RECORD");

  const cc = input.screening.collectionsNonMedicalCount;
  const cents = input.screening.collectionsNonMedicalCents;
  const colPts = cc === 0 ? c.collections.none : cents <= c.collections.smallMaxCents ? c.collections.small : c.collections.large;
  const collections: Factor = { factor: "collections", points: colPts, max: w.collections, detail: cc === 0 ? "none (medical excluded)" : `${cc} account(s), $${Math.round(cents / 100)}` };

  // References: structured answers carry 70%, the LLM's reading of the free text 30%.
  let refPts: number;
  let llmPoints = 0;
  const got = input.references.received;
  if (got.length === 0) {
    refPts = c.references.noneReceived;
    flags.add("NO_REFERENCES");
  } else {
    const per = got.map((r) => {
      const s = structuredScore(r.structured);
      const t = r.text ? textScore(r.text) : s; // no text: structured answers stand in for it
      if (r.text) llmPoints += (w.references * c.references.textShare * t) / got.length;
      if (r.structured.wouldRentAgain === "NO" || r.structured.leaseViolations || r.text?.redFlags.includes("EVICTION_NOTICE")) flags.add("REFERENCE_CONCERN");
      return c.references.structuredShare * s + c.references.textShare * t;
    });
    refPts = (w.references * per.reduce((a, b) => a + b, 0)) / per.length;
    if (got.length < input.references.expected) flags.add("REFERENCES_INCOMPLETE");
  }
  const references: Factor = { factor: "references", points: r1(refPts), max: w.references, detail: got.length ? `${got.length} of ${input.references.expected} received` : "none received" };

  if (!input.screening.identityVerified) flags.add("IDENTITY_UNVERIFIED");
  if (!input.screening.incomeVerified) flags.add("DATA_CONFLICT");
  if (input.llmGuardTripped) flags.add("LLM_GUARD_TRIPPED");

  const breakdown = [income, credit, evictions, collections, references];
  const score = Math.round(breakdown.reduce((s, f) => s + f.points, 0));
  const escalate = ESCALATION_FLAGS.some((f) => flags.has(f));
  const outcome: RubricResult["outcome"] = escalate ? "NEEDS_REVIEW" : score >= c.thresholds.approve ? "APPROVE" : score >= c.thresholds.conditional ? "CONDITIONAL" : "DECLINE";
  const conditions =
    outcome === "CONDITIONAL"
      ? ["Qualified guarantor with income of at least 4x the monthly rent", "Any added deposit must stay within the California AB 12 cap (one month's rent for most landlords)"]
      : [];
  const reasonCodes = breakdown
    .map((f) => ({ ...REASONS[f.factor], factor: f.factor, pointsLost: r1(f.max - f.points) }))
    .filter((r) => r.pointsLost > 0)
    .sort((a, b) => b.pointsLost - a.pointsLost)
    .slice(0, 4);
  return { score, breakdown, flags: [...flags].sort(), outcome, conditions, reasonCodes, llmPoints: r1(llmPoints) };
}
