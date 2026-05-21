import { uuidv7 } from "@/lib/ids";
import type { DbOrTx } from "@/server/db";
import { db } from "@/server/db";
import { faults, SimulatedCrash } from "@/server/faults";
import type { EmailTransport, OutgoingEmail } from "@/server/email/transport";

/** Who gets an email. Resolved (and decrypted) at send time, so the outbox never stores PII. */
export type Recipient =
  | { kind: "lead"; id: string }
  | { kind: "user"; id: string }
  | { kind: "reference"; id: string } // ReferenceRequest id -> landlord email on the residence
  | { kind: "agency-staff"; roles: string[] };

export interface EmailPayload {
  template: string;
  to: Recipient;
  params: Record<string, unknown>;
}

export interface DocumentPayload {
  kind: "LEASE" | "SIGNED_LEASE" | "SUMMARY" | "ADVERSE_ACTION";
  templateVersion: string;
  applicationId: string;
  leaseId?: string;
}

export async function enqueueEmail(client: DbOrTx, agencyId: string, key: string, payload: EmailPayload, availableAt?: Date) {
  await client.outboxMessage.createMany({
    data: [{ id: uuidv7(), agencyId, kind: "EMAIL", idempotencyKey: key, payload: payload as object, availableAt: availableAt ?? new Date() }],
    skipDuplicates: true,
  });
}

export async function enqueueDocument(client: DbOrTx, agencyId: string, key: string, payload: DocumentPayload) {
  await client.outboxMessage.createMany({
    data: [{ id: uuidv7(), agencyId, kind: "DOCUMENT", idempotencyKey: key, payload: payload as object }],
    skipDuplicates: true,
  });
}

export interface OutboxRow {
  id: string;
  agencyId: string;
  kind: "EMAIL" | "DOCUMENT";
  idempotencyKey: string;
  payload: EmailPayload | DocumentPayload;
  attempts: number;
  firstAttemptAt: Date | null;
}

export interface DispatchDeps {
  transport: EmailTransport;
  compose: (agencyId: string, p: EmailPayload, key: string) => Promise<OutgoingEmail | null>;
  renderDocument?: (row: OutboxRow & { payload: DocumentPayload }) => Promise<void>;
  workerId: string;
  leaseMs?: number;
  maxAttempts?: number;
  now?: () => Date;
}

/**
 * Claim due rows with a lease. A row stuck in SENDING past its lease (its worker died) is
 * claimable again; that's the retry path the delivery semantics below are about.
 */
export async function claim(limit = 20, leaseMs = 60_000, onlyId?: string): Promise<OutboxRow[]> {
  const only = onlyId ?? null;
  return db().$queryRaw<OutboxRow[]>`
    UPDATE "OutboxMessage" o
    SET status = 'SENDING', attempts = o.attempts + 1, "leaseUntil" = now() + (${leaseMs}::int * interval '1 millisecond'),
        "firstAttemptAt" = COALESCE(o."firstAttemptAt", now()), "lastAttemptAt" = now()
    WHERE o.id IN (
      SELECT id FROM "OutboxMessage"
      WHERE ((status = 'PENDING' AND "availableAt" <= now()) OR (status = 'SENDING' AND "leaseUntil" < now()))
        AND (${only}::text IS NULL OR id = ${only}::text)
      ORDER BY "availableAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING o.id, o."agencyId", o.kind, o."idempotencyKey", o.payload, o.attempts, o."firstAttemptAt"`;
}

export type DispatchOutcome = "done" | "needs_review" | "retry" | "failed" | "skipped";

export async function dispatchRow(row: OutboxRow, deps: DispatchDeps): Promise<DispatchOutcome> {
  const now = deps.now?.() ?? new Date();
  try {
    if (row.kind === "DOCUMENT") {
      if (!deps.renderDocument) throw new Error("no document renderer in this process");
      await deps.renderDocument(row as OutboxRow & { payload: DocumentPayload });
      faults.hit("outbox:after-render");
      await markDone(row.id, null, null);
      return "done";
    }

    const t = deps.transport;
    // An earlier attempt may have been accepted by the provider before we crashed. With an
    // idempotent provider a retry inside its dedupe window is safe; past the window it isn't,
    // so a person decides.
    if (t.idempotent && row.attempts > 1 && row.firstAttemptAt && now.getTime() - new Date(row.firstAttemptAt).getTime() > (t.idempotencyWindowMs ?? 0)) {
      await db().outboxMessage.updateMany({
        where: { id: row.id, status: "SENDING" },
        data: { status: "NEEDS_REVIEW", leaseUntil: null, error: "unconfirmed send outside the provider's idempotency window" },
      });
      return "needs_review";
    }

    const msg = await deps.compose(row.agencyId, row.payload as EmailPayload, row.idempotencyKey);
    if (!msg) {
      await markDone(row.id, t.id, "skipped");
      return "skipped";
    }
    const { providerMessageId } = await t.send(msg, { idempotencyKey: row.idempotencyKey });
    faults.hit("outbox:after-send");
    await markDone(row.id, t.id, providerMessageId);
    return "done";
  } catch (e) {
    if (e instanceof SimulatedCrash) throw e;
    const max = deps.maxAttempts ?? 8;
    const failed = row.attempts >= max;
    const backoffMs = Math.min(15 * 60_000, 2 ** row.attempts * 1000);
    await db().outboxMessage.updateMany({
      where: { id: row.id, status: "SENDING" },
      data: {
        status: failed ? "FAILED" : "PENDING",
        leaseUntil: null,
        availableAt: new Date(now.getTime() + backoffMs),
        error: e instanceof Error ? e.message.slice(0, 500) : String(e),
      },
    });
    return failed ? "failed" : "retry";
  }
}

async function markDone(id: string, transport: string | null, providerMessageId: string | null) {
  await db().outboxMessage.updateMany({
    where: { id, status: "SENDING" },
    data: { status: "DONE", doneAt: new Date(), leaseUntil: null, transport, providerMessageId, error: null },
  });
}

export async function drain(deps: DispatchDeps, opts: { max?: number; onlyId?: string } = {}) {
  const counts: Record<DispatchOutcome, number> = { done: 0, needs_review: 0, retry: 0, failed: 0, skipped: 0 };
  for (let i = 0; i < (opts.max ?? 10); i++) {
    const rows = await claim(20, deps.leaseMs, opts.onlyId);
    if (rows.length === 0) break;
    for (const r of rows) counts[await dispatchRow(r, deps)]++;
  }
  return counts;
}

