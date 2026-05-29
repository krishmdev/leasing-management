import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { faults, SimulatedCrash } from "@/server/faults";
import { countInvitations } from "@/mock-cra/service";
import { screeningKey } from "@/server/domain/screening/invite";
import { handleScreeningWebhook } from "@/server/domain/screening/webhook";
import { runSubmitted } from "@/server/agent/pipeline";
import { executeDecision } from "@/server/domain/decisions/decide";
import { reapStranded } from "@/server/jobs/reaper";
import { boss, Q } from "@/server/jobs/queues";
import { completeHostedFlow } from "@/mock-cra/service";
import { resetDb } from "../helpers/db";
import { agencyWith, answerReferences, completeScreening, evaluate, flushOutbox, mail, submittedApplication, throughEvaluation, webhookRequest } from "../helpers/pipeline";

const expireLeases = (applicationId: string) => db().$executeRaw`UPDATE "AgentStep" SET "leaseUntil" = now() - interval '1 second' WHERE "applicationId" = ${applicationId} AND status = 'RUNNING'`;

beforeAll(async () => {
  await resetDb();
});
beforeEach(() => {
  faults.reset();
  delete process.env.MOCKCRA_HONOR_IDEMPOTENCY;
});

describe("end to end per automation level", () => {
  it("manual: recommendation, summary, a DECISION task, no decision", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const r = await throughEvaluation(agency.id, unit.id);
    const app = await db().application.findUniqueOrThrow({ where: { id: r.applicationId } });
    expect(app.status).toBe("DECISION_PENDING");
    expect(await db().recommendation.count({ where: { applicationId: app.id } })).toBe(1);
    expect(await db().decision.count({ where: { applicationId: app.id } })).toBe(0);
    expect(await db().approvalTask.findFirst({ where: { applicationId: app.id } })).toMatchObject({ type: "DECISION", status: "OPEN" });
  });

  it("assisted: the draft decision waits in the approvals queue; approving it creates a hold and a lease", async () => {
    const { agency, unit } = await agencyWith("ASSISTED");
    const r = await throughEvaluation(agency.id, unit.id);
    const task = await db().approvalTask.findFirstOrThrow({ where: { applicationId: r.applicationId } });
    expect(task.payload).toMatchObject({ draft: { outcome: "APPROVE" } });
    expect(await db().decision.count({ where: { applicationId: r.applicationId } })).toBe(0);
    const res = await executeDecision(agency.id, r.applicationId, { outcome: "APPROVE", mode: "ASSISTED", decidedByType: "USER", decidedById: null, reasonCodes: [] });
    expect(res).toMatchObject({ status: "executed", hold: "ACTIVE" });
    expect((await db().application.findUniqueOrThrow({ where: { id: r.applicationId } })).status).toBe("LEASE_SENT");
    expect((await db().approvalTask.findFirstOrThrow({ where: { id: task.id } })).status).toBe("RESOLVED");
  });

  it("autonomous: a clean strong approval executes without a person", async () => {
    const { agency, unit } = await agencyWith("AUTONOMOUS");
    const r = await throughEvaluation(agency.id, unit.id);
    expect(r.result.output).toMatchObject({ action: "AUTO_EXECUTE", executed: "executed" });
    expect(await db().decision.findFirst({ where: { applicationId: r.applicationId } })).toMatchObject({ mode: "AUTONOMOUS", decidedByType: "AGENT", outcome: "APPROVE" });
  });

  it("autonomous never declines: a poor file becomes a draft for a person", async () => {
    const { agency, unit } = await agencyWith("AUTONOMOUS");
    const r = await throughEvaluation(agency.id, unit.id, "poor", { incomeCents: 540_000 });
    expect(r.result.output).toMatchObject({ action: "DRAFT_FOR_APPROVAL", executed: null });
    expect(await db().decision.count({ where: { applicationId: r.applicationId } })).toBe(0);
  });

  it("an eviction record escalates in every mode", async () => {
    const { agency, unit } = await agencyWith("AUTONOMOUS");
    const r = await throughEvaluation(agency.id, unit.id, "eviction");
    expect(await db().approvalTask.findFirst({ where: { applicationId: r.applicationId } })).toMatchObject({ type: "ESCALATION" });
  });

  it("records a timeline with redaction counts and no PII in step summaries", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const r = await throughEvaluation(agency.id, unit.id, "excellent", { referenceText: "Great tenant. They have two kids and go to church every Sunday. Always paid on time." });
    const steps = await db().agentStep.findMany({ where: { applicationId: r.applicationId }, orderBy: { createdAt: "asc" } });
    expect(steps.map((s) => s.stepName)).toEqual(["screening.invite", "screening.fetchSummary", "references.analyze", "rubric.evaluate", "rationale.generate", "policy.apply"]);
    expect(steps.every((s) => s.status === "SUCCEEDED")).toBe(true);
    expect(steps.find((s) => s.stepName === "references.analyze")!.outputSummary).toMatchObject({ redactionCount: 2 });
    const all = JSON.stringify(steps.map((s) => s.outputSummary));
    expect(all).not.toMatch(/Maya|Chen|example\.com|church|kids/i);
  });
});

