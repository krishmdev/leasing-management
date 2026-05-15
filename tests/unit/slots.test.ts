import { describe, expect, it } from "vitest";
import { generateSlots, pickAgent, type Rule } from "@/server/domain/showings/slots";

const TZ = "America/Los_Angeles";
const rule = (over: Partial<Rule> = {}): Rule => ({ agentUserId: "a1", weekday: 0, startMin: 9 * 60, endMin: 12 * 60, slotMin: 30, bufferMin: 15, ...over });
const localHM = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

describe("generateSlots", () => {
  const base = { exceptions: [], busy: [], tz: TZ, now: new Date("2026-01-01T00:00:00Z") };

  it("expands a weekly rule into local-time slots", () => {
    const slots = generateSlots({ ...base, rules: [rule({ weekday: 1 })], from: new Date("2026-10-05T07:00:00Z"), to: new Date("2026-10-06T07:00:00Z") });
    expect(slots.map((s) => localHM(s.start))).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
    expect(slots[0].start.toISOString()).toBe("2026-10-05T16:00:00.000Z"); // PDT, UTC-7
  });

  it("keeps 9am local across spring-forward (Mar 8 2026)", () => {
    const slots = generateSlots({ ...base, rules: [rule({ weekday: 0 }), rule({ weekday: 6 })], from: new Date("2026-03-07T08:00:00Z"), to: new Date("2026-03-09T07:00:00Z") });
    const sat = slots.filter((s) => s.start.toISOString().startsWith("2026-03-07"));
    const sun = slots.filter((s) => s.start.toISOString().startsWith("2026-03-08"));
    expect(sat[0].start.toISOString()).toBe("2026-03-07T17:00:00.000Z"); // PST, UTC-8
    expect(sun[0].start.toISOString()).toBe("2026-03-08T16:00:00.000Z"); // PDT, UTC-7
    expect(sun).toHaveLength(6);
  });

  it("keeps 9am local across fall-back (Nov 1 2026)", () => {
    const slots = generateSlots({ ...base, rules: [rule({ weekday: 6 }), rule({ weekday: 0 })], from: new Date("2026-10-31T07:00:00Z"), to: new Date("2026-11-02T08:00:00Z") });
    expect(slots.find((s) => s.start.toISOString().startsWith("2026-10-31"))!.start.toISOString()).toBe("2026-10-31T16:00:00.000Z");
    expect(slots.find((s) => s.start.toISOString().startsWith("2026-11-01"))!.start.toISOString()).toBe("2026-11-01T17:00:00.000Z");
  });

  it("drops slots that fall in the spring-forward gap", () => {
    const slots = generateSlots({ ...base, rules: [rule({ weekday: 0, startMin: 60, endMin: 4 * 60, slotMin: 30 })], from: new Date("2026-03-08T08:00:00Z"), to: new Date("2026-03-09T08:00:00Z") });
    const labels = slots.map((s) => localHM(s.start));
    expect(labels).not.toContain("02:00");
    expect(labels).not.toContain("02:30");
    expect(labels).toEqual(["01:00", "01:30", "03:00", "03:30"]);
  });

  it("honors lead time", () => {
    const now = new Date("2026-10-05T16:10:00Z"); // 9:10 local
    const slots = generateSlots({ ...base, now, rules: [rule({ weekday: 1 })], from: new Date("2026-10-05T07:00:00Z"), to: new Date("2026-10-06T07:00:00Z") });
    expect(localHM(slots[0].start)).toBe("11:30"); // 9:10 + 120min = 11:10
  });

  it("removes slots within the buffer around existing showings", () => {
    const busy = [{ agentUserId: "a1", startsAt: new Date("2026-10-05T17:00:00Z"), endsAt: new Date("2026-10-05T17:30:00Z") }]; // 10:00–10:30
    const slots = generateSlots({ ...base, busy, rules: [rule({ weekday: 1 })], from: new Date("2026-10-05T07:00:00Z"), to: new Date("2026-10-06T07:00:00Z") });
    expect(slots.map((s) => localHM(s.start))).toEqual(["09:00", "11:00", "11:30"]);
  });

  it("removes slots overlapping an exception", () => {
    const exceptions = [{ agentUserId: "a1", startsAt: new Date("2026-10-05T16:00:00Z"), endsAt: new Date("2026-10-05T18:00:00Z") }];
    const slots = generateSlots({ ...base, exceptions, rules: [rule({ weekday: 1 })], from: new Date("2026-10-05T07:00:00Z"), to: new Date("2026-10-06T07:00:00Z") });
    expect(slots.map((s) => localHM(s.start))).toEqual(["11:00", "11:30"]);
  });

  it("merges agents who share a slot, and busy agents drop out individually", () => {
    const busy = [{ agentUserId: "a1", startsAt: new Date("2026-10-05T16:00:00Z"), endsAt: new Date("2026-10-05T16:30:00Z") }];
    const slots = generateSlots({ ...base, busy, rules: [rule({ weekday: 1 }), rule({ weekday: 1, agentUserId: "a2" })], from: new Date("2026-10-05T07:00:00Z"), to: new Date("2026-10-06T07:00:00Z") });
    expect(slots[0].agentIds).toEqual(["a2"]);
    expect(slots.at(-1)!.agentIds.sort()).toEqual(["a1", "a2"]);
  });
});

describe("pickAgent", () => {
  const slot = { start: new Date(), end: new Date(), agentIds: ["a1", "a2", "a3"] };
  it("prefers the listing agent", () => expect(pickAgent(slot, "a2", new Map([["a2", 9]]))).toBe("a2"));
  it("falls back to least loaded", () => expect(pickAgent(slot, "zz", new Map([["a1", 3], ["a2", 1], ["a3", 2]]))).toBe("a2"));
});
