// Drop everything (public + the mock provider's schema) and re-apply migrations.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import pg from "pg";

export async function resetDatabase(url: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS mockcra CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  } finally {
    await client.end();
  }
  try {
    execSync("pnpm exec prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" } });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`migrate deploy failed:\n${err.stdout?.toString() ?? ""}\n${err.stderr?.toString() ?? ""}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  await resetDatabase(process.env.DATABASE_URL!);
  console.log("database reset");
}
