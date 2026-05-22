import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "@/lib/ids";
import { db } from "@/server/db";
import { faults, SimulatedCrash } from "@/server/faults";
import { runStep, StepBusy, StepDead, StepInputDrift, StepLeaseLost, strandedSteps } from "@/server/agent/durable";
import { makeAgency, makeLead, makeUnit, resetDb } from "../helpers/db";

let key: { agencyId: string; applicationId: string; criteriaVersionId: string; stepName: string };

beforeAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  faults.reset();
  const a = await makeAgency();
  const unit = await makeUnit(a.id);
  const lead = await makeLead(a.id);
  const app = await db().application.create({ data: { id: uuidv7(), agencyId: a.id, leadId: lead.id, unitId: unit.id } });
  key = { agencyId: a.id, applicationId: app.id, criteriaVersionId: "crit-1", stepName: "rubric.evaluate" };
});

const expireLease = () => db().$executeRaw`UPDATE "AgentStep" SET "leaseUntil" = now() - interval '1 second' WHERE "applicationId" = ${key.applicationId}`;

describe("durable steps", () => {
  it("a retry of a SUCCEEDED step returns the stored output without running the body", async () => {
    let runs = 0;
    const body = async () => ({ output: { score: 88, run: ++runs } });
    const first = await runStep(key, { a: 1 }, body);
    const second = await runStep(key, { a: 1 }, body);
    expect(first).toMatchObject({ replayed: false, output: { score: 88, run: 1 } });
    expect(second).toMatchObject({ replayed: true, output: { score: 88, run: 1 } });
    expect(runs).toBe(1);
  });

  it("two concurrent workers on the same step: one runs, the others throw StepBusy (so the job retries)", async () => {
    let runs = 0;
    const body = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 300));
      return { output: { ok: true } };
    };
    const results = await Promise.allSettled([runStep(key, {}, body), runStep(key, {}, body), runStep(key, {}, body)]);
    expect(runs).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const busy = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason);
    expect(busy).toHaveLength(2);
    for (const b of busy) {
      expect(b).toBeInstanceOf(StepBusy);
      expect((b as StepBusy).retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("a crash mid-step leaves RUNNING; the stale lease is reclaimed on retry", async () => {
    faults.arm("step:rubric.evaluate:before-commit");
    await expect(runStep(key, {}, async () => ({ output: { v: 1 } }))).rejects.toBeInstanceOf(SimulatedCrash);
    const row = await db().agentStep.findFirstOrThrow({ where: { applicationId: key.applicationId } });
    expect(row.status).toBe("RUNNING");
    // lease still live: another worker backs off
    await expect(runStep(key, {}, async () => ({ output: { v: 2 } }))).rejects.toBeInstanceOf(StepBusy);
    expect(await strandedSteps()).toHaveLength(0);
    await expireLease();
    expect((await strandedSteps()).map((s) => s.applicationId)).toContain(key.applicationId);
    const r = await runStep(key, {}, async () => ({ output: { v: 2 } }));
    expect(r).toMatchObject({ replayed: false, output: { v: 2 }, attempt: 2 });
  });

  it("an ordinary error marks FAILED and the next attempt re-runs", async () => {
    await expect(runStep(key, {}, async () => { throw new Error("provider 503"); })).rejects.toThrow("provider 503");
    expect((await db().agentStep.findFirstOrThrow({ where: { applicationId: key.applicationId } })).status).toBe("FAILED");
    expect(await runStep(key, {}, async () => ({ output: 1 }))).toMatchObject({ replayed: false, attempt: 2 });
  });

  it("input drift after a failure makes the step DEAD", async () => {
    await expect(runStep(key, { income: 1 }, async () => { throw new Error("x"); })).rejects.toThrow();
    await expect(runStep(key, { income: 2 }, async () => ({ output: 1 }))).rejects.toBeInstanceOf(StepInputDrift);
    expect((await db().agentStep.findFirstOrThrow({ where: { applicationId: key.applicationId } })).status).toBe("DEAD");
    await expect(runStep(key, { income: 1 }, async () => ({ output: 1 }))).rejects.toBeInstanceOf(StepDead);
  });

  it("a SUCCEEDED step with a different input is drift, not a replay", async () => {
    await runStep(key, { income: 1 }, async () => ({ output: "old" }));
    await expect(runStep(key, { income: 2 }, async () => ({ output: "new" }))).rejects.toBeInstanceOf(StepInputDrift);
  });

  it("stops after maxAttempts and goes DEAD", async () => {
    for (let i = 0; i < 2; i++) await expect(runStep(key, {}, async () => { throw new Error("flaky"); }, { maxAttempts: 2 })).rejects.toThrow("flaky");
    await expect(runStep(key, {}, async () => ({ output: 1 }), { maxAttempts: 2 })).rejects.toBeInstanceOf(StepDead);
  });

  it("a runner that lost its lease can't write through ctx.tx or complete", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = runStep(key, {}, async (ctx) => {
      await gate;
      await ctx.tx(async (tx) => tx.application.update({ where: { id: key.applicationId }, data: { currentStep: 5 } }));
      return { output: "slow" };
    }, { leaseMs: 60_000 });
    await new Promise((r) => setTimeout(r, 100));
    await expireLease();
    const fast = await runStep(key, {}, async () => ({ output: "fast" }));
    release();
    await expect(slow).rejects.toBeInstanceOf(StepLeaseLost);
    expect(fast.output).toBe("fast");
    expect((await db().application.findUniqueOrThrow({ where: { id: key.applicationId } })).currentStep).toBe(1);
    expect((await db().agentStep.findFirstOrThrow({ where: { applicationId: key.applicationId } })).outputJson).toBe("fast");
  });

  it("stores input and output snapshots with hashes", async () => {
    await runStep(key, { b: 2, a: 1 }, async () => ({ output: { y: 1 }, summary: { points: 3 } }));
    const row = await db().agentStep.findFirstOrThrow({ where: { applicationId: key.applicationId } });
    expect(row.inputJson).toEqual({ a: 1, b: 2 });
    expect(row.inputSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.outputSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.outputSummary).toEqual({ points: 3 });
  });
});
