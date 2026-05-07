import nodemailer, { type Transporter } from "nodemailer";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: string | Buffer; contentType: string }[];
  /** Stable per logical message so clients that do dedupe can. */
  messageId?: string;
}

/**
 * Delivery contract, per transport:
 * - `idempotent: true` means the provider dedupes on `idempotencyKey` for `idempotencyWindowMs`.
 *   A retry inside the window sends at most one email. Outside the window the dispatcher stops
 *   and flags the row for review instead of risking a duplicate.
 * - `idempotent: false` (SMTP) is at-least-once. A crash after the server accepted the message
 *   but before the outbox row is marked done will send it again.
 */
export interface EmailTransport {
  readonly id: string;
  readonly idempotent: boolean;
  readonly idempotencyWindowMs?: number;
  send(msg: OutgoingEmail, opts: { idempotencyKey: string }): Promise<{ providerMessageId: string }>;
}

export class SmtpTransport implements EmailTransport {
  readonly id = "smtp";
  readonly idempotent = false;
  private readonly tx: Transporter;

  constructor(
    private readonly from = process.env.MAIL_FROM ?? "Leasing Desk <no-reply@leasing.test>",
    host = process.env.SMTP_HOST ?? "127.0.0.1",
    port = Number(process.env.SMTP_PORT ?? 1041),
  ) {
    this.tx = nodemailer.createTransport({ host, port, secure: false, ignoreTLS: true });
  }

  async send(msg: OutgoingEmail, opts: { idempotencyKey: string }) {
    const info = await this.tx.sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      messageId: msg.messageId,
      headers: { "X-Outbox-Key": opts.idempotencyKey },
      attachments: msg.attachments,
    });
    return { providerMessageId: String(info.messageId) };
  }
}

/**
 * Resend's HTTP API dedupes on the Idempotency-Key header. Per their docs (checked 2026-05-28):
 * keys are kept for 24 hours, max 256 chars; the same key with the same payload returns the
 * original email id, with a different payload a 409. Not exercised live in this repo.
 */
export class ResendTransport implements EmailTransport {
  readonly id = "resend";
  readonly idempotent = true;
  readonly idempotencyWindowMs = 24 * 60 * 60 * 1000;

  constructor(
    private readonly apiKey = process.env.RESEND_API_KEY ?? "",
    private readonly from = process.env.MAIL_FROM ?? "",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(msg: OutgoingEmail, opts: { idempotencyKey: string }) {
    if (!this.apiKey) throw new Error("RESEND_API_KEY is not set");
    if (opts.idempotencyKey.length > 256) throw new Error("idempotency key longer than 256 chars");
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": opts.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        attachments: msg.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content).toString("base64"),
          content_type: a.contentType,
        })),
      }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { id: string };
    return { providerMessageId: body.id };
  }
}

let cached: EmailTransport | undefined;
export function transport(): EmailTransport {
  cached ??= process.env.EMAIL_TRANSPORT === "resend" ? new ResendTransport() : new SmtpTransport();
  return cached;
}
export function setTransport(t: EmailTransport | undefined) {
  cached = t;
}
