import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { faults, SimulatedCrash } from "@/server/faults";
import { claim, dispatchRow, drain, enqueueEmail, type DispatchDeps } from "@/server/outbox/outbox";
import { SmtpTransport, type OutgoingEmail } from "@/server/email/transport";
import { FakeIdempotentProvider } from "../helpers/fakeEmail";
import { mailTo } from "../helpers/mailpit";
import { makeAgency, resetDb } from "../helpers/db";

let agencyId: string;
let n = 0;

beforeAll(async () => {
  await resetDb();
  agencyId = (await makeAgency()).id;
});
beforeEach(() => faults.reset());

// Resolve the recipient straight from params so these tests are only about delivery.
const compose = (to: string) => async (): Promise<OutgoingEmail> => ({ to, subject: `Outbox test ${to}`, text: "hi", html: "<p>hi</p>" });
const expireLeases = () => db().$executeRaw`UPDATE "OutboxMessage" SET "leaseUntil" = now() - interval '1 second' WHERE status = 'SENDING'`;

async function enqueueOne() {
  const key = `mail:test:${++n}:${Date.now()}`;
  await enqueueEmail(db(), agencyId, key, { template: "test", to: { kind: "lead", id: "x" }, params: {} });
  return db().outboxMessage.findUniqueOrThrow({ where: { idempotencyKey: key } });
}

describe("outbox enqueue", () => {
  it("is idempotent on the key", async () => {
    const key = `mail:dupe:${Date.now()}`;
    for (let i = 0; i < 3; i++) await enqueueEmail(db(), agencyId, key, { template: "t", to: { kind: "lead", id: "x" }, params: {} });
    expect(await db().outboxMessage.count({ where: { idempotencyKey: key } })).toBe(1);
  });
});

describe("email delivery semantics", () => {
  it("idempotent provider: crash after acceptance, retry with the same key, exactly one delivery", async () => {
    const row = await enqueueOne();
    const provider = new FakeIdempotentProvider();
    const deps: DispatchDeps = { transport: provider, compose: compose("idem@example.com"), workerId: "w1" };
    faults.arm("outbox:after-send");
    const [claimed] = await claim(20, 60_000, row.id);
    await expect(dispatchRow(claimed, deps)).rejects.toBeInstanceOf(SimulatedCrash);
    expect((await db().outboxMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("SENDING");

    await expireLeases();
    expect(await drain(deps, { onlyId: row.id })).toMatchObject({ done: 1 });
    expect(provider.requests).toEqual([row.idempotencyKey, row.idempotencyKey]);
    expect(provider.delivered).toHaveLength(1);
    const after = await db().outboxMessage.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: "DONE", attempts: 2, providerMessageId: "fake_1" });
  });

  it("SMTP to Mailpit is at-least-once: the same crash produces two messages", async () => {
    const row = await enqueueOne();
    const to = `smtp-dupe-${Date.now()}@example.com`;
    const deps: DispatchDeps = { transport: new SmtpTransport(), compose: compose(to), workerId: "w1" };
    faults.arm("outbox:after-send");
    const [claimed] = await claim(20, 60_000, row.id);
    await expect(dispatchRow(claimed, deps)).rejects.toBeInstanceOf(SimulatedCrash);
    await expireLeases();
    await drain(deps, { onlyId: row.id });
    await new Promise((r) => setTimeout(r, 300));
    expect(await mailTo(to)).toHaveLength(2);
    expect((await db().outboxMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("DONE");
  });

  it("a retry after the provider's idempotency window sends nothing and goes to NEEDS_REVIEW", async () => {
    const row = await enqueueOne();
    let clock = Date.now();
    const provider = new FakeIdempotentProvider(24 * 3_600_000, () => clock);
    const deps: DispatchDeps = { transport: provider, compose: compose("late@example.com"), workerId: "w1", now: () => new Date(clock) };
    faults.arm("outbox:after-send");
    const [claimed] = await claim(20, 60_000, row.id);
    await expect(dispatchRow(claimed, deps)).rejects.toBeInstanceOf(SimulatedCrash);
    expect(provider.delivered).toHaveLength(1);

    clock += 25 * 3_600_000; // the provider has forgotten the key by now
    await db().$executeRaw`UPDATE "OutboxMessage" SET "firstAttemptAt" = now() - interval '25 hours' WHERE id = ${row.id}`;
    await expireLeases();
    expect(await drain(deps, { onlyId: row.id })).toMatchObject({ needs_review: 1, done: 0 });
    expect(provider.requests).toHaveLength(1);
    expect(provider.delivered).toHaveLength(1);
    expect((await db().outboxMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("NEEDS_REVIEW");
  });

  it("a first attempt that happens late is still sent (nothing was ever accepted)", async () => {
    const row = await enqueueOne();
    await db().$executeRaw`UPDATE "OutboxMessage" SET "createdAt" = now() - interval '3 days', "availableAt" = now() - interval '3 days' WHERE id = ${row.id}`;
    const provider = new FakeIdempotentProvider();
    expect(await drain({ transport: provider, compose: compose("first@example.com"), workerId: "w1" }, { onlyId: row.id })).toMatchObject({ done: 1 });
    expect(provider.delivered).toHaveLength(1);
  });

  it("a transport error backs off and retries later", async () => {
    const row = await enqueueOne();
    const failing = { id: "boom", idempotent: false, send: async () => { throw new Error("connection refused"); } };
    expect(await drain({ transport: failing, compose: compose("x@example.com"), workerId: "w1" }, { onlyId: row.id })).toMatchObject({ retry: 1 });
    const r = await db().outboxMessage.findUniqueOrThrow({ where: { id: row.id } });
    expect(r.status).toBe("PENDING");
    expect(r.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(r.error).toContain("connection refused");
  });

  it("concurrent dispatchers never claim the same row twice", async () => {
    const rows = await Promise.all(Array.from({ length: 10 }, enqueueOne));
    const ids = rows.map((r) => r.id);
    const [a, b] = await Promise.all([claim(10), claim(10)]);
    const claimedIds = [...a, ...b].map((r) => r.id).filter((id) => ids.includes(id));
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
  });
});
