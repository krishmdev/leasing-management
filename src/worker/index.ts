import { existsSync } from "node:fs";
import { hostname } from "node:os";

if (existsSync(".env")) process.loadEnvFile(".env");

const { boss, ensureQueues, Q, send } = await import("@/server/jobs/queues");
const { recordEgressCanary } = await import("@/server/egress");
const { drain } = await import("@/server/outbox/outbox");
const { transport } = await import("@/server/email/transport");
const { composeEmail } = await import("@/server/email/compose");
const { renderDocument } = await import("./documents/render");
const { runEvaluation, runSubmitted } = await import("@/server/agent/pipeline");
const { reapStranded } = await import("@/server/jobs/reaper");
const { sweepHolds } = await import("@/server/jobs/sweeps");
const { expireReferences } = await import("@/server/domain/references/service");
const { checkSla } = await import("@/server/domain/maintenance/sla");
const { purgeExpired } = await import("@/server/domain/retention/purge");

const workerId = `${hostname()}:${process.pid}`;
if (process.env.EGRESS_CANARY === "1") await recordEgressCanary("worker");

const b = await boss("worker");
await ensureQueues(b);

type AppJob = { agencyId: string; applicationId: string; criteriaVersionId?: string };

// Agent jobs. A StepBusy error fails this attempt on purpose: pg-boss retries after its
// retryDelay, which is longer than a step lease, so the retry lands after the other runner's
// lease is gone (see jobs/config.ts).
await b.work<AppJob>(Q.submitted, { localConcurrency: 2 }, async ([job]) => {
  await runSubmitted({ agencyId: job.data.agencyId, applicationId: job.data.applicationId, signal: job.signal });
});
await b.work<AppJob>(Q.evaluate, { localConcurrency: 2 }, async ([job]) => {
  await runEvaluation({ agencyId: job.data.agencyId, applicationId: job.data.applicationId, criteriaVersionId: job.data.criteriaVersionId!, signal: job.signal });
});

await b.work(Q.stepReaper, async () => void (await reapStranded(send)));
await b.work(Q.holdsSweep, async () => void (await sweepHolds()));
await b.work(Q.referencesSweep, async () => void (await expireReferences()));
await b.work(Q.slaCheck, async () => void (await checkSla()));
await b.work(Q.retentionPurge, async () => void (await purgeExpired({ dryRun: false })));

await b.schedule(Q.stepReaper, "*/5 * * * *");
await b.schedule(Q.holdsSweep, "* * * * *");
await b.schedule(Q.referencesSweep, "0 * * * *");
await b.schedule(Q.slaCheck, "*/5 * * * *");
await b.schedule(Q.retentionPurge, "30 3 * * *", null, { tz: "America/Los_Angeles" });

// Outbox: poll. Rows are claimed with a lease, so several workers can run this safely.
const deps = { transport: transport(), compose: composeEmail, renderDocument, workerId };
let stopping = false;
const pollMs = Number(process.env.OUTBOX_POLL_MS ?? 1000);
(async function loop() {
  while (!stopping) {
    try {
      await drain(deps, { max: 5 });
    } catch (e) {
      console.error("outbox:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
})();

console.log(`worker ${workerId} running (transport=${deps.transport.id}, llm=${process.env.LLM_PROVIDER ?? "offline"})`);

async function shutdown() {
  stopping = true;
  await b.stop({ graceful: true, timeout: 10_000 });
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
