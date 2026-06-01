import { describe, expect, it, vi } from "vitest";

// Every model call fails at the database/cache step, which is how an outage reaches the fallback.
vi.mock("@/server/tenant", () => ({ tenantDb: () => ({ llmCall: { findFirst: () => Promise.reject(new Error("model down")) } }) }));

describe("reference analysis fallback", () => {
  it("runs the output guard and drops evidence quotes, like the model path", async () => {
    const { analyzeReference } = await import("@/server/ai/provider");
    const r = await analyzeReference(
      { agencyId: "a", applicationId: null },
      {
        referenceId: "r1",
        structured: { paidOnTime: "ALWAYS", lateCount: 0, leaseViolations: false, noticeGiven: true, propertyCondition: 5, wouldRentAgain: "YES" },
        // Unredacted on purpose, to prove the guard runs on the fallback's quotes.
        redactedText: "Always paid on time. Her husband kept it clean.",
        tenancyMonths: 24,
      },
    );
    expect(r.fallback).toBe(true);
    expect(r.value.evidenceQuotes).toEqual([]);
    expect(r.guardTripped).toBe(true);
    expect(r.value.paymentReliability).toBeGreaterThan(3);
  });
});
