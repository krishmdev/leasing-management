import { PgBoss, fromPrisma } from "pg-boss";
import { AGENT_QUEUE } from "./config";

export const Q = {
  submitted: "application.submitted", // references.request + screening.invite
  evaluate: "agent.evaluate", // fetch summary -> analyze -> rubric -> rationale -> policy
  screeningWebhook: "screening.webhook",
  stepReaper: "agent.reap",
  holdsSweep: "holds.sweep",
  referencesSweep: "references.sweep",
  slaCheck: "sla.check",
  retentionPurge: "retention.purge",
  outboxKick: "outbox.kick",
} as const;
export type QueueName = (typeof Q)[keyof typeof Q];

const g = globalThis as unknown as { __leasingBoss?: Promise<PgBoss> };

/**
 * The web process only sends jobs, so its instance doesn't supervise, schedule or migrate. The
 * worker creates the schema and queues on startup.
 */
export function boss(role: "web" | "worker" = "web"): Promise<PgBoss> {
  g.__leasingBoss ??= (async () => {
    const b = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
      max: role === "worker" ? 6 : 2,
      ...(role === "web" ? { supervise: false, schedule: false, migrate: false, createSchema: false } : {}),
    });
    b.on("error", (e) => console.error("pg-boss:", e.message));
    await b.start();
    return b;
  })();
  return g.__leasingBoss;
}

export async function ensureQueues(b: PgBoss) {
  for (const name of Object.values(Q)) {
    if (await b.getQueue(name)) continue;
    const agentLike = name === Q.submitted || name === Q.evaluate || name === Q.screeningWebhook;
    await b.createQueue(name, agentLike ? { ...AGENT_QUEUE } : { expireInSeconds: 300, retryLimit: 3, retryDelay: 30 });
  }
}

type RawTx = { $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T> };

/**
 * Enqueue inside the caller's transaction, so the job exists if and only if the state change
 * that needs it committed. The singleton key collapses duplicate sends for the same work.
 */
export async function sendInTx(tx: RawTx, name: QueueName, data: object, singletonKey: string, startAfter?: Date) {
  const b = await boss();
  return b.send(name, data, { db: fromPrisma(tx), singletonKey, ...(startAfter ? { startAfter } : {}) });
}

export async function send(name: QueueName, data: object, singletonKey?: string) {
  const b = await boss();
  return b.send(name, data, singletonKey ? { singletonKey } : {});
}
