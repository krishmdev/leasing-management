import { uuidv7 } from "@/lib/ids";
import { canonicalJson, sha256Hex } from "@/server/crypto/tokens";
import { db, type Db } from "@/server/db";
import { faults, SimulatedCrash } from "@/server/faults";
import { tenantDb, type TenantTx } from "@/server/tenant";
import { STEP } from "@/server/jobs/config";

export interface StepKey {
  agencyId: string;
  applicationId: string;
  criteriaVersionId: string;
  stepName: string;
}

export interface StepCtx {
  attempt: number;
  /** Aborts at the step's hard timeout (always shorter than the lease) or when the job is cancelled. */
  signal: AbortSignal;
  /**
   * Run in-step database writes in a transaction that first re-checks, under a row lock, that
   * this claim still owns the step. If the lease was lost the writes don't happen.
   */
  tx<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T>;
  /** Extend the lease for a long step. Throws StepLeaseLost if someone else took over. */
  renew(): Promise<void>;
}

export class StepBusy extends Error {
  constructor(public readonly step: string, public readonly retryAfterMs: number) {
    super(`step ${step} is running elsewhere; retry in ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = "StepBusy";
  }
}
export class StepInputDrift extends Error {
  constructor(step: string) {
    super(`input for step ${step} differs from the snapshot taken on its first attempt`);
    this.name = "StepInputDrift";
  }
}
export class StepDead extends Error {
  constructor(step: string, reason: string) {
    super(`step ${step} is dead: ${reason}`);
    this.name = "StepDead";
  }
}
export class StepLeaseLost extends Error {
  constructor(step: string) {
    super(`lost the lease on step ${step}`);
    this.name = "StepLeaseLost";
  }
}

interface Row {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "DEAD";
  attempt: number;
  inputSha256: string | null;
  outputJson: unknown;
  error: string | null;
  msLeft: number | null;
}

/**
 * Run one agent step at most once to completion.
 *
 * pg-boss delivers at least once, and a worker can die (or pg-boss can give up on a handler
 * that is still running) mid-step. The AgentStep row, unique on (application, criteria version,
 * step), decides what happens:
 *   - SUCCEEDED with the same input: return the stored output and do nothing else;
 *   - RUNNING with a live lease: throw StepBusy, so the job retries after the lease runs out;
 *   - PENDING, FAILED, or RUNNING with an expired lease: claim with a fresh claim token and run;
 *   - DEAD, or an input that drifted from the first attempt's snapshot: throw, a person looks.
 * Every write the step makes, and the final SUCCEEDED write, is conditional on the claim token,
 * so a worker that lost its lease can't clobber the one that took over. The body still has to be
 * safe to re-run from the top (provider idempotency keys, upserts), because a crash can land
 * after an external side effect and before the SUCCEEDED write.
 */
export async function runStep<O>(
  key: StepKey,
  input: unknown,
  body: (ctx: StepCtx) => Promise<{ output: O; summary?: Record<string, unknown> }>,
  opts: { leaseMs?: number; hardTimeoutMs?: number; maxAttempts?: number; signal?: AbortSignal; client?: Db } = {},
): Promise<{ output: O; replayed: boolean; attempt: number }> {
  const leaseMs = opts.leaseMs ?? STEP.leaseMs;
  const hardTimeoutMs = Math.min(opts.hardTimeoutMs ?? STEP.hardTimeoutMs, leaseMs - 5_000);
  const maxAttempts = opts.maxAttempts ?? STEP.maxAttempts;
  const client = opts.client ?? db();
  const inputJson = canonicalJson(input ?? null);
  const inputSha = sha256Hex(inputJson);
  const claim = uuidv7();
  const where = { a: key.applicationId, c: key.criteriaVersionId, s: key.stepName };

  await client.$executeRaw`
    INSERT INTO "AgentStep" (id, "agencyId", "applicationId", "criteriaVersionId", "stepName", status, "inputJson", "inputSha256")
    VALUES (${uuidv7()}, ${key.agencyId}, ${where.a}, ${where.c}, ${where.s}, 'PENDING', ${inputJson}::jsonb, ${inputSha})
    ON CONFLICT ("applicationId", "criteriaVersionId", "stepName") DO NOTHING`;

  const claimed = await client.$queryRaw<Row[]>`
    UPDATE "AgentStep"
    SET status = 'RUNNING', attempt = attempt + 1, "leaseOwner" = ${claim},
        "leaseUntil" = clock_timestamp() + (${leaseMs}::int * interval '1 millisecond'),
        "startedAt" = COALESCE("startedAt", clock_timestamp()), error = NULL
    WHERE "applicationId" = ${where.a} AND "criteriaVersionId" = ${where.c} AND "stepName" = ${where.s}
      AND "inputSha256" = ${inputSha}
      AND (status IN ('PENDING', 'FAILED') OR (status = 'RUNNING' AND "leaseUntil" < clock_timestamp()))
    RETURNING id, status, attempt, "inputSha256", "outputJson", error, NULL::int AS "msLeft"`;

  if (claimed.length === 0) {
    const [row] = await client.$queryRaw<Row[]>`
      SELECT id, status, attempt, "inputSha256", "outputJson", error,
             GREATEST(0, EXTRACT(EPOCH FROM ("leaseUntil" - clock_timestamp())) * 1000)::int AS "msLeft"
      FROM "AgentStep"
      WHERE "applicationId" = ${where.a} AND "criteriaVersionId" = ${where.c} AND "stepName" = ${where.s}`;
    if (!row) throw new Error(`step row for ${key.stepName} vanished`);
    if (row.inputSha256 !== inputSha) {
      if (row.status !== "SUCCEEDED" && row.status !== "DEAD") {
        await client.$executeRaw`UPDATE "AgentStep" SET status = 'DEAD', error = 'input drift', "leaseOwner" = NULL, "leaseUntil" = NULL
          WHERE id = ${row.id} AND (status IN ('PENDING', 'FAILED') OR (status = 'RUNNING' AND "leaseUntil" < clock_timestamp()))`;
      }
      throw new StepInputDrift(key.stepName);
    }
    if (row.status === "SUCCEEDED") return { output: row.outputJson as O, replayed: true, attempt: row.attempt };
    if (row.status === "DEAD") throw new StepDead(key.stepName, row.error ?? "unknown");
    throw new StepBusy(key.stepName, row.msLeft ?? leaseMs);
  }

  const row = claimed[0];
  if (row.attempt > maxAttempts) {
    await client.$executeRaw`UPDATE "AgentStep" SET status = 'DEAD', error = ${`gave up after ${maxAttempts} attempts`}, "leaseOwner" = NULL, "leaseUntil" = NULL
      WHERE id = ${row.id} AND "leaseOwner" = ${claim}`;
    throw new StepDead(key.stepName, `gave up after ${maxAttempts} attempts`);
  }

  const timeout = AbortSignal.timeout(hardTimeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const ctx: StepCtx = {
    attempt: row.attempt,
    signal,
    tx: (fn) =>
      tenantDb(key.agencyId, client).$transaction(async (t) => {
        const owned = await t.$queryRaw<{ id: string }[]>`
          SELECT id FROM "AgentStep"
          WHERE id = ${row.id} AND "agencyId" = ${key.agencyId} AND "leaseOwner" = ${claim} AND status = 'RUNNING'
            AND "leaseUntil" > clock_timestamp()
          FOR UPDATE`;
        if (owned.length !== 1) throw new StepLeaseLost(key.stepName);
        return fn(t);
      }),
    renew: async () => {
      const n = await client.$executeRaw`
        UPDATE "AgentStep" SET "leaseUntil" = clock_timestamp() + (${leaseMs}::int * interval '1 millisecond')
        WHERE id = ${row.id} AND "leaseOwner" = ${claim} AND status = 'RUNNING'`;
      if (n !== 1) throw new StepLeaseLost(key.stepName);
    },
  };

  const started = Date.now();
  let result: { output: O; summary?: Record<string, unknown> };
  try {
    result = await body(ctx);
    signal.throwIfAborted();
    faults.hit(`step:${key.stepName}:before-commit`);
  } catch (e) {
    if (e instanceof SimulatedCrash) throw e; // a dead process writes nothing
    const msg = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 500) : String(e);
    await client.$executeRaw`
      UPDATE "AgentStep" SET status = 'FAILED', error = ${msg}, "leaseOwner" = NULL, "leaseUntil" = NULL
      WHERE id = ${row.id} AND "leaseOwner" = ${claim} AND status = 'RUNNING'`;
    throw e;
  }

  const outJson = canonicalJson(result.output ?? null);
  const done = await client.$executeRaw`
    UPDATE "AgentStep"
    SET status = 'SUCCEEDED', "outputJson" = ${outJson}::jsonb, "outputSha256" = ${sha256Hex(outJson)},
        "outputSummary" = ${JSON.stringify(result.summary ?? {})}::jsonb, "finishedAt" = clock_timestamp(),
        "durationMs" = ${Date.now() - started}, "leaseOwner" = NULL, "leaseUntil" = NULL
    WHERE id = ${row.id} AND "leaseOwner" = ${claim} AND status = 'RUNNING'`;
  if (done !== 1) throw new StepLeaseLost(key.stepName);
  return { output: JSON.parse(outJson) as O, replayed: false, attempt: row.attempt };
}

/**
 * Steps whose worker vanished (RUNNING past its lease) or that were never picked up (PENDING or
 * FAILED and idle for a while). The reaper cron re-enqueues a pipeline job for each; pg-boss's
 * singleton key keeps that from piling up duplicates.
 */
export async function strandedSteps(idleMs = STEP.reapIdleMs) {
  return db().$queryRaw<{ agencyId: string; applicationId: string; criteriaVersionId: string; stepName: string }[]>`
    SELECT DISTINCT "agencyId", "applicationId", "criteriaVersionId", "stepName" FROM "AgentStep"
    WHERE (status = 'RUNNING' AND "leaseUntil" < clock_timestamp())
       OR (status IN ('PENDING', 'FAILED') AND COALESCE("startedAt", "createdAt") < clock_timestamp() - (${idleMs}::int * interval '1 millisecond'))
    LIMIT 200`;
}
