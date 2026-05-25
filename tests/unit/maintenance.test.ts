import { describe, expect, it } from "vitest";
import { matchSafetyRule, ACCOMMODATION_RE } from "@/server/domain/maintenance/rules";
import { canTransition, nextStatuses } from "@/server/domain/maintenance/stateMachine";
import { effectiveResolveBy, slaState } from "@/server/domain/maintenance/sla";
import { offlineTriage } from "@/server/ai/offline";

describe("safety rules", () => {
  it.each([
    ["I smell gas in the kitchen", "gas"],
    ["CO alarm keeps going off", "co"],
    ["water pouring from the ceiling, flooding the bathroom", "flood"],
    ["outlet is sparking", "sparking"],
    ["Smoke coming from the dryer", "fire"],
    ["locked out of my apartment", "lockout"],
  ])("%s -> %s", (text, id) => expect(matchSafetyRule(text, 7)?.id).toBe(id));

  it("no heat is an emergency only October through April", () => {
    expect(matchSafetyRule("no heat since last night", 1)?.id).toBe("no_heat");
    expect(matchSafetyRule("no heat since last night", 7)).toBeNull();
  });

  it("the classifier alone would call a gas smell NORMAL; the rule forces EMERGENCY", () => {
    expect(offlineTriage({ title: "Kitchen", redactedText: "I smell gas near the stove", month: 5 }).urgency).not.toBe("EMERGENCY");
    expect(matchSafetyRule("I smell gas near the stove", 5)).not.toBeNull();
  });

  it("flags possible accommodation requests", () => {
    expect(ACCOMMODATION_RE.test("Could you install grab bars in the shower?")).toBe(true);
    expect(ACCOMMODATION_RE.test("The shower drain is slow")).toBe(false);
  });
});

describe("ticket state machine", () => {
  it("allows the documented path and reopen", () => {
    const path = ["NEW", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1], path[i])).toBe(true);
    expect(canTransition("RESOLVED", "IN_PROGRESS")).toBe(true);
  });
  it("rejects skipping and cancel after work started", () => {
    expect(canTransition("NEW", "RESOLVED")).toBe(false);
    expect(canTransition("IN_PROGRESS", "CANCELED")).toBe(false);
    expect(nextStatuses("CANCELED")).toEqual([]);
  });
});

describe("SLA clock", () => {
  const created = new Date("2026-10-01T10:00:00Z");
  const base = { createdAt: created, slaRespondBy: new Date("2026-10-01T11:00:00Z"), slaResolveBy: new Date("2026-10-02T10:00:00Z"), firstRespondedAt: null, resolvedAt: null, onHoldSince: null, pausedMs: 0 };

  it("time on hold pushes the resolve deadline out", () => {
    const t = { ...base, pausedMs: 3 * 3_600_000 };
    expect(effectiveResolveBy(t, new Date("2026-10-02T09:00:00Z"))!.toISOString()).toBe("2026-10-02T13:00:00.000Z");
    const held = { ...base, onHoldSince: new Date("2026-10-01T12:00:00Z") };
    expect(slaState(held, new Date("2026-10-03T00:00:00Z")).resolve).toBe("paused");
    expect(effectiveResolveBy(held, new Date("2026-10-01T14:00:00Z"))!.toISOString()).toBe("2026-10-02T12:00:00.000Z");
  });

  it("goes ok -> warn -> breached, and met when done in time", () => {
    expect(slaState(base, new Date("2026-10-01T10:10:00Z")).respond).toBe("ok");
    expect(slaState(base, new Date("2026-10-01T10:50:00Z")).respond).toBe("warn");
    expect(slaState(base, new Date("2026-10-01T11:01:00Z")).respond).toBe("breached");
    expect(slaState({ ...base, firstRespondedAt: new Date("2026-10-01T10:30:00Z") }, new Date("2026-10-05T00:00:00Z")).respond).toBe("met");
  });
});
