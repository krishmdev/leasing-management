import { describe, expect, it } from "vitest";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { buildAdverseNotice } from "@/server/domain/screening/adverse";
import { AdverseActionDoc, type AdverseData } from "@/worker/documents/templates";
import { REASONS } from "@/server/domain/screening/rubric";

const report = (over: object = {}) => ({
  creditBand: "POOR", creditScore: 548, scoreModel: "VantageScore 4.0 (simulated)", scoreRangeMin: 300, scoreRangeMax: 850,
  keyFactors: ["Delinquent accounts", "High utilization", "Collection accounts", "Recent late payments", "Fifth factor"], scoreDate: new Date("2026-05-20T00:00:00Z"),
  ...over,
});

describe("adverse-action notice content", () => {
  it("a decline with a report discloses the CRA, and the credit values go only in the separate score block", () => {
    const { snapshot, score } = buildAdverseNotice({ kind: "DECLINE", reasons: [REASONS.credit, REASONS.income], report: report() });
    expect(snapshot).toMatchObject({ kind: "DECLINE", usedCra: true, hasScore: true, conditions: [] });
    expect(snapshot.cra.name).toBeTruthy();
    // the plain snapshot carries nothing from the report
    expect(JSON.stringify(snapshot)).not.toMatch(/548|Delinquent|VantageScore|2026-05-20/);
    expect(score).toEqual({ value: 548, band: "POOR", model: "VantageScore 4.0 (simulated)", range: [300, 850], keyFactors: ["Delinquent accounts", "High utilization", "Collection accounts", "Recent late payments"], date: "2026-05-20" });
  });

  it("a thin file has a band and no score", () => {
    const { score } = buildAdverseNotice({ kind: "DECLINE", reasons: [REASONS.credit], report: report({ creditBand: "THIN_FILE", creditScore: null, scoreModel: null, scoreRangeMin: null, scoreRangeMax: null, keyFactors: [] }) });
    expect(score).toMatchObject({ value: null, band: "THIN_FILE", keyFactors: [] });
  });

  it("a conditional approval lists its conditions", () => {
    const conditions = ["Qualified guarantor with income of at least 4x the monthly rent"];
    const { snapshot } = buildAdverseNotice({ kind: "CONDITIONAL", reasons: [REASONS.credit], conditions, report: report() });
    expect(snapshot).toMatchObject({ kind: "CONDITIONAL", conditions });
  });

  it("an income-only decline doesn't claim to rest on the report, even when one exists", () => {
    const { snapshot, score } = buildAdverseNotice({ kind: "DECLINE", reasons: [REASONS.income], report: report() });
    expect(snapshot).toMatchObject({ usedCra: false, hasScore: false });
    expect(score).toBeNull();
  });

  it("with no report and no CRA reason there is no CRA block", () => {
    const { snapshot, score } = buildAdverseNotice({ kind: "DECLINE", reasons: [REASONS.income], report: null });
    expect(snapshot).toMatchObject({ usedCra: false, hasScore: false });
    expect(score).toBeNull();
  });
});

describe("adverse-action PDF", () => {
  const baseMeta = {
    title: "Notice of adverse action",
    agencyName: "Bayview Properties",
    createdAt: new Date("2026-06-01T12:00:00Z"),
    docRef: "ADVERSE_ACTION · doc:app_1:ADVERSE_ACTION:adverseAction.v1",
  };

  it("renders a valid byte-identical PDF buffer for a scored declined applicant", async () => {
    const data: AdverseData = {
      meta: baseMeta,
      kind: "DECLINE",
      applicant: "Jane Doe",
      address: "100 Main St #4B, Oakland, CA 94612",
      reasons: [
        { text: REASONS.credit.text, basis: REASONS.credit.basis },
        { text: REASONS.income.text, basis: REASONS.income.basis },
      ],
      cra: {
        name: "MockCRA Consumer Reports (demo)",
        address: "100 Example Plaza, Suite 400, Sacramento, CA 95814",
        phone: "(800) 555-0100",
        website: "https://mockcra.invalid/consumers",
      },
      score: {
        value: 548,
        band: "POOR",
        model: "VantageScore 4.0",
        range: [300, 850],
        keyFactors: ["Delinquent accounts", "High utilization"],
        date: "2026-05-20",
      },
      thirdParty: false,
    };

    const docElement = React.createElement(AdverseActionDoc, { d: data }) as Parameters<typeof renderToBuffer>[0];
    const buf1 = await renderToBuffer(docElement);
    expect(Buffer.isBuffer(buf1)).toBe(true);
    expect(buf1.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf1.length).toBeGreaterThan(2000);

    // Byte-identical reproducibility check
    const buf2 = await renderToBuffer(React.createElement(AdverseActionDoc, { d: data }) as Parameters<typeof renderToBuffer>[0]);
    expect(buf1.equals(buf2)).toBe(true);
  });

  it("renders a valid PDF buffer for a thin-file applicant with thin-file disclosure", async () => {
    const data: AdverseData = {
      meta: baseMeta,
      kind: "DECLINE",
      applicant: "Alex Smith",
      address: "200 Pine St #1A, Berkeley, CA 94704",
      reasons: [{ text: REASONS.credit.text, basis: REASONS.credit.basis }],
      cra: {
        name: "MockCRA Consumer Reports (demo)",
        address: "100 Example Plaza, Suite 400, Sacramento, CA 95814",
        phone: "(800) 555-0100",
        website: "https://mockcra.invalid/consumers",
      },
      score: {
        value: null,
        band: "THIN_FILE",
        model: null,
        range: [null, null],
        keyFactors: [],
        date: "2026-05-22",
      },
      thirdParty: false,
    };

    const docElement = React.createElement(AdverseActionDoc, { d: data }) as Parameters<typeof renderToBuffer>[0];
    const buf = await renderToBuffer(docElement);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(2000);
  });

  it("renders a valid PDF buffer for conditional approval including specific conditions", async () => {
    const data: AdverseData = {
      meta: {
        ...baseMeta,
        title: "Notice of conditional approval",
      },
      kind: "CONDITIONAL",
      applicant: "Jordan Lee",
      address: "350 Grand Ave #202, Oakland, CA 94610",
      reasons: [{ text: REASONS.credit.text, basis: REASONS.credit.basis }],
      conditions: [
        "Qualified guarantor with monthly income of at least 4x monthly rent",
        "Additional security deposit equal to one month rent (subject to Cal. Civ. Code § 1950.5)",
      ],
      cra: {
        name: "MockCRA Consumer Reports (demo)",
        address: "100 Example Plaza, Suite 400, Sacramento, CA 95814",
        phone: "(800) 555-0100",
        website: "https://mockcra.invalid/consumers",
      },
      score: {
        value: 641,
        band: "FAIR",
        model: "VantageScore 4.0",
        range: [300, 850],
        keyFactors: ["High utilization"],
        date: "2026-05-24",
      },
      thirdParty: true,
    };

    const docElement = React.createElement(AdverseActionDoc, { d: data }) as Parameters<typeof renderToBuffer>[0];
    const buf = await renderToBuffer(docElement);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(2000);
  });
});
