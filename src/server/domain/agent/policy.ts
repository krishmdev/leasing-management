import { z } from "zod";

export const AutomationConfig = z.object({
  level: z.enum(["MANUAL", "ASSISTED", "AUTONOMOUS"]),
  autoApproveMinScore: z.number().int().min(75).max(100).default(85),
  dailyCap: z.number().int().min(0).max(100).default(5),
  allowedCreditBands: z.array(z.enum(["EXCELLENT", "GOOD", "FAIR", "POOR", "THIN_FILE"])).default(["EXCELLENT", "GOOD"]),
});
export type AutomationConfig = z.infer<typeof AutomationConfig>;

export interface PolicyInput {
  outcome: "APPROVE" | "CONDITIONAL" | "DECLINE" | "NEEDS_REVIEW";
  score: number;
  flags: string[];
  referencesComplete: boolean;
  identityVerified: boolean;
  creditBand: string;
}

export type PolicyAction =
  | { kind: "SUGGEST" } // manual: recommendation + summary only
  | { kind: "DRAFT_FOR_APPROVAL" } // assisted, or anything autonomous won't execute
  | { kind: "AUTO_EXECUTE" }
  | { kind: "ESCALATE"; reasons: string[] };

/**
 * What the agent may do with a recommendation. The pure part of the policy: whether the daily
 * cap has room and whether automation is paused are checked again, atomically, at execution time
 * (decisions/decide.ts), because either can change between this call and the commit.
 */
export function decidePolicy(cfg: AutomationConfig, r: PolicyInput): PolicyAction {
  if (r.outcome === "NEEDS_REVIEW") return { kind: "ESCALATE", reasons: r.flags.length ? r.flags : ["NEEDS_REVIEW"] };
  if (cfg.level === "MANUAL") return { kind: "SUGGEST" };
  if (cfg.level === "ASSISTED") return { kind: "DRAFT_FOR_APPROVAL" };
  // Autonomous. Declines are never executed automatically, in any mode.
  const reasons: string[] = [];
  if (r.outcome !== "APPROVE") reasons.push(r.outcome === "DECLINE" ? "DECLINE_REQUIRES_HUMAN" : "CONDITIONAL_REQUIRES_HUMAN");
  if (r.score < cfg.autoApproveMinScore) reasons.push("BELOW_AUTO_APPROVE_SCORE");
  if (r.flags.length) reasons.push(...r.flags.map((f) => `FLAG_${f}`));
  if (!r.referencesComplete) reasons.push("REFERENCES_INCOMPLETE");
  if (!r.identityVerified) reasons.push("IDENTITY_UNVERIFIED");
  if (!cfg.allowedCreditBands.includes(r.creditBand as never)) reasons.push("CREDIT_BAND_NOT_ALLOWED");
  if (reasons.length) return r.outcome === "DECLINE" ? { kind: "DRAFT_FOR_APPROVAL" } : { kind: "ESCALATE", reasons };
  return { kind: "AUTO_EXECUTE" };
}

/** Outcomes a caller may execute without a person, whatever the mode. */
export function mayAutoExecute(outcome: PolicyInput["outcome"]) {
  return outcome === "APPROVE";
}
