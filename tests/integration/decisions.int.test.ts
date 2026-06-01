import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { faults } from "@/server/faults";
import { deriveToken } from "@/server/crypto/tokens";
import { executeDecision } from "@/server/domain/decisions/decide";
import { REASON_OPTIONS } from "@/server/domain/screening/rubric";
import { withdrawApplication } from "@/server/domain/decisions/withdraw";
import { signLease } from "@/server/domain/leases/sign";
import { sweepHolds } from "@/server/jobs/sweeps";
import { resetDb, makeUnit } from "../helpers/db";
import { agencyWith, answerReferences, completeScreening, evaluate, flushOutbox, submittedApplication, throughEvaluation } from "../helpers/pipeline";

beforeAll(async () => {
  await resetDb();
});
beforeEach(() => faults.reset());

/** Get an application to DECISION_PENDING with a clean APPROVE recommendation under MANUAL, then flip the agency to the level under test. */
async function pendingApproval(agencyId: string, unitId: string) {
  const s = await submittedApplication(agencyId, unitId);
  await answerReferences(s.applicationId);
  await completeScreening(agencyId, s.applicationId);
  return s;
}

const approve = (agencyId: string, applicationId: string, mode: "ASSISTED" | "AUTONOMOUS" = "ASSISTED") =>
  executeDecision(agencyId, applicationId, { outcome: "APPROVE", mode, decidedByType: mode === "AUTONOMOUS" ? "AGENT" : "USER", reasonCodes: [] });

async function leaseTokenFor(applicationId: string) {
  const l = await db().lease.findUniqueOrThrow({ where: { applicationId } });
  return { lease: l, token: deriveToken("lease", l.id, l.tokenVersion).token };
}

async function readyToSign(applicationId: string) {
  await flushOutbox(); // worker renders the LEASE document
  const { lease, token } = await leaseTokenFor(applicationId);
  const doc = await db().generatedDocument.findFirstOrThrow({ where: { applicationId, kind: "LEASE" } });
  return { lease, token, input: { typedName: "Maya Chen", docSha256: doc.sha256, consent: true as const } };
}

