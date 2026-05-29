import { z } from "zod";
import { canonicalJson, sha256Hex } from "@/server/crypto/tokens";

/** Criteria are data, versioned per agency, and locked onto an application at submit. */
export const CriteriaConfig = z.object({
  version: z.number().int().positive(),
  weights: z.object({ income: z.literal(35), credit: z.literal(25), evictions: z.literal(15), collections: z.literal(10), references: z.literal(15) }),
  incomeBands: z.array(z.object({ minRatio: z.number(), points: z.number() })),
  creditPoints: z.object({ EXCELLENT: z.number(), GOOD: z.number(), FAIR: z.number(), POOR: z.number(), THIN_FILE: z.number() }),
  evictionLookbackYears: z.number().int(),
  collections: z.object({ none: z.number(), smallMaxCents: z.number(), small: z.number(), large: z.number() }),
  references: z.object({ structuredShare: z.number(), textShare: z.number(), noneReceived: z.number() }),
  thresholds: z.object({ approve: z.number(), conditional: z.number() }),
  jurisdictions: z.array(z.string()),
}).superRefine((c, ctx) => {
  // These are what make the stated bounds true for any criteria version, not just the default:
  // no factor can exceed its weight, and the model's share of the reference score stays <= 30%
  // (so at most 0.3 x 15 = 4.5 points).
  const bands = c.incomeBands;
  if (bands.some((b) => b.points > c.weights.income)) ctx.addIssue({ code: "custom", message: "income band points exceed the income weight" });
  if (bands.some((b, i) => i > 0 && b.minRatio >= bands[i - 1].minRatio)) ctx.addIssue({ code: "custom", message: "income bands must be in descending minRatio order" });
  if (Object.values(c.creditPoints).some((p) => p > c.weights.credit)) ctx.addIssue({ code: "custom", message: "credit points exceed the credit weight" });
  if (Math.max(c.collections.none, c.collections.small, c.collections.large) > c.weights.collections) ctx.addIssue({ code: "custom", message: "collections points exceed the weight" });
  if (c.references.noneReceived > c.weights.references) ctx.addIssue({ code: "custom", message: "references default exceeds the weight" });
  if (Math.abs(c.references.structuredShare + c.references.textShare - 1) > 1e-9) ctx.addIssue({ code: "custom", message: "reference shares must sum to 1" });
  if (c.references.textShare > 0.3) ctx.addIssue({ code: "custom", message: "the model's text share is capped at 0.3" });
});
export type CriteriaConfig = z.infer<typeof CriteriaConfig>;

export const DEFAULT_CRITERIA: CriteriaConfig = {
  version: 1,
  weights: { income: 35, credit: 25, evictions: 15, collections: 10, references: 15 },
  incomeBands: [
    { minRatio: 3.0, points: 35 },
    { minRatio: 2.5, points: 28 },
    { minRatio: 2.0, points: 18 },
  ],
  creditPoints: { EXCELLENT: 25, GOOD: 21, FAIR: 14, POOR: 5, THIN_FILE: 14 },
  evictionLookbackYears: 5,
  collections: { none: 10, smallMaxCents: 100_000, small: 6, large: 2 },
  references: { structuredShare: 0.7, textShare: 0.3, noneReceived: 8 },
  thresholds: { approve: 75, conditional: 60 },
  jurisdictions: ["ca"],
};

export function criteriaHash(c: CriteriaConfig) {
  return sha256Hex(canonicalJson(c));
}

export function criteriaFor(city: string | null | undefined): CriteriaConfig {
  const j = ["ca"];
  if (city?.toLowerCase() === "oakland") j.push("oakland");
  if (city?.toLowerCase() === "berkeley") j.push("berkeley");
  return { ...DEFAULT_CRITERIA, jurisdictions: j };
}
