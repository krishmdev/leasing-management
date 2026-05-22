import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { keys, type KeyProvider } from "./keyProvider";

export type TokenPurpose = "showing" | "reference" | "lease";

/**
 * Link tokens are derived, not stored: token = base64url(HMAC(TOKEN_KEY, purpose|rowId|version)).
 * The database keeps only sha256(token). Anything that needs the link later (an email render, a
 * retry of that render) recomputes it from the row, so outbox payloads never carry a token.
 * Reissuing a link means bumping tokenVersion, which also invalidates the old one.
 */
export function deriveToken(purpose: TokenPurpose, rowId: string, version: number, kp: KeyProvider = keys()): { token: string; hash: string } {
  const token = createHmac("sha256", kp.tokenKey()).update(`${purpose}|${rowId}|${version}`).digest("base64url");
  return { token, hash: hashToken(token) };
}

/** 32 random bytes, base64url, for tokens that are never re-sent (none today besides tests). */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenMatches(token: string, hash: string): boolean {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Stable JSON: sorted keys, so equal objects hash equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
