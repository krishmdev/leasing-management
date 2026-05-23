import { Prisma } from "@/generated/prisma/client";
import { pgCode } from "@/server/db";

const RETRYABLE = new Set(["40P01", "40001"]);

export function isRetryableTxError(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") return true;
  const c = pgCode(e);
  return c !== undefined && RETRYABLE.has(c);
}

/** Re-run a whole transaction on deadlock or serialization failure, a bounded number of times. */
export async function withTxRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRetryableTxError(e) || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 15 * 2 ** i + Math.random() * 25));
    }
  }
}
