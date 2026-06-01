import { uuidv7 } from "@/lib/ids";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { faults, SimulatedCrash } from "@/server/faults";
import { canonicalJson, sha256Hex } from "@/server/crypto/tokens";
import { NeedsReviewError, RetryLaterError, type EmailTransport, type OutgoingEmail } from "@/server/email/transport";

/** Stop retrying this long before the provider's dedupe window closes, to allow for clock skew and slow requests. */
export const WINDOW_MARGIN_MS = 5 * 60_000;

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

/** Anything with an outboxMessage delegate (base or tenant client, or a transaction of either). */
type OutboxClient = { outboxMessage: { createMany(args: { data: Prisma.OutboxMessageCreateManyInput[]; skipDuplicates?: boolean }): Promise<unknown> } };

export async function enqueueEmail(client: OutboxClient, agencyId: string, key: string, payload: EmailPayload, availableAt?: Date) {
  await client.outboxMessage.createMany({
    data: [{ id: uuidv7(), agencyId, kind: "EMAIL", idempotencyKey: key, payload: payload as unknown as Prisma.InputJsonObject, ...(availableAt ? { availableAt } : {}) }],
    skipDuplicates: true,
  });
}

export async function enqueueDocument(client: OutboxClient, agencyId: string, key: string, payload: DocumentPayload) {
  await client.outboxMessage.createMany({
    data: [{ id: uuidv7(), agencyId, kind: "DOCUMENT", idempotencyKey: key, payload: payload as unknown as Prisma.InputJsonObject }],
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
  renderedSha256: string | null;
}

export interface DispatchDeps {
  transport: EmailTransport;
  compose: (agencyId: string, p: EmailPayload, key: string) => Promise<OutgoingEmail | null>;
  renderDocument?: (row: OutboxRow & { payload: DocumentPayload }) => Promise<unknown>;
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
    SET status = 'SENDING', attempts = o.attempts + 1, "leaseUntil" = clock_timestamp() + (${leaseMs}::int * interval '1 millisecond'),
        "firstAttemptAt" = COALESCE(o."firstAttemptAt", clock_timestamp()), "lastAttemptAt" = clock_timestamp()
    WHERE o.id IN (
      SELECT id FROM "OutboxMessage"
      WHERE ((status = 'PENDING' AND "availableAt" <= clock_timestamp()) OR (status = 'SENDING' AND "leaseUntil" < clock_timestamp()))
        AND (${only}::text IS NULL OR id = ${only}::text)
      ORDER BY "availableAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING o.id, o."agencyId", o.kind, o."idempotencyKey", o.payload, o.attempts, o."firstAttemptAt", o."renderedSha256"`;
}

export type DispatchOutcome = "done" | "needs_review" | "retry" | "failed" | "skipped";

export async function dispatchRow(row: OutboxRow, deps: DispatchDeps): Promise<DispatchOutcome> {
  const now = deps.now?.() ?? new Date();
  try {
    if (row.kind === "DOCUMENT") {
      if (!deps.renderDocument) throw new Error("no document renderer in this process");
      await deps.renderDocument(row as OutboxRow & { payload: DocumentPayload });
      faults.hit("outbox:after-render");
      await markDone(row, null, null);
      return "done";
    }

    const t = deps.transport;
    // An earlier attempt may have been accepted by the provider before we crashed. With an
    // idempotent provider a retry inside its dedupe window is safe; past the window it isn't,
    // so a person decides.
    if (
      t.idempotent &&
      row.attempts > 1 &&
      row.firstAttemptAt &&
      now.getTime() - new Date(row.firstAttemptAt).getTime() > (t.idempotencyWindowMs ?? 0) - WINDOW_MARGIN_MS
    ) {
      return needsReview(row, "unconfirmed send outside the provider's idempotency window");
    }

    const msg = await deps.compose(row.agencyId, row.payload as EmailPayload, row.idempotencyKey);
    if (!msg) {
      await markDone(row, t.id, "skipped");
      return "skipped";
    }
    // Renders are deterministic from row state. If a retry renders something different from the
    // first attempt, an idempotent provider would reject it (and SMTP would send a different
    // email), so record the first render's hash and compare.
    const sha = sha256Hex(canonicalJson({ to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, att: msg.attachments?.map((a) => [a.filename, sha256Hex(a.content)]) }));
    if (!row.renderedSha256) {
      await db().outboxMessage.updateMany({ where: { id: row.id, attempts: row.attempts, status: "SENDING" }, data: { renderedSha256: sha } });
    } else if (row.renderedSha256 !== sha && t.idempotent) {
      return needsReview(row, "render changed between attempts");
    }
    const { providerMessageId } = await t.send(msg, { idempotencyKey: row.idempotencyKey });
    faults.hit("outbox:after-send");
    await markDone(row, t.id, providerMessageId);
    const p = row.payload as EmailPayload;
    if (p.template === "application.adverse_action") {
      // The FCRA notice counts as sent when its email is accepted, not when it was queued.
      await db().adverseActionNotice.updateMany({ where: { applicationId: String(p.params.applicationId), sentAt: null }, data: { sentAt: new Date() } });
    }
    return "done";
  } catch (e) {
    if (e instanceof SimulatedCrash) throw e;
    if (e instanceof NeedsReviewError) return needsReview(row, e.message);
    const max = deps.maxAttempts ?? 8;
    const failed = row.attempts >= max && !(e instanceof RetryLaterError);
    const backoffMs = e instanceof RetryLaterError ? e.afterMs : Math.min(15 * 60_000, 2 ** row.attempts * 1000);
    await db().outboxMessage.updateMany({
      where: { id: row.id, status: "SENDING", attempts: row.attempts },
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

async function needsReview(row: OutboxRow, reason: string): Promise<DispatchOutcome> {
  await db().outboxMessage.updateMany({
    where: { id: row.id, status: "SENDING", attempts: row.attempts },
    data: { status: "NEEDS_REVIEW", leaseUntil: null, error: reason },
  });
  return "needs_review";
}

/** Conditional on the attempt number: a worker whose lease ran out and was superseded can't mark done. */
async function markDone(row: OutboxRow, transport: string | null, providerMessageId: string | null) {
  await db().outboxMessage.updateMany({
    where: { id: row.id, status: "SENDING", attempts: row.attempts },
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