describe("crash safety", () => {
  it("crash after the provider call, before the step commits: the retry reconciles and there is exactly one invitation", async () => {
    process.env.MOCKCRA_HONOR_IDEMPOTENCY = "0"; // make the provider ignore idempotency keys, so only reconciliation can save us
    const { agency, unit } = await agencyWith("MANUAL");
    const s = await submittedApplication(agency.id, unit.id);
    faults.arm("screening:after-provider-call");
    await expect(runSubmitted({ agencyId: agency.id, applicationId: s.applicationId })).rejects.toBeInstanceOf(SimulatedCrash);
    const sr = await db().screeningRequest.findFirstOrThrow({ where: { applicationId: s.applicationId } });
    expect(sr.providerApplicantRef).toBeNull(); // the crash beat our commit
    await expireLeases(s.applicationId);
    await runSubmitted({ agencyId: agency.id, applicationId: s.applicationId });
    const app = await db().application.findUniqueOrThrow({ where: { id: s.applicationId }, include: { criteria: true } });
    expect(await countInvitations(screeningKey(s.applicationId, app.criteria!.version))).toBe(1);
    expect((await db().screeningRequest.findFirstOrThrow({ where: { applicationId: s.applicationId } })).providerApplicantRef).toBeTruthy();
    const step = await db().agentStep.findFirstOrThrow({ where: { applicationId: s.applicationId, stepName: "screening.invite" } });
    expect(step).toMatchObject({ status: "SUCCEEDED", attempt: 2, outputSummary: { reconciled: true } });
    expect(await db().outboxMessage.count({ where: { idempotencyKey: { startsWith: `mail:app:${s.applicationId}:screening-invite` } } })).toBe(1);
  });

  it("crash after the decision commits, before the job acks: no duplicate decision, document or email", async () => {
    const { agency, unit } = await agencyWith("AUTONOMOUS");
    const s = await submittedApplication(agency.id, unit.id);
    await answerReferences(s.applicationId);
    await completeScreening(agency.id, s.applicationId);
    faults.arm("step:policy.apply:before-commit");
    await expect(evaluate(agency.id, s.applicationId)).rejects.toBeInstanceOf(SimulatedCrash);
    expect(await db().decision.count({ where: { applicationId: s.applicationId } })).toBe(1);
    await expireLeases(s.applicationId);
    const again = await evaluate(agency.id, s.applicationId); // pg-boss redelivery
    // The application has moved on (LEASE_SENT), so the redelivered job does nothing at all.
    expect(again.output).toMatchObject({ action: "SKIPPED" });
    expect(await db().decision.count({ where: { applicationId: s.applicationId } })).toBe(1);
    await flushOutbox();
    const lead = (await db().application.findUniqueOrThrow({ where: { id: s.applicationId } })).leadId;
    const keys = (await db().outboxMessage.findMany({ where: { payload: { path: ["to", "id"], equals: lead } } })).map((o) => o.idempotencyKey);
    expect(keys.filter((k) => k.includes(":decision:"))).toHaveLength(1);
    expect(await db().generatedDocument.count({ where: { applicationId: s.applicationId, kind: "LEASE" } })).toBe(1);
    expect(mail.delivered.filter((m) => m.to === s.email && /Approved/.test(m.subject))).toHaveLength(1);
  });
});

