import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "@/lib/ids";
import { db } from "@/server/db";
import { faults, SimulatedCrash } from "@/server/faults";
import { runStep, StepInputMismatch } from "@/server/agent/durable";
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
    const first = await runStep(key, { a: 1 }, body, { workerId: "w1" });
    const second = await runStep(key, { a: 1 }, body, { workerId: "w2" });
    expect(first).toMatchObject({ status: "done", replayed: false, output: { score: 88, run: 1 } });
    expect(second).toMatchObject({ status: "done", replayed: true, output: { score: 88, run: 1 } });
    expect(runs).toBe(1);
  });

  it("two concurrent workers on the same step: one runs, the other no-ops", async () => {
    let runs = 0;
    const body = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 300));
      return { output: { ok: true } };
    };
    const results = await Promise.all([
      runStep(key, {}, body, { workerId: "w1" }),
      runStep(key, {}, body, { workerId: "w2" }),
      runStep(key, {}, body, { workerId: "w3" }),
    ]);
    expect(runs).toBe(1);
    expect(results.filter((r) => r.status === "done")).toHaveLength(1);
    expect(results.filter((r) => r.status === "busy")).toHaveLength(2);
  });

  it("a crash mid-step leaves RUNNING; the stale lease is reclaimed on retry", async () => {
    faults.arm("step:rubric.evaluate:before-commit");
    await expect(runStep(key, {}, async () => ({ output: { v: 1 } }), { workerId: "w1" })).rejects.toBeInstanceOf(SimulatedCrash);
    const row = await db().agentStep.findFirstOrThrow({ where: { applicationId: key.applicationId } });
    expect(row.status).toBe("RUNNING");
    // lease still live: another worker backs off
    expect((await runStep(key, {}, async () => ({ output: { v: 2 } }), { workerId: "w2" })).status).toBe("busy");
    await expireLease();
    const r = await runStep(key, {}, async () => ({ output: { v: 2 } }), { workerId: "w2" });
    expect(r).toMatchObject({ status: "done", output: { v: 2 }, attempt: 2 });
  });

  it("an ordinary error marks FAILED and the next attempt re-runs", async () => {
    await expect(runStep(key, {}, async () => { throw new Error("provider 503"); }, { workerId: "w1" })).rejects.toThrow("provider 503");
    expect((await db().agentStep.findFirstOrThrow({ where: { applicationId: key.applicationId } })).status).toBe("FAILED");
    expect(await runStep(key, {}, async () => ({ output: 1 }), { workerId: "w1" })).toMatchObject({ status: "done", attempt: 2 });
  });

  it("refuses to continue if the input snapshot changed between attempts", async () => {
    await expect(runStep(key, { income: 1 }, async () => { throw new Error("x"); }, { workerId: "w1" })).rejects.toThrow();
    await expect(runStep(key, { income: 2 }, async () => ({ output: 1 }), { workerId: "w1" })).rejects.toBeInstanceOf(StepInputMismatch);
  });

  it("stores input and output snapshots with hashes", async () => {
    await runStep(key, { b: 2, a: 1 }, async () => ({ output: { y: 1 }, summary: { points: 3 } }), { workerId: "w1" });
    const row = await db().agentStep.findFirstOrThrow({ where: { applicationId: key.applicationId } });
    expect(row.inputJson).toEqual({ a: 1, b: 2 });
    expect(row.inputSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.outputSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.outputSummary).toEqual({ points: 3 });
  });
});
