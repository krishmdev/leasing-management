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

  it("catches plurals, possessives, demonyms, kinship words and stated ages that aren't spelled that way in the lexicon", () => {
    const cases = [
      "Both veterans", "Christians and Muslims", "immigrants", "Section 8 vouchers", "two wheelchairs", "the grandkids", "her boyfriends",
      "a Jew", "a nigerian family", "she is 72 years old", "a 68-year-old", "in her 60s", "his daughters", "our families'", "my mom's place",
      "refugees", "sixty-something",
    ];
    for (const c of cases) {
      const r = redact(`Tenant note: ${c}. Paid on time.`);
      expect(r.count, c).toBeGreaterThan(0);
      expect(mentionsProtected(`Output mentions ${c}`), c).toBe(true);
    }
    // and leaves ordinary rental language alone
    expect(redact("Paid rent on time, kept the unit clean, gave 30 days notice. Parking spot 2B.").count).toBe(0);
  });

  it("drops the modifier with the redacted word, so 'her late husband' leaves no 'late'", () => {
    const r = redact("Her late husband passed away. Her dear elderly mother visits.");
    expect(r.text).not.toMatch(/\blate\b|\bdear\b|elderly/i);
    expect(redact("She is 72.").count).toBe(1);
    expect(redact("The unit is 850 sq ft and rent was 30 days late once.").count).toBe(0);
    for (const w of ["women", "men", "wives", "grandmother", "Mormon", "widower", "Sudanese", "PTSD", "bipolar", "Ramadan", "hijab", "atheist", "stepmother", "mother-in-law"]) {
      expect(redact(`note: ${w}.`).count, w).toBeGreaterThan(0);
    }
  });

  it("redacts anything shaped like an SSN, and a stated date of birth", () => {
    for (const t of ["SSN 078-05-1120 on file", "ssn 078 05 1120", "her number is 078051120", "born on 04/12/1990", "DOB: 1990-04-12"]) {
      const r = redact(t);
      expect(r.text, t).not.toMatch(/078|1120|1990/);
    }
  });

  it("covers -ys plurals, accented names, and the wider lexicon", () => {
    for (const w of ["the boys", "two guys", "the gays", "her service dog", "a caregiver", "a senior", "on Medicaid", "Medi-Cal", "SNAP", "EBT card", "social security",
      "speaks Spanish", "Mandarin", "Arabic", "Hebrew", "an interpreter", "at Christmas", "for Eid", "Passover", "her pastor", "the rabbi", "an imam", "Air Force", "National Guard",
      "daycare", "a stroller", "her hubby", "domestic violence", "a restraining order", "was homeless", "a shelter", "autistic", "mental health"]) {
      expect(redact(w).text, w).toContain(REDACTED);
    }
    const r = redact("José paid on time and Zoë kept it clean.", { knownNames: ["José Ruiz", "Zoë Park"] });
    expect(r.text).not.toMatch(/Jos|Zo/);
    expect(r.count).toBe(2);
  });

  it("SSNs with dots or dashes, and dates of birth in several shapes", () => {
    for (const s of ["123.45.6789", "123–45–6789", "123 45 6789", "birthdate 1990-04-12", "12 April 1990", "April 12, 1990", "born in 1990 on April 12", "DOB: 04/12/1990"]) {
      const r = redact(`Note: ${s} thanks`);
      expect(r.text, s).not.toMatch(/1990|6789/);
    }
    expect(redact("Lease runs from March 1, 2025 to 02/28/2026.").text).toContain("2025");
  });

  it("offline scoring needs whole words: McLean, Stainton and a capitalized name don't count", async () => {
    const { offlineAnalyzeReference } = await import("@/server/ai/offline");
    const base = offlineAnalyzeReference({ redactedText: "The tenant lived here two years.", relationship: "LANDLORD" } as never);
    const names = offlineAnalyzeReference({ redactedText: "The tenant lived at McLean Court near Stainton Road with Tidy Brooks for two years.", relationship: "LANDLORD" } as never);
    expect([names.paymentReliability, names.propertyCare, names.leaseCompliance]).toEqual([base.paymentReliability, base.propertyCare, base.leaseCompliance]);
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

describe("free-text inputs refuse SSNs", () => {
  it("interest message, reference text and ticket description", async () => {
    const { InterestInput } = await import("@/server/domain/leads/service");
    const { TicketInput } = await import("@/server/domain/maintenance/tickets");
    const ssn = "my ssn is 078-05-1120";
    expect(InterestInput.safeParse({ name: "Ann Lee", email: "a@b.co", desiredMoveIn: "2026-11-01", message: ssn }).success).toBe(false);
    expect(TicketInput.safeParse({ title: "Sink", description: ssn, permissionToEnter: false }).success).toBe(false);
    expect(InterestInput.safeParse({ name: "Ann Lee", email: "a@b.co", desiredMoveIn: "2026-11-01", message: "Is parking included?" }).success).toBe(true);
  });
});