describe("autonomous cap and pause, checked at execution time", () => {
  it("N concurrent auto-approvals against a daily cap of k: exactly k execute, the rest escalate", async () => {
    const { agency } = await agencyWith("MANUAL", { cap: 3 });
    const apps = [];
    for (let i = 0; i < 7; i++) {
      const unit = await makeUnit(agency.id);
      const s = await pendingApproval(agency.id, unit.id);
      await evaluate(agency.id, s.applicationId); // MANUAL: stops at DECISION_PENDING
      apps.push(s.applicationId);
    }
    await db().agencySettings.update({ where: { agencyId: agency.id }, data: { automation: { level: "AUTONOMOUS", autoApproveMinScore: 85, dailyCap: 3, allowedCreditBands: ["EXCELLENT"] } } });
    const results = await Promise.all(apps.map((id) => approve(agency.id, id, "AUTONOMOUS")));
    expect(results.filter((r) => r.status === "executed")).toHaveLength(3);
    expect(results.filter((r) => r.status === "escalated" && r.reason === "DAILY_CAP_REACHED")).toHaveLength(4);
    expect(await db().decision.count({ where: { agencyId: agency.id } })).toBe(3);
    const quota = await db().automationQuota.findFirstOrThrow({ where: { agencyId: agency.id } });
    expect(quota).toMatchObject({ used: 3, cap: 3 });
  });

  it("the first autonomous approval of a day creates the quota row instead of escalating", async () => {
    const { agency, unit } = await agencyWith("AUTONOMOUS", { cap: 1 });
    const r = await throughEvaluation(agency.id, unit.id);
    expect(r.result.output).toMatchObject({ executed: "executed" });
  });

  it("pause toggled between recommendation and execution: escalates, no decision", async () => {
    const { agency, unit } = await agencyWith("AUTONOMOUS");
    const s = await pendingApproval(agency.id, unit.id);
    // Pause lands after the policy step decided AUTO_EXECUTE but before the decision tx runs.
    await db().agencySettings.update({ where: { agencyId: agency.id }, data: { automation: { level: "MANUAL" } } });
    await evaluate(agency.id, s.applicationId).catch(() => undefined);
    await db().agencySettings.update({ where: { agencyId: agency.id }, data: { automation: { level: "AUTONOMOUS", autoApproveMinScore: 85, dailyCap: 5, allowedCreditBands: ["EXCELLENT"] }, automationPaused: true } });
    const r = await approve(agency.id, s.applicationId, "AUTONOMOUS");
    expect(r).toEqual({ status: "escalated", reason: "AUTOMATION_PAUSED" });
    expect(await db().decision.count({ where: { applicationId: s.applicationId } })).toBe(0);
    expect(await db().approvalTask.count({ where: { applicationId: s.applicationId, type: "ESCALATION" } })).toBe(1);
  });

  it("a decline can never be executed autonomously", async () => {
    const { agency, unit } = await agencyWith("AUTONOMOUS");
    const s = await pendingApproval(agency.id, unit.id);
    await expect(executeDecision(agency.id, s.applicationId, { outcome: "DECLINE", mode: "AUTONOMOUS", decidedByType: "AGENT", reasonCodes: [] })).rejects.toThrow(/only a clean approval/);
  });

  it("a staff decline must list reasons, and a report-based reason brings the CRA block", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const s = await pendingApproval(agency.id, unit.id);
    await evaluate(agency.id, s.applicationId);
    await expect(executeDecision(agency.id, s.applicationId, { outcome: "DECLINE", mode: "MANUAL", decidedByType: "USER", reasonCodes: [], overrideReason: "x" })).rejects.toThrow(/at least one reason/);
    await executeDecision(agency.id, s.applicationId, { outcome: "DECLINE", mode: "MANUAL", decidedByType: "USER", reasonCodes: [REASON_OPTIONS.find((r) => r.factor === "credit")!], overrideReason: "credit concerns on review" });
    const n = await db().adverseActionNotice.findUniqueOrThrow({ where: { applicationId: s.applicationId } });
    expect(n.craSnapshot).toMatchObject({ kind: "DECLINE", usedCra: true, cra: { name: expect.any(String) } });
  });

  it("a conditional approval also sends an adverse-action notice", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const s = await pendingApproval(agency.id, unit.id);
    await evaluate(agency.id, s.applicationId);
    await executeDecision(agency.id, s.applicationId, { outcome: "CONDITIONAL", mode: "MANUAL", decidedByType: "USER", reasonCodes: [REASON_OPTIONS[1]], overrideReason: "guarantor required by owner" });
    const n = await db().adverseActionNotice.findUniqueOrThrow({ where: { applicationId: s.applicationId } });
    expect(n.craSnapshot).toMatchObject({ kind: "CONDITIONAL" });
    expect(await db().outboxMessage.count({ where: { idempotencyKey: `doc:${s.applicationId}:ADVERSE_ACTION:adverseAction.v1` } })).toBe(1);
  });

  it("overriding the recommendation needs a reason", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const s = await pendingApproval(agency.id, unit.id);
    await evaluate(agency.id, s.applicationId);
    await expect(executeDecision(agency.id, s.applicationId, { outcome: "DECLINE", mode: "MANUAL", decidedByType: "USER", reasonCodes: [REASON_OPTIONS[0]] })).rejects.toThrow(/requires a reason/);
    const r = await executeDecision(agency.id, s.applicationId, { outcome: "DECLINE", mode: "MANUAL", decidedByType: "USER", reasonCodes: [REASON_OPTIONS[1]], overrideReason: "applicant asked to withdraw by phone" });
    expect(r.status).toBe("executed");
    expect(await db().decision.findFirst({ where: { applicationId: s.applicationId } })).toMatchObject({ overrodeRecommendation: true });
  });
});

