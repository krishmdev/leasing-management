import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { evaluateRubric, type RubricInput } from "@/server/domain/screening/rubric";
import { DEFAULT_CRITERIA as C } from "@/server/domain/screening/criteria";
import { offlineAnalyzeReference } from "@/server/ai/offline";
import { redact } from "@/server/ai/guardrails/redact";

const goodRef = { paidOnTime: "ALWAYS", lateCount: 0, leaseViolations: false, noticeGiven: true, propertyCondition: 5, wouldRentAgain: "YES" } as const;
const text = (t: string) => offlineAnalyzeReference({ referenceId: "r", structured: goodRef, redactedText: redact(t).text, tenancyMonths: 24 });

function base(over: Partial<RubricInput> = {}, screening: Partial<RubricInput["screening"]> = {}): RubricInput {
  return {
    monthlyIncomeCents: 1_020_000,
    rentCents: 300_000,
    hasRentSubsidy: false,
    subsidyMonthlyCents: 0,
    altEvidenceProvided: false,
    screening: { creditBand: "EXCELLENT", evictionJudgmentsInLookback: 0, collectionsNonMedicalCount: 0, collectionsNonMedicalCents: 0, identityVerified: true, incomeVerified: true, ...screening },
    references: { expected: 1, received: [{ structured: goodRef, text: text("Always paid on time and left the unit spotless. Would recommend.") }] },
    llmGuardTripped: false,
    ...over,
  };
}

describe("rubric personas", () => {
  it("Maya: excellent credit, 3.4x, strong reference -> APPROVE", () => {
    const r = evaluateRubric(base(), C);
    expect(r.outcome).toBe("APPROVE");
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.flags).toEqual([]);
  });

  it("Jordan: fair credit, 2.6x, a small collection, lukewarm reference -> CONDITIONAL", () => {
    const lukewarm = { paidOnTime: "MOSTLY", lateCount: 3, leaseViolations: false, noticeGiven: true, propertyCondition: 3, wouldRentAgain: "MAYBE" } as const;
    const r = evaluateRubric(
      base({ monthlyIncomeCents: 780_000, references: { expected: 1, received: [{ structured: lukewarm, text: text("Paid late a few times but caught up.") }] } }, { creditBand: "FAIR", collectionsNonMedicalCount: 1, collectionsNonMedicalCents: 60_000 }),
      C,
    );
    expect(r.outcome).toBe("CONDITIONAL");
    expect(r.conditions.length).toBeGreaterThan(0);
  });

  it("Sam: thin file with voucher and alt evidence -> NEEDS_REVIEW via SB 267 path", () => {
    const r = evaluateRubric(base({ monthlyIncomeCents: 250_000, hasRentSubsidy: true, subsidyMonthlyCents: 220_000, altEvidenceProvided: true }, { creditBand: "THIN_FILE" }), C);
    expect(r.outcome).toBe("NEEDS_REVIEW");
    expect(r.flags).toContain("SUBSIDY_ALT_EVIDENCE");
    // income is measured against the tenant portion ($800), not the full rent
    expect(r.breakdown.find((b) => b.factor === "income")!.points).toBe(35);
  });

  it("Taylor: eviction record -> NEEDS_REVIEW, never an automatic decline", () => {
    const r = evaluateRubric(base({}, { evictionJudgmentsInLookback: 1 }), C);
    expect(r.outcome).toBe("NEEDS_REVIEW");
    expect(r.flags).toContain("EVICTION_RECORD");
  });

  it("Alex: poor credit, 1.8x -> DECLINE with CRA and applicant-info reasons", () => {
    const r = evaluateRubric(base({ monthlyIncomeCents: 540_000 }, { creditBand: "POOR", collectionsNonMedicalCount: 2, collectionsNonMedicalCents: 240_000 }), C);
    expect(r.outcome).toBe("DECLINE");
    expect(r.flags).toContain("INCOME_BELOW_MIN");
    expect(r.reasonCodes[0]).toMatchObject({ code: "INSUFFICIENT_INCOME", basis: "APPLICANT_INFO" });
    expect(r.reasonCodes.map((x) => x.basis)).toContain("CRA");
  });

  it("no references -> 8 points and a flag", () => {
    const r = evaluateRubric(base({ references: { expected: 2, received: [] } }), C);
    expect(r.breakdown.find((b) => b.factor === "references")!.points).toBe(8);
    expect(r.flags).toContain("NO_REFERENCES");
  });
});

