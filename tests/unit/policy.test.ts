import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { AutomationConfig, decidePolicy, mayAutoExecute, type PolicyInput } from "@/server/domain/agent/policy";

const clean: PolicyInput = { outcome: "APPROVE", score: 92, flags: [], referencesComplete: true, identityVerified: true, creditBand: "EXCELLENT" };
const cfg = (level: "MANUAL" | "ASSISTED" | "AUTONOMOUS") => AutomationConfig.parse({ level });

describe("automation policy", () => {
  it("manual only suggests", () => expect(decidePolicy(cfg("MANUAL"), clean)).toEqual({ kind: "SUGGEST" }));
  it("assisted drafts for approval", () => expect(decidePolicy(cfg("ASSISTED"), clean)).toEqual({ kind: "DRAFT_FOR_APPROVAL" }));
  it("autonomous executes a clean approve above the threshold", () => expect(decidePolicy(cfg("AUTONOMOUS"), clean)).toEqual({ kind: "AUTO_EXECUTE" }));

  it("autonomous escalates below the auto-approve score, with flags, or with missing references", () => {
    expect(decidePolicy(cfg("AUTONOMOUS"), { ...clean, score: 80 })).toMatchObject({ kind: "ESCALATE", reasons: ["BELOW_AUTO_APPROVE_SCORE"] });
    expect(decidePolicy(cfg("AUTONOMOUS"), { ...clean, referencesComplete: false }).kind).toBe("ESCALATE");
    expect(decidePolicy(cfg("AUTONOMOUS"), { ...clean, creditBand: "FAIR" }).kind).toBe("ESCALATE");
    expect(decidePolicy(cfg("AUTONOMOUS"), { ...clean, outcome: "NEEDS_REVIEW", flags: ["THIN_FILE"] })).toEqual({ kind: "ESCALATE", reasons: ["THIN_FILE"] });
  });

  it("a decline is never automatic, in any mode, for any input", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("MANUAL", "ASSISTED", "AUTONOMOUS"),
        fc.integer({ min: 0, max: 100 }),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom("EXCELLENT", "GOOD", "FAIR", "POOR", "THIN_FILE"),
        fc.integer({ min: 0, max: 100 }),
        (level, score, refs, id, band, minScore) => {
          const a = decidePolicy(AutomationConfig.parse({ level, autoApproveMinScore: Math.max(75, minScore), allowedCreditBands: ["EXCELLENT", "GOOD", "FAIR", "POOR", "THIN_FILE"] }), { outcome: "DECLINE", score, flags: [], referencesComplete: refs, identityVerified: id, creditBand: band });
          expect(a.kind).not.toBe("AUTO_EXECUTE");
        },
      ),
    );
    expect(mayAutoExecute("DECLINE")).toBe(false);
    expect(mayAutoExecute("CONDITIONAL")).toBe(false);
  });
});