describe("reaper and job dedupe", () => {
  it("an invite that crashed is re-queued to the invite job, never to evaluation, and the application still gets evaluated", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const s = await submittedApplication(agency.id, unit.id);
    faults.arm("screening:after-provider-call");
    await expect(runSubmitted({ agencyId: agency.id, applicationId: s.applicationId })).rejects.toBeInstanceOf(SimulatedCrash);
    await expireLeases(s.applicationId);
    const sent: [string, object, string][] = [];
    await reapStranded(async (name, data, key) => void sent.push([name, data, key]));
    expect(sent).toEqual([[Q.submitted, { agencyId: agency.id, applicationId: s.applicationId }, `submitted:${s.applicationId}`]]);
    // A stray evaluate job before screening is done is a no-op and records no input snapshot.
    expect((await evaluate(agency.id, s.applicationId)).output).toMatchObject({ action: "SKIPPED" });
    expect(await db().agentStep.count({ where: { applicationId: s.applicationId, stepName: "screening.fetchSummary" } })).toBe(0);
    await runSubmitted({ agencyId: agency.id, applicationId: s.applicationId });
    await answerReferences(s.applicationId);
    const sr = await db().screeningRequest.findFirstOrThrow({ where: { applicationId: s.applicationId } });
    const { inv, eventId } = await completeHostedFlow(sr.providerApplicantRef!, "excellent");
    await handleScreeningWebhook("mock", webhookRequest({ id: eventId, type: "screening.completed", ref: inv.ref }));
    const r = await evaluate(agency.id, s.applicationId);
    expect(r.output).toMatchObject({ action: "SUGGEST" });
    expect(await db().agentStep.count({ where: { applicationId: s.applicationId, status: "SUCCEEDED" } })).toBe(6);
  });

  it("two sends with the same singleton key make one agent job", async () => {
    const b = await boss();
    const key = `evaluate:dedupe-${Date.now()}`;
    const first = await b.send(Q.evaluate, { x: 1 }, { singletonKey: key });
    const second = await b.send(Q.evaluate, { x: 1 }, { singletonKey: key });
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    const [row] = await db().$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pgboss.job WHERE name = ${Q.evaluate} AND singleton_key = ${key}`;
    expect(Number(row.n)).toBe(1);
  });
});

describe("webhooks", () => {
  it("dedupes by provider event id", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const s = await submittedApplication(agency.id, unit.id, { withReference: false });
    const first = await completeScreening(agency.id, s.applicationId);
    expect(first.body).toMatchObject({ ok: true, evaluationQueued: true });
    const sr = await db().screeningRequest.findFirstOrThrow({ where: { applicationId: s.applicationId } });
    const ev = await db().webhookEvent.findFirstOrThrow({ where: { payload: { path: ["ref"], equals: sr.providerApplicantRef! } } });
    const again = await handleScreeningWebhook("mock", webhookRequest({ id: ev.eventId, type: "screening.completed", ref: sr.providerApplicantRef }));
    expect(again.body).toMatchObject({ duplicate: true });
  });

  it("rejects a bad signature", async () => {
    const bad = new Request("http://x", { method: "POST", headers: { "x-mockcra-signature": "00" }, body: "{}" });
    expect((await handleScreeningWebhook("mock", bad)).status).toBe(401);
  });
});
