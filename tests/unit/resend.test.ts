import { describe, expect, it } from "vitest";
import { NeedsReviewError, ResendTransport, RetryLaterError } from "@/server/email/transport";

const msg = { to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" };
const fake = (status: number, body: unknown, seen: Request[] = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(new Request(url, init));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;

describe("ResendTransport", () => {
  it("sends the outbox key as Idempotency-Key", async () => {
    const seen: Request[] = [];
    const t = new ResendTransport("re_test", "from@x.test", fake(200, { id: "em_1" }, seen));
    expect(await t.send(msg, { idempotencyKey: "mail:app:1:approved" })).toEqual({ providerMessageId: "em_1" });
    expect(seen[0].headers.get("Idempotency-Key")).toBe("mail:app:1:approved");
    expect(t.idempotent).toBe(true);
    expect(t.idempotencyWindowMs).toBe(24 * 3_600_000);
  });

  it("409 invalid_idempotent_request needs review; 409 concurrent retries later", async () => {
    await expect(new ResendTransport("k", "f", fake(409, { name: "invalid_idempotent_request" })).send(msg, { idempotencyKey: "k1" })).rejects.toBeInstanceOf(NeedsReviewError);
    await expect(new ResendTransport("k", "f", fake(409, { name: "concurrent_idempotent_requests" })).send(msg, { idempotencyKey: "k1" })).rejects.toBeInstanceOf(RetryLaterError);
  });

  it("other errors are ordinary failures", async () => {
    await expect(new ResendTransport("k", "f", fake(500, {})).send(msg, { idempotencyKey: "k1" })).rejects.toThrow(/resend 500/);
  });
});