describe("unit holds and signing", () => {
  async function twoApproved() {
    const { agency, unit } = await agencyWith("MANUAL");
    const a = await pendingApproval(agency.id, unit.id);
    const b = await pendingApproval(agency.id, unit.id);
    await evaluate(agency.id, a.applicationId);
    await evaluate(agency.id, b.applicationId);
    expect((await approve(agency.id, a.applicationId)).status).toBe("executed");
    expect((await approve(agency.id, b.applicationId)).status).toBe("executed");
    return { agency, unit, a, b };
  }

  it("a second approval is waitlisted behind the first (FIFO), with one ACTIVE hold", async () => {
    const { unit, a, b } = await twoApproved();
    const holds = await db().unitHold.findMany({ where: { unitId: unit.id }, orderBy: { queuedAt: "asc" } });
    expect(holds.map((h) => [h.applicationId, h.status])).toEqual([[a.applicationId, "ACTIVE"], [b.applicationId, "WAITLISTED"]]);
    expect(await db().lease.count({ where: { unitId: unit.id } })).toBe(1);
  });

  it("two applicants signing concurrently: exactly one Residency; the other gets 'unit no longer available' and is escalated", async () => {
    const { agency, unit, a, b } = await twoApproved();
    const sa = await readyToSign(a.applicationId);
    // Give B a lease too, as if staff sent one by hand (a bug or a race elsewhere): the signing
    // transaction itself must still keep the unit single-occupancy.
    await db().unitHold.updateMany({ where: { applicationId: b.applicationId }, data: { status: "WAITLISTED" } });
    const bl = await db().lease.create({
      data: { agencyId: agency.id, applicationId: b.applicationId, unitId: unit.id, signerId: (await db().application.findUniqueOrThrow({ where: { id: b.applicationId } })).leadId, rentCents: 300000, depositCents: 300000, startDate: new Date("2026-11-01"), endDate: new Date("2027-10-31"), status: "SENT", signTokenHash: deriveToken("lease", "manual-b", 1).hash, signTokenExpiresAt: new Date(Date.now() + 86_400_000) },
    });
    void bl;
    const [ra, rb] = await Promise.all([signLease(sa.token, sa.input), signLease(deriveToken("lease", "manual-b", 1).token, sa.input)]);
    expect(ra.http).toBe(200);
    expect(rb).toMatchObject({ http: 409, body: { code: "UNIT_UNAVAILABLE" } });
    expect(await db().residency.count({ where: { unitId: unit.id } })).toBe(1);
    expect(await db().approvalTask.count({ where: { applicationId: b.applicationId, type: "ESCALATION" } })).toBe(1);
    expect((await db().unit.findUniqueOrThrow({ where: { id: unit.id } })).status).toBe("LEASED");
  });

  it("the same signature submitted twice (concurrently, and again after the hold was consumed) returns the identical 200", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const s = await pendingApproval(agency.id, unit.id);
    await evaluate(agency.id, s.applicationId);
    await approve(agency.id, s.applicationId);
    const r = await readyToSign(s.applicationId);
    const [x, y] = await Promise.all([signLease(r.token, r.input), signLease(r.token, r.input)]);
    expect(x.http).toBe(200);
    expect(y).toEqual(x);
    expect((await db().unitHold.findFirstOrThrow({ where: { applicationId: s.applicationId } })).status).toBe("CONSUMED");
    // Even after the token's expiry and with the hold consumed, a replay is the same success.
    await db().lease.update({ where: { id: r.lease.id }, data: { signTokenExpiresAt: new Date(Date.now() - 1000) } });
    const z = await signLease(r.token, r.input);
    expect(z).toEqual(x);
    expect(await db().signature.count({ where: { leaseId: r.lease.id } })).toBe(1);
    expect(x.body).toMatchObject({ status: "SIGNED", leaseId: r.lease.id, docSha256: r.input.docSha256 });
  });

  it("an expired hold can't sign", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const s = await pendingApproval(agency.id, unit.id);
    await evaluate(agency.id, s.applicationId);
    await approve(agency.id, s.applicationId);
    const r = await readyToSign(s.applicationId);
    await db().unitHold.updateMany({ where: { applicationId: s.applicationId }, data: { startsAt: new Date(Date.now() - 73 * 3_600_000), expiresAt: new Date(Date.now() - 3_600_000) } });
    expect(await signLease(r.token, r.input)).toMatchObject({ http: 409, body: { code: "HOLD_EXPIRED" } });
    expect(await db().signature.count({ where: { leaseId: r.lease.id } })).toBe(0);
  });

  it("a signature over a document other than the reviewed lease is refused", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const s = await pendingApproval(agency.id, unit.id);
    await evaluate(agency.id, s.applicationId);
    await approve(agency.id, s.applicationId);
    const r = await readyToSign(s.applicationId);
    expect(await signLease(r.token, { ...r.input, docSha256: "0".repeat(64) })).toMatchObject({ http: 409, body: { code: "DOC_CHANGED" } });
  });

  it("when the head's hold expires, the sweeper voids their lease and promotes the next in line", async () => {
    const { unit, a, b } = await twoApproved();
    await db().unitHold.updateMany({ where: { applicationId: a.applicationId }, data: { startsAt: new Date(Date.now() - 73 * 3_600_000), expiresAt: new Date(Date.now() - 1000) } });
    const r = await sweepHolds();
    expect(r.promoted).toBe(1);
    const holds = await db().unitHold.findMany({ where: { unitId: unit.id } });
    expect(Object.fromEntries(holds.map((h) => [h.applicationId, h.status]))).toEqual({ [a.applicationId]: "EXPIRED", [b.applicationId]: "ACTIVE" });
    expect((await db().lease.findUniqueOrThrow({ where: { applicationId: a.applicationId } })).status).toBe("VOID");
    expect((await db().lease.findUniqueOrThrow({ where: { applicationId: b.applicationId } })).status).toBe("SENT");
  });

  it("concurrent sign, sweep, decide and withdraw on one unit: no deadlock escapes, invariants hold", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const a = await pendingApproval(agency.id, unit.id);
    const b = await pendingApproval(agency.id, unit.id);
    const c = await pendingApproval(agency.id, unit.id);
    for (const x of [a, b, c]) await evaluate(agency.id, x.applicationId);
    await approve(agency.id, a.applicationId);
    const sa = await readyToSign(a.applicationId);
    const results = await Promise.allSettled([
      signLease(sa.token, sa.input),
      sweepHolds(),
      approve(agency.id, b.applicationId),
      withdrawApplication(agency.id, c.applicationId, { type: "APPLICANT", id: null }),
      sweepHolds(),
    ]);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected.map((r) => String(r.reason))).toEqual([]);
    expect(await db().unitHold.count({ where: { unitId: unit.id, status: "ACTIVE" } })).toBeLessThanOrEqual(1);
    expect(await db().residency.count({ where: { unitId: unit.id } })).toBeLessThanOrEqual(1);
  });
});
