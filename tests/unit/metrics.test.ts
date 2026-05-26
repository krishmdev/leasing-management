import { describe, expect, it } from "vitest";
import { funnelFrom, median, turnoverRate } from "@/server/domain/metrics/metrics";

const d = (day: number) => new Date(Date.UTC(2026, 4, day));

describe("metrics", () => {
  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("funnel counts later stages as having passed earlier ones and measures dwell time", () => {
    const f = funnelFrom([
      { opportunityId: "a", from: null, to: "INTEREST", at: d(1) },
      { opportunityId: "a", from: "INTEREST", to: "SHOWING", at: d(3) },
      { opportunityId: "a", from: "SHOWING", to: "APPLIED", at: d(4) },
      { opportunityId: "b", from: null, to: "INTEREST", at: d(1) },
      { opportunityId: "c", from: null, to: "INTEREST", at: d(2) },
      { opportunityId: "c", from: "INTEREST", to: "APPLIED", at: d(6) }, // skipped the showing
    ]);
    expect(f.map((x) => x.count)).toEqual([3, 2, 2, 0, 0, 0]);
    expect(f[1].conversion).toBeCloseTo(2 / 3);
    expect(f[0].medianDays).toBe(3); // a: 2 days, c: 4 days
    expect(f[1].medianDays).toBe(1);
  });

  it("turnover", () => {
    expect(turnoverRate(6, 30)).toBeCloseTo(0.2);
    expect(turnoverRate(0, 0)).toBe(0);
  });
});
