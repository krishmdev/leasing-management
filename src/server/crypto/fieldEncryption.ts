import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { UUID_RE } from "@/lib/ids";
import { keys, type KeyProvider } from "./keyProvider";

/**
 * AES-256-GCM for individual columns.
 *
 * Stored form: `enc:v1:{keyId}:{base64(iv | ciphertext | tag)}`.
 *
 * The AAD binds the ciphertext to exactly one place:
 *   enc:v1|key:{keyId}|agency:{agencyId}|{model}|id:{recordId}|{field}
 * so a value copied to another row, another column or another tenant fails to decrypt. Record ids
 * are UUIDv7s minted by the app before insert and frozen by a trigger, so the AAD is known at
 * encrypt time and never changes afterwards.
 */
export interface FieldRef {
  agencyId: string;
  model: string;
  id: string;
  field: string;
}

const ENVELOPE = "v1";
const IV_LEN = 12;
const TAG_LEN = 16;

export class DecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptError";
  }
}

export function aadFor(ref: FieldRef, keyId: string): Buffer {
  if (!UUID_RE.test(ref.id)) throw new Error(`record id for ${ref.model}.${ref.field} must be a UUID`);
  if (!ref.agencyId) throw new Error("agencyId is required for field encryption");
  return Buffer.from(`enc:${ENVELOPE}|key:${keyId}|agency:${ref.agencyId}|${ref.model}|id:${ref.id}|${ref.field}`, "utf8");
}

export function encryptField(ref: FieldRef, plaintext: string, kp: KeyProvider = keys()): string {
  const keyId = kp.activeKeyId();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", kp.dataKey(keyId), iv);
  cipher.setAAD(aadFor(ref, keyId));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${ENVELOPE}:${keyId}:${Buffer.concat([iv, ct, tag]).toString("base64")}`;
}

export function envelopeKeyId(stored: string): string {
  return parse(stored).keyId;
}

export function decryptField(ref: FieldRef, stored: string, kp: KeyProvider = keys()): string {
  const { keyId, blob } = parse(stored);
  if (blob.length < IV_LEN + TAG_LEN) throw new DecryptError("ciphertext too short");
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ct = blob.subarray(IV_LEN, blob.length - TAG_LEN);
  try {
    const decipher = createDecipheriv("aes-256-gcm", kp.dataKey(keyId), iv);
    decipher.setAAD(aadFor(ref, keyId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new DecryptError(`cannot decrypt ${ref.model}.${ref.field} for record ${ref.id}`);
  }
}

/** Re-encrypt under the active key. Same record, same field, same tenant; only keyId changes. */
export function reencryptField(ref: FieldRef, stored: string, kp: KeyProvider = keys()): string {
  if (envelopeKeyId(stored) === kp.activeKeyId()) return stored;
  return encryptField(ref, decryptField(ref, stored, kp), kp);
}

function parse(stored: string): { keyId: string; blob: Buffer } {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "enc" || parts[1] !== ENVELOPE) {
    throw new DecryptError("not a v1 field envelope");
  }
  return { keyId: parts[2], blob: Buffer.from(parts[3], "base64") };
}

export function encOpt(ref: FieldRef, v: string | null | undefined, kp?: KeyProvider): string | null {
  return v == null || v === "" ? null : encryptField(ref, v, kp);
}

export function decOpt(ref: FieldRef, v: string | null | undefined, kp?: KeyProvider): string | null {
  return v == null ? null : decryptField(ref, v, kp);
}

/** Helper for one record: `const f = fields({agencyId, model:'Lead', id}); f.enc('emailEnc', x)`. */
export function fields(rec: Omit<FieldRef, "field">, kp?: KeyProvider) {
  return {
    enc: (field: string, v: string) => encryptField({ ...rec, field }, v, kp),
    encOpt: (field: string, v: string | null | undefined) => encOpt({ ...rec, field }, v, kp),
    dec: (field: string, v: string) => decryptField({ ...rec, field }, v, kp),
    decOpt: (field: string, v: string | null | undefined) => decOpt({ ...rec, field }, v, kp),
  };
}
