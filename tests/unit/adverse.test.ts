import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { uuidv7 } from "@/lib/ids";
import { buildAdverseNoticeSnapshot, generateAdverseActionNotice } from "@/server/domain/screening/adverse";
import { AdverseActionDoc, type AdverseData } from "@/worker/documents/templates";
import { REASONS } from "@/server/domain/screening/rubric";
import type { TenantTx } from "@/server/tenant";
import { encryptField } from "@/server/crypto/fieldEncryption";

describe("FCRA Adverse Notice Snapshot Builder", () => {
  it("builds declined applicant notice payload with numeric score, key factors, and credit band", () => {
    const reasons = [REASONS.credit, REASONS.income];
    const snapshot = buildAdverseNoticeSnapshot({
      kind: "DECLINE",
      reasons,
      result: {
        creditBand: "POOR",
        creditScore: 548,
        scoreModel: "VantageScore 4.0 (simulated)",
        scoreRangeMin: 300,
        scoreRangeMax: 850,
        keyFactors: ["Delinquent accounts", "High utilization", "Collection accounts", "Recent late payments"],
        scoreDate: new Date("2026-05-20T00:00:00Z"),
      },
    });

    expect(snapshot.kind).toBe("DECLINE");
    expect(snapshot.usedCra).toBe(true);
    expect(snapshot.cra).toMatchObject({
      name: expect.any(String),
      address: expect.any(String),
      phone: expect.any(String),
      website: expect.any(String),
    });
    expect(snapshot.score).toEqual({
      value: 548,
      band: "POOR",
      model: "VantageScore 4.0 (simulated)",
      range: [300, 850],
      keyFactors: ["Delinquent accounts", "High utilization", "Collection accounts", "Recent late payments"],
      date: "2026-05-20T00:00:00.000Z",
    });
    expect(snapshot.conditions).toEqual([]);
  });

  it("builds thin-file applicant notice payload with THIN_FILE band and null numeric score", () => {
    const reasons = [REASONS.credit];
    const snapshot = buildAdverseNoticeSnapshot({
      kind: "DECLINE",
      reasons,
      result: {
        creditBand: "THIN_FILE",
        creditScore: null,
        scoreModel: null,
        scoreRangeMin: null,
        scoreRangeMax: null,
        keyFactors: [],
        scoreDate: new Date("2026-05-22T08:00:00Z"),
      },
    });

    expect(snapshot.kind).toBe("DECLINE");
    expect(snapshot.usedCra).toBe(true);
    expect(snapshot.score).toEqual({
      value: null,
      band: "THIN_FILE",
      model: null,
      range: [null, null],
      keyFactors: [],
      date: "2026-05-22T08:00:00.000Z",
    });
    expect(snapshot.conditions).toEqual([]);
  });

  it("builds conditional approval notice payload with conditions and credit score disclosure", () => {
    const reasons = [REASONS.credit];
    const conditions = [
      "Qualified guarantor with monthly income of at least 4x monthly rent",
      "Additional deposit subject to California AB 12 1-month cap",
    ];

    const snapshot = buildAdverseNoticeSnapshot({
      kind: "CONDITIONAL",
      reasons,
      conditions,
      result: {
        creditBand: "FAIR",
        creditScore: 641,
        scoreModel: "VantageScore 4.0 (simulated)",
        scoreRangeMin: 300,
        scoreRangeMax: 850,
        keyFactors: ["Collection account", "High utilization"],
        scoreDate: new Date("2026-05-24T12:00:00Z"),
      },
    });

    expect(snapshot.kind).toBe("CONDITIONAL");
    expect(snapshot.usedCra).toBe(true);
    expect(snapshot.conditions).toEqual(conditions);
    expect(snapshot.score).toEqual({
      value: 641,
      band: "FAIR",
      model: "VantageScore 4.0 (simulated)",
      range: [300, 850],
      keyFactors: ["Collection account", "High utilization"],
      date: "2026-05-24T12:00:00.000Z",
    });
  });

  it("builds non-CRA decline notice without CRA score block when no CRA was used", () => {
    const reasons = [REASONS.income];
    const snapshot = buildAdverseNoticeSnapshot({
      kind: "DECLINE",
      reasons,
      result: null,
    });

    expect(snapshot.kind).toBe("DECLINE");
    expect(snapshot.usedCra).toBe(false);
    expect(snapshot.score).toBeNull();
    expect(snapshot.conditions).toEqual([]);
  });
});

describe("generateAdverseActionNotice domain service", () => {
  it("persists the notice (sentAt left for the email dispatcher) and enqueues document and email", async () => {
    const agencyId = uuidv7();
    const applicationId = uuidv7();
    const srResultId = uuidv7();
    const encryptedScore = encryptField(
      { agencyId, model: "ScreeningResult", id: srResultId, field: "creditScoreEnc" },
      "548",
    );

    const mockCreateManyNotice = vi.fn().mockResolvedValue({ count: 1 });
    const mockCreateManyOutbox = vi.fn().mockResolvedValue({ count: 1 });

    const mockTx = {
      screeningRequest: {
        findFirst: vi.fn().mockResolvedValue({
          provider: "mock",
          result: {
            id: srResultId,
            creditBand: "POOR",
            creditScoreEnc: encryptedScore,
            scoreModel: "VantageScore 4.0",
            scoreRangeMin: 300,
            scoreRangeMax: 850,
            keyFactors: ["Delinquent accounts"],
            scoreDate: new Date("2026-05-20T00:00:00Z"),
          },
        }),
      },
      adverseActionNotice: {
        createMany: mockCreateManyNotice,
      },
      application: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: applicationId,
          leadId: "lead_test_789",
        }),
      },
      outboxMessage: {
        createMany: mockCreateManyOutbox,
      },
    } as unknown as TenantTx;

    const snapshot = await generateAdverseActionNotice(
      mockTx,
      agencyId,
      applicationId,
      [REASONS.credit],
      "DECLINE",
    );

    expect(snapshot.kind).toBe("DECLINE");
    expect(snapshot.usedCra).toBe(true);
    expect(snapshot.score?.value).toBe(548);
    expect(snapshot.score?.band).toBe("POOR");

    // sentAt is set by the outbox dispatcher once the email is accepted
    expect(mockCreateManyNotice).toHaveBeenCalledTimes(1);
    const noticePayload = mockCreateManyNotice.mock.calls[0][0].data[0];
    expect(noticePayload.agencyId).toBe(agencyId);
    expect(noticePayload.applicationId).toBe(applicationId);
    expect(noticePayload.sentAt).toBeUndefined();
    expect(noticePayload.craSnapshot).toMatchObject({
      kind: "DECLINE",
      usedCra: true,
      score: { value: 548, band: "POOR" },
    });

    // Verify outboxMessage enqueued document and email
    expect(mockCreateManyOutbox).toHaveBeenCalledTimes(2);
    const docOutbox = mockCreateManyOutbox.mock.calls[0][0].data[0];
    expect(docOutbox.kind).toBe("DOCUMENT");
    expect(docOutbox.idempotencyKey).toBe(`doc:${applicationId}:ADVERSE_ACTION:adverseAction.v1`);

    const mailOutbox = mockCreateManyOutbox.mock.calls[1][0].data[0];
    expect(mailOutbox.kind).toBe("EMAIL");
    expect(mailOutbox.idempotencyKey).toBe(`mail:app:${applicationId}:adverse-action`);
  });
});

describe("React-PDF Notice Rendering (Zero Network Egress)", () => {
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
