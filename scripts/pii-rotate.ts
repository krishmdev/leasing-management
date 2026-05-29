// pnpm pii:rotate [--dry-run]
// Add a new key to PII_KEYRING, point PII_ACTIVE_KEY_ID at it, then run this.
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
const { rotateAll } = await import("@/server/crypto/rotate");
const { db } = await import("@/server/db");
const dryRun = process.argv.includes("--dry-run");
const { rows, failures } = await rotateAll({ dryRun });
console.log(JSON.stringify({ dryRun, rowsReencrypted: rows, undecryptable: failures }, null, 2));
if (failures.length) process.exitCode = 1;
await db().$disconnect();
