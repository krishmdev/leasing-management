import { describe, expect, it } from "vitest";
import { buildIcs } from "@/server/domain/showings/ics";

const base = {
  uid: "showing-0192@leasing.test",
  start: new Date("2026-10-05T16:00:00Z"),
  end: new Date("2026-10-05T16:30:00Z"),
  title: "Showing: The Alder 2B",
  location: "4701 Telegraph Ave, Oakland",
  description: "Meet Luis at the front gate.",
  organizer: { name: "Bayview", email: "leasing@bayview.test" },
  stamp: new Date("2026-10-01T12:00:00Z"),
};

describe("ics", () => {
  it("is deterministic: same showing state renders the same bytes", () => {
    const a = buildIcs({ ...base, sequence: 0, method: "REQUEST" });
    expect(buildIcs({ ...base, sequence: 0, method: "REQUEST" })).toBe(a);
    expect(a).toContain("DTSTAMP:20261001T120000Z");
  });

  it("has a stable UID, sequence and REQUEST method", () => {
    const v = buildIcs({ ...base, sequence: 0, method: "REQUEST" });
    expect(v).toContain("UID:showing-0192@leasing.test");
    expect(v).toContain("SEQUENCE:0");
    expect(v).toContain("METHOD:REQUEST");
    expect(v).toContain("DTSTART:20261005T160000Z");
  });

  it("a reschedule keeps the UID and bumps SEQUENCE", () => {
    const v = buildIcs({ ...base, start: new Date("2026-10-06T16:00:00Z"), end: new Date("2026-10-06T16:30:00Z"), sequence: 1, method: "REQUEST" });
    expect(v).toContain("UID:showing-0192@leasing.test");
    expect(v).toContain("SEQUENCE:1");
  });

  it("cancel uses METHOD:CANCEL and STATUS:CANCELLED", () => {
    const v = buildIcs({ ...base, sequence: 2, method: "CANCEL" });
    expect(v).toContain("METHOD:CANCEL");
    expect(v).toContain("STATUS:CANCELLED");
    expect(v).toContain("SEQUENCE:2");
  });
});
