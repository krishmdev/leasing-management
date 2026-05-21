import { uuidv7 } from "@/lib/ids";
import { canonicalJson, sha256Hex } from "@/server/crypto/tokens";
import { db } from "@/server/db";
import { faults, SimulatedCrash } from "@/server/faults";

export interface StepKey {
  agencyId: string;
  applicationId: string;
  criteriaVersionId: string;
  stepName: string;
}

export type StepResult<O> =
  | { status: "done"; output: O; replayed: boolean; attempt: number }
  | { status: "busy"; attempt: number };

export class StepInputMismatch extends Error {
  constructor(step: string) {
    super(`input for step ${step} changed between attempts`);
    this.name = "StepInputMismatch";
  }
}
export class StepLeaseLost extends Error {
  constructor(step: string) {
    super(`lost the lease on step ${step} before completing it`);
    this.name = "StepLeaseLost";
  }
}

interface Row {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  attempt: number;
  inputSha256: string | null;
  outputJson: unknown;
}

/**
 * Run one agent step at most once to completion.
 *
 * pg-boss may deliver a job twice, or a worker may die mid-step. The AgentStep row, unique on
 * (application, criteria version, step), is the source of truth:
 *   - SUCCEEDED: return the stored output, do nothing else;
 *   - RUNNING with a live lease: someone else is on it, return "busy";
 *   - PENDING, FAILED, or RUNNING with an expired lease: claim it and run.
 * The step body still has to be safe to re-run after a crash (e.g. provider idempotency keys),
 * because a crash can land after its side effect and before the SUCCEEDED write.
 */
export async function runStep<O>(
  key: StepKey,
  input: unknown,
  body: (ctx: { attempt: number }) => Promise<{ output: O; summary?: Record<string, unknown> }>,
  opts: { workerId: string; leaseMs?: number },
): Promise<StepResult<O>> {
  const leaseMs = opts.leaseMs ?? 120_000;
  const inputJson = canonicalJson(input ?? null);
  const inputSha = sha256Hex(inputJson);
  const client = db();

  await client.$executeRaw`
    INSERT INTO "AgentStep" (id, "agencyId", "applicationId", "criteriaVersionId", "stepName", status, "inputJson", "inputSha256")
    VALUES (${uuidv7()}, ${key.agencyId}, ${key.applicationId}, ${key.criteriaVersionId}, ${key.stepName}, 'PENDING', ${inputJson}::jsonb, ${inputSha})
    ON CONFLICT ("applicationId", "criteriaVersionId", "stepName") DO NOTHING`;

  const claimed = await client.$queryRaw<Row[]>`
    UPDATE "AgentStep"
    SET status = 'RUNNING', attempt = attempt + 1, "leaseOwner" = ${opts.workerId},
        "leaseUntil" = now() + (${leaseMs}::int * interval '1 millisecond'),
        "startedAt" = COALESCE("startedAt", now()), error = NULL
    WHERE "applicationId" = ${key.applicationId} AND "criteriaVersionId" = ${key.criteriaVersionId} AND "stepName" = ${key.stepName}
      AND (status IN ('PENDING', 'FAILED') OR (status = 'RUNNING' AND "leaseUntil" < now()))
    RETURNING id, status, attempt, "inputSha256", "outputJson"`;

  if (claimed.length === 0) {
    const [row] = await client.$queryRaw<Row[]>`
      SELECT id, status, attempt, "inputSha256", "outputJson" FROM "AgentStep"
      WHERE "applicationId" = ${key.applicationId} AND "criteriaVersionId" = ${key.criteriaVersionId} AND "stepName" = ${key.stepName}`;
    if (row?.status === "SUCCEEDED") return { status: "done", output: row.outputJson as O, replayed: true, attempt: row.attempt };
    return { status: "busy", attempt: row?.attempt ?? 0 };
  }

  const row = claimed[0];
  if (row.inputSha256 !== inputSha) {
    await client.$executeRaw`UPDATE "AgentStep" SET status = 'FAILED', error = 'input changed', "leaseOwner" = NULL WHERE id = ${row.id} AND "leaseOwner" = ${opts.workerId}`;
    throw new StepInputMismatch(key.stepName);
  }

  const started = Date.now();
  let result: { output: O; summary?: Record<string, unknown> };
  try {
    result = await body({ attempt: row.attempt });
    faults.hit(`step:${key.stepName}:before-commit`);
  } catch (e) {
    if (e instanceof SimulatedCrash) throw e; // a dead process writes nothing
    const msg = e instanceof Error ? e.message.slice(0, 500) : String(e);
    await client.$executeRaw`
      UPDATE "AgentStep" SET status = 'FAILED', error = ${msg}, "leaseOwner" = NULL, "leaseUntil" = NULL
      WHERE id = ${row.id} AND "leaseOwner" = ${opts.workerId} AND status = 'RUNNING'`;
    throw e;
  }

  const outJson = canonicalJson(result.output ?? null);
  const done = await client.$executeRaw`
    UPDATE "AgentStep"
    SET status = 'SUCCEEDED', "outputJson" = ${outJson}::jsonb, "outputSha256" = ${sha256Hex(outJson)},
        "outputSummary" = ${JSON.stringify(result.summary ?? {})}::jsonb, "finishedAt" = now(),
        "durationMs" = ${Date.now() - started}, "leaseOwner" = NULL, "leaseUntil" = NULL
    WHERE id = ${row.id} AND "leaseOwner" = ${opts.workerId} AND status = 'RUNNING'`;
  if (done === 0) throw new StepLeaseLost(key.stepName);
  return { status: "done", output: JSON.parse(outJson) as O, replayed: false, attempt: row.attempt };
}