describe("thresholds", () => {
  it.each([
    [1_000_000, 35],
    [900_000, 35],
    [899_999, 28],
    [750_000, 28],
    [600_000, 18],
    [599_999, 0],
  ])("income %i against $3000 rent -> %i points", (income, pts) => {
    expect(evaluateRubric(base({ monthlyIncomeCents: income }), C).breakdown[0].points).toBe(pts);
  });

  it("collections bands", () => {
    const pts = (count: number, cents: number) => evaluateRubric(base({}, { collectionsNonMedicalCount: count, collectionsNonMedicalCents: cents }), C).breakdown[3].points;
    expect([pts(0, 0), pts(1, 100_000), pts(1, 100_001)]).toEqual([10, 6, 2]);
  });

  it("score 75 approves and 74 is conditional", () => {
    // income 28 + credit 21 + evictions 15 + collections 2 + references 15 = 81; tune references down
    const r = evaluateRubric(base({ monthlyIncomeCents: 800_000 }, { creditBand: "GOOD", collectionsNonMedicalCount: 1, collectionsNonMedicalCents: 200_000 }), C);
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.outcome).toBe("APPROVE");
  });
});

describe("bounded LLM influence", () => {
  it("the text analysis can move the score by at most 4.5 points", () => {
    const best = { paymentReliability: 5, propertyCare: 5, leaseCompliance: 5, redFlags: [], evidenceQuotes: [], confidence: 1 };
    const worst = { paymentReliability: 1, propertyCare: 1, leaseCompliance: 1, redFlags: [], evidenceQuotes: [], confidence: 1 };
    const hi = evaluateRubric(base({ references: { expected: 1, received: [{ structured: goodRef, text: best }] } }), C);
    const lo = evaluateRubric(base({ references: { expected: 1, received: [{ structured: goodRef, text: worst }] } }), C);
    const refDiff = hi.breakdown[4].points - lo.breakdown[4].points;
    expect(refDiff).toBeLessThanOrEqual(4.5);
    expect(refDiff).toBeGreaterThan(4);
    expect(hi.llmPoints).toBeLessThanOrEqual(4.5);
  });
});

describe("fairness invariance", () => {
  const names = fc.constantFrom("Maya Chen", "Jamal Washington", "Priya Raman", "José García", "Olga Petrova", "Nguyen Van An", "Fatima Al-Sayed");
  const protectedBits = fc.constantFrom(
    "They have two kids.", "She is pregnant.", "He uses a wheelchair.", "They go to church every Sunday.", "She pays with a Section 8 voucher.",
    "He's a veteran.", "They're a same-sex couple.", "She is from Mexico and speaks Spanish.", "He is retired.", "They are married.", "",
  );
  const pets = fc.constantFrom("", "They had a cat.", "Their dog was friendly.", "They kept two small fish.");

  it("names, occupants, pets and protected terms in reference text don't change the score or outcome", () => {
    const core = "Always paid rent on time. Left the unit clean. No complaints from neighbors.";
    const reference = base();
    const baseline = evaluateRubric(reference, C);
    fc.assert(
      fc.property(names, protectedBits, pets, fc.integer({ min: 1, max: 8 }), (name, prot, pet, occupants) => {
        const raw = `${name} rented from me for two years. ${prot} ${core} ${pet} ${occupants} people lived there.`;
        const analysis = offlineAnalyzeReference({ referenceId: "r", structured: goodRef, redactedText: redact(raw, { knownNames: [name] }).text, tenancyMonths: 24 });
        const withBaseText = offlineAnalyzeReference({ referenceId: "r", structured: goodRef, redactedText: redact(`rented from me for two years. ${core}`).text, tenancyMonths: 24 });
        expect({ ...analysis, evidenceQuotes: [] }).toEqual({ ...withBaseText, evidenceQuotes: [], confidence: analysis.confidence });
        const r = evaluateRubric({ ...reference, references: { expected: 1, received: [{ structured: goodRef, text: analysis }] } }, C);
        const r0 = evaluateRubric({ ...reference, references: { expected: 1, received: [{ structured: goodRef, text: withBaseText }] } }, C);
        expect(r.score).toBe(r0.score);
        expect(r.outcome).toBe(r0.outcome);
        expect(r.outcome).toBe(baseline.outcome);
      }),
      { numRuns: 300 },
    );
  });

  it("the rubric input type has no field for protected data", () => {
    const keys = Object.keys(base()).sort();
    expect(keys).toEqual(["altEvidenceProvided", "hasRentSubsidy", "llmGuardTripped", "monthlyIncomeCents", "references", "rentCents", "screening", "subsidyMonthlyCents"]);
  });
});

describe("criteria validation", () => {
  it("rejects versions that would break the stated bounds", async () => {
    const { CriteriaConfig } = await import("@/server/domain/screening/criteria");
    expect(CriteriaConfig.safeParse(C).success).toBe(true);
    expect(CriteriaConfig.safeParse({ ...C, references: { ...C.references, structuredShare: 0.5, textShare: 0.5 } }).success).toBe(false);
    expect(CriteriaConfig.safeParse({ ...C, incomeBands: [{ minRatio: 2, points: 18 }, { minRatio: 3, points: 35 }] }).success).toBe(false);
    expect(CriteriaConfig.safeParse({ ...C, creditPoints: { ...C.creditPoints, EXCELLENT: 40 } }).success).toBe(false);
  });
});
