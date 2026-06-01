// pnpm pii:purge [--dry-run]
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
const { purgeExpired } = await import("@/server/domain/retention/purge");
const { db } = await import("@/server/db");
const dryRun = process.argv.includes("--dry-run");
console.log(JSON.stringify({ dryRun, ...(await purgeExpired({ dryRun })) }, null, 2));
await db().$disconnect();
