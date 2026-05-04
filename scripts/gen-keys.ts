import { randomBytes } from "node:crypto";

// Prints fresh secrets as KEY=value lines. bootstrap.ts uses this to fill a new .env.
export function freshSecrets(): Record<string, string> {
  const keyId = `k${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
  return {
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
    PII_KEYRING: JSON.stringify({ [keyId]: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: keyId,
    PII_BLIND_INDEX_KEY: randomBytes(32).toString("base64"),
    MOCKCRA_WEBHOOK_SECRET: randomBytes(24).toString("base64url"),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [k, v] of Object.entries(freshSecrets())) console.log(`${k}='${v}'`);
}
