import { z } from "zod";

/**
 * The only shapes a prompt builder accepts. Strict objects: an unexpected key fails parsing,
 * so a Prisma row (or anything with a name, address, occupants, pets or employer on it) can't be
 * passed through by accident. tests/unit/guardrails.test.ts snapshots the key sets.
 */
export const StructuredReference = z
  .object({
    paidOnTime: z.enum(["ALWAYS", "MOSTLY", "RARELY"]),
    lateCount: z.number().int().min(0).max(50),
    leaseViolations: z.boolean(),
    noticeGiven: z.boolean(),
    propertyCondition: z.number().int().min(1).max(5),
    wouldRentAgain: z.enum(["YES", "MAYBE", "NO"]),
  })
  .strict();
export type StructuredReference = z.infer<typeof StructuredReference>;

export const ReferenceDTO = z
  .object({
    referenceId: z.string(),
    structured: StructuredReference,
    redactedText: z.string().max(4000),
    tenancyMonths: z.number().int().min(0).max(600),
  })
  .strict();
export type ReferenceDTO = z.infer<typeof ReferenceDTO>;

export const RED_FLAGS = ["LATE_PAYMENTS", "PROPERTY_DAMAGE", "LEASE_VIOLATION", "NOISE_COMPLAINTS", "UNPAID_BALANCE", "EVICTION_NOTICE"] as const;

export const ReferenceAnalysis = z
  .object({
    paymentReliability: z.number().int().min(1).max(5),
    propertyCare: z.number().int().min(1).max(5),
    leaseCompliance: z.number().int().min(1).max(5),
    redFlags: z.array(z.enum(RED_FLAGS)).max(6),
    evidenceQuotes: z.array(z.string().max(200)).max(3),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type ReferenceAnalysis = z.infer<typeof ReferenceAnalysis>;

export const RationaleDTO = z
  .object({
    outcome: z.enum(["APPROVE", "CONDITIONAL", "DECLINE", "NEEDS_REVIEW"]),
    score: z.number().int().min(0).max(100),
    breakdown: z.array(z.object({ factor: z.string(), points: z.number(), max: z.number(), detail: z.string() }).strict()),
    flags: z.array(z.string()),
    conditions: z.array(z.string()),
  })
  .strict();
export type RationaleDTO = z.infer<typeof RationaleDTO>;

export const Rationale = z.object({ summary: z.string().max(1200) }).strict();

export const TriageDTO = z.object({ title: z.string().max(200), redactedText: z.string().max(4000), month: z.number().int().min(1).max(12) }).strict();
export type TriageDTO = z.infer<typeof TriageDTO>;

export const TICKET_CATEGORIES = ["PLUMBING", "ELECTRICAL", "HVAC", "APPLIANCE", "PEST", "STRUCTURAL", "LOCKS_SECURITY", "OTHER"] as const;
export const URGENCIES = ["EMERGENCY", "HIGH", "NORMAL", "LOW"] as const;
export const TriageResult = z
  .object({ category: z.enum(TICKET_CATEGORIES), urgency: z.enum(URGENCIES), confidence: z.number().min(0).max(1) })
  .strict();
export type TriageResult = z.infer<typeof TriageResult>;
