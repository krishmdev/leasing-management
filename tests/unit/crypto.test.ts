import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { uuidv7, UUID_RE } from "@/lib/ids";
import { EnvKeyProvider } from "@/server/crypto/keyProvider";
import {
  DecryptError,
  decryptField,
  encryptField,
  envelopeKeyId,
  reencryptField,
  type FieldRef,
} from "@/server/crypto/fieldEncryption";
import { blindIndex, emailBidx, normalizeEmail, normalizePhone } from "@/server/crypto/blindIndex";
import { hashToken, newToken, tokenMatches, canonicalJson } from "@/server/crypto/tokens";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const bidx = randomBytes(32).toString("base64");
const ring1 = new EnvKeyProvider({ PII_KEYRING: JSON.stringify({ a: k1 }), PII_ACTIVE_KEY_ID: "a", PII_BLIND_INDEX_KEY: bidx });
const ring2 = new EnvKeyProvider({ PII_KEYRING: JSON.stringify({ a: k1, b: k2 }), PII_ACTIVE_KEY_ID: "b", PII_BLIND_INDEX_KEY: bidx });

const agencyA = uuidv7();
const agencyB = uuidv7();
const ref = (over: Partial<FieldRef> = {}): FieldRef => ({
  agencyId: agencyA,
  model: "Application",
  id: "0192f3a4-5b6c-7d8e-9fa0-b1c2d3e4f501",
  field: "legalNameEnc",
  ...over,
});

describe("uuidv7", () => {
  it("is a v7 uuid and sorts by time", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(UUID_RE);
    expect(a[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(a[19]);
    expect(a < b).toBe(true);
  });
});

describe("field encryption", () => {
  it("round-trips arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (s) => {
        expect(decryptField(ref(), encryptField(ref(), s, ring1), ring1)).toBe(s);
      }),
    );
  });

  it("uses a fresh IV every time", () => {
    expect(encryptField(ref(), "Maya Chen", ring1)).not.toBe(encryptField(ref(), "Maya Chen", ring1));
  });

  it("fails when the ciphertext is copied to another record", () => {
    const ct = encryptField(ref(), "Maya Chen", ring1);
    expect(() => decryptField(ref({ id: uuidv7() }), ct, ring1)).toThrow(DecryptError);
  });

  it("fails when copied to another field of the same record", () => {
    const ct = encryptField(ref({ field: "legalNameEnc" }), "Maya Chen", ring1);
    expect(() => decryptField(ref({ field: "phoneEnc" }), ct, ring1)).toThrow(DecryptError);
  });

  it("fails when copied to another tenant", () => {
    const ct = encryptField(ref({ agencyId: agencyA }), "Maya Chen", ring1);
    expect(() => decryptField(ref({ agencyId: agencyB }), ct, ring1)).toThrow(DecryptError);
  });

  it("fails when copied to another model with the same id", () => {
    const ct = encryptField(ref({ model: "Lead" }), "x@y.z", ring1);
    expect(() => decryptField(ref({ model: "ResidenceHistory" }), ct, ring1)).toThrow(DecryptError);
  });

  it("fails when the auth tag or body is tampered with", () => {
    const ct = encryptField(ref(), "Maya Chen", ring1);
    const [p, v, kid, b64] = ct.split(":");
    const blob = Buffer.from(b64, "base64");
    for (const i of [0, 13, blob.length - 1]) {
      const bad = Buffer.from(blob);
      bad[i] ^= 0x01;
      expect(() => decryptField(ref(), [p, v, kid, bad.toString("base64")].join(":"), ring1)).toThrow(DecryptError);
    }
  });

  it("fails when the key id in the envelope is swapped", () => {
    const ct = encryptField(ref(), "Maya Chen", ring2); // key b
    const forged = ct.replace(":b:", ":a:");
    expect(() => decryptField(ref(), forged, ring2)).toThrow(DecryptError);
  });

  it("refuses non-UUID record ids, so AAD is always bound to a real identity", () => {
    expect(() => encryptField(ref({ id: "" }), "x", ring1)).toThrow();
    expect(() => encryptField(ref({ id: "cuid-like-123" }), "x", ring1)).toThrow();
  });

  it("rotation re-encrypts under the active key and keeps the record binding", () => {
    const old = encryptField(ref(), "Maya Chen", ring1);
    expect(envelopeKeyId(old)).toBe("a");
    const rotated = reencryptField(ref(), old, ring2);
    expect(envelopeKeyId(rotated)).toBe("b");
    expect(decryptField(ref(), rotated, ring2)).toBe("Maya Chen");
    expect(() => decryptField(ref({ id: uuidv7() }), rotated, ring2)).toThrow(DecryptError);
    // old ciphertext still readable while key a stays in the ring
    expect(decryptField(ref(), old, ring2)).toBe("Maya Chen");
    expect(reencryptField(ref(), rotated, ring2)).toBe(rotated);
  });

  it("rejects bad keyrings", () => {
    expect(() => new EnvKeyProvider({ PII_KEYRING: JSON.stringify({ a: "c2hvcnQ=" }), PII_ACTIVE_KEY_ID: "a", PII_BLIND_INDEX_KEY: bidx })).toThrow(/32 bytes/);
    expect(() => new EnvKeyProvider({ PII_KEYRING: JSON.stringify({ a: k1 }), PII_ACTIVE_KEY_ID: "z", PII_BLIND_INDEX_KEY: bidx })).toThrow(/not in keyring/);
  });
});

describe("blind index", () => {
  it("normalizes email case and whitespace", () => {
    expect(normalizeEmail("  Maya.Chen@Example.COM ")).toBe("maya.chen@example.com");
    expect(emailBidx(agencyA, "Maya.Chen@example.com", ring1)).toBe(emailBidx(agencyA, " maya.chen@EXAMPLE.com", ring1));
  });

  it("is tenant- and field-scoped", () => {
    expect(emailBidx(agencyA, "a@b.c", ring1)).not.toBe(emailBidx(agencyB, "a@b.c", ring1));
    expect(blindIndex(agencyA, "email", "5105550100", ring1)).not.toBe(blindIndex(agencyA, "phone", "5105550100", ring1));
  });

  it("normalizes US phone numbers", () => {
    expect(normalizePhone("+1 (510) 555-0100")).toBe("5105550100");
    expect(normalizePhone("510.555.0100")).toBe("5105550100");
  });
});

describe("tokens", () => {
  it("stores only a hash and matches in constant time", () => {
    const { token, hash } = newToken();
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
    expect(tokenMatches(token, hash)).toBe(true);
    expect(tokenMatches(token + "x", hash)).toBe(false);
    expect(Buffer.from(token, "base64url").length).toBe(32);
  });

  it("canonical JSON ignores key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(canonicalJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }));
  });
});
