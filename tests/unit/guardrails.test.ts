import { describe, expect, it } from "vitest";
import { redact, mentionsProtected, REDACTED } from "@/server/ai/guardrails/redact";
import { ReferenceDTO, RationaleDTO, TriageDTO, StructuredReference } from "@/server/ai/guardrails/dto";
import { templateRationale } from "@/server/ai/offline";

describe("redaction", () => {
  it("the seeded seventh applicant's reference text has exactly two redactions", () => {
    const r = redact("Great tenant for three years. They have two kids and go to church every Sunday. Always paid on time.");
    expect(r.count).toBe(2);
    expect(r.text).toContain(REDACTED);
    expect(r.text).not.toMatch(/kids|church/i);
  });

  it("removes emails, phones, titled names and known names", () => {
    const r = redact("Call Mrs. Alvarez at (510) 555-0199 or email maya.chen@example.com about Maya Chen.", { knownNames: ["Maya Chen"] });
    expect(r.text).not.toMatch(/Alvarez|555|example\.com|Maya|Chen/);
    expect(r.count).toBe(5);
  });

  it("catches multi-word protected phrases", () => {
    expect(redact("She has an emotional support animal and a Section 8 voucher.").text).not.toMatch(/support animal|section 8|voucher/i);
  });

  it("output guard spots protected terms in model output", () => {
    expect(mentionsProtected("Approved; she is a single mother.")).toBe(true);
    expect(mentionsProtected("Approved: income 3.4x, clean payment history.")).toBe(false);
  });
});

describe("DTO allowlist", () => {
  it("key sets are exactly these (fails if someone adds a field)", () => {
    expect(Object.keys(ReferenceDTO.shape).sort()).toMatchInlineSnapshot(`
      [
        "redactedText",
        "referenceId",
        "structured",
        "tenancyMonths",
      ]
    `);
    expect(Object.keys(StructuredReference.shape).sort()).toMatchInlineSnapshot(`
      [
        "lateCount",
        "leaseViolations",
        "noticeGiven",
        "paidOnTime",
        "propertyCondition",
        "wouldRentAgain",
      ]
    `);
    expect(Object.keys(RationaleDTO.shape).sort()).toEqual(["breakdown", "conditions", "flags", "outcome", "score"]);
    expect(Object.keys(TriageDTO.shape).sort()).toEqual(["month", "redactedText", "title"]);
  });

  it("rejects objects with extra keys, like a database row", () => {
    const row = { referenceId: "r", structured: { paidOnTime: "ALWAYS", lateCount: 0, leaseViolations: false, noticeGiven: true, propertyCondition: 5, wouldRentAgain: "YES" }, redactedText: "", tenancyMonths: 12, landlordName: "Bob" };
    expect(ReferenceDTO.safeParse(row).success).toBe(false);
  });

  it("the template rationale never mentions protected terms", () => {
    const s = templateRationale({ outcome: "NEEDS_REVIEW", score: 70, breakdown: [{ factor: "credit", points: 14, max: 25, detail: "x" }], flags: ["THIN_FILE", "SUBSIDY_ALT_EVIDENCE"], conditions: [] }).summary;
    expect(mentionsProtected(s)).toBe(false);
  });
});
