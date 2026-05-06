import { createHmac } from "node:crypto";
import { keys, type KeyProvider } from "./keyProvider";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/** HMAC(bidxKey, agencyId|field|normalized). Tenant-scoped, so the same email differs per agency. */
export function blindIndex(agencyId: string, field: string, normalized: string, kp: KeyProvider = keys()): string {
  return createHmac("sha256", kp.blindIndexKey()).update(`${agencyId}|${field}|${normalized}`).digest("base64url");
}

export const emailBidx = (agencyId: string, email: string, kp?: KeyProvider) =>
  blindIndex(agencyId, "email", normalizeEmail(email), kp);
