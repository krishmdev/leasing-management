/**
 * Where encryption keys come from. The env implementation is what runs here; a KMS-backed one
 * would implement the same interface (and could cache data keys).
 */
export interface KeyProvider {
  activeKeyId(): string;
  dataKey(keyId: string): Buffer;
  blindIndexKey(): Buffer;
  /** HMAC key for link tokens (showing, reference, lease). */
  tokenKey(): Buffer;
  keyIds(): string[];
}

export class EnvKeyProvider implements KeyProvider {
  private readonly ring: Map<string, Buffer>;
  private readonly active: string;
  private readonly bidx: Buffer;
  private readonly tok: Buffer;

  constructor(env: Record<string, string | undefined> = process.env) {
    if (!env.PII_KEYRING || !env.PII_ACTIVE_KEY_ID || !env.PII_BLIND_INDEX_KEY) {
      throw new Error("PII_KEYRING, PII_ACTIVE_KEY_ID and PII_BLIND_INDEX_KEY must be set (run pnpm bootstrap)");
    }
    const parsed = JSON.parse(env.PII_KEYRING) as Record<string, string>;
    this.ring = new Map(Object.entries(parsed).map(([id, b64]) => [id, decode32(b64, `key ${id}`)]));
    if (!this.ring.has(env.PII_ACTIVE_KEY_ID)) throw new Error(`active key ${env.PII_ACTIVE_KEY_ID} not in keyring`);
    for (const id of this.ring.keys()) {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`key id ${id} must be [A-Za-z0-9_-]`);
    }
    this.active = env.PII_ACTIVE_KEY_ID;
    this.bidx = decode32(env.PII_BLIND_INDEX_KEY, "blind index key");
    if (!env.TOKEN_KEY) throw new Error("TOKEN_KEY must be set (run pnpm bootstrap)");
    this.tok = decode32(env.TOKEN_KEY, "token key");
  }

  activeKeyId() {
    return this.active;
  }

  dataKey(keyId: string) {
    const k = this.ring.get(keyId);
    if (!k) throw new Error(`unknown key id ${keyId}`);
    return k;
  }

  blindIndexKey() {
    return this.bidx;
  }

  tokenKey() {
    return this.tok;
  }

  keyIds() {
    return [...this.ring.keys()];
  }
}

function decode32(b64: string, what: string): Buffer {
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== 32) throw new Error(`${what} must be 32 bytes, got ${buf.length}`);
  return buf;
}

let cached: KeyProvider | undefined;
export function keys(): KeyProvider {
  cached ??= new EnvKeyProvider();
  return cached;
}
export function setKeyProvider(p: KeyProvider | undefined) {
  cached = p;
}
