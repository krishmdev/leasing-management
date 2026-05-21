import type { EmailTransport, OutgoingEmail } from "@/server/email/transport";

/** Stand-in for an HTTP provider that dedupes on Idempotency-Key within a window (like Resend). */
export class FakeIdempotentProvider implements EmailTransport {
  readonly id = "fake-idempotent";
  readonly idempotent = true;
  readonly delivered: OutgoingEmail[] = [];
  readonly requests: string[] = [];
  private readonly seen = new Map<string, { id: string; at: number }>();

  constructor(readonly idempotencyWindowMs = 24 * 3_600_000, private readonly clock: () => number = Date.now) {}

  async send(msg: OutgoingEmail, { idempotencyKey }: { idempotencyKey: string }) {
    this.requests.push(idempotencyKey);
    const prior = this.seen.get(idempotencyKey);
    if (prior && this.clock() - prior.at <= this.idempotencyWindowMs) return { providerMessageId: prior.id };
    const id = `fake_${this.delivered.length + 1}`;
    this.delivered.push(msg);
    this.seen.set(idempotencyKey, { id, at: this.clock() });
    return { providerMessageId: id };
  }
}
