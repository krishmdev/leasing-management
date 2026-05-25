import { existsSync } from "node:fs";
import { afterAll, beforeAll } from "vitest";
import { createDb, setDb, db } from "@/server/db";
import { setKeyProvider } from "@/server/crypto/keyProvider";

if (existsSync(".env")) process.loadEnvFile(".env");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.LLM_PROVIDER = "offline";
setKeyProvider(undefined);
process.env.STORAGE_DIR = "storage/test";
process.env.APP_URL = "http://localhost:3041";
setDb(createDb(process.env.TEST_DATABASE_URL));

// pg-boss needs its schema; jobs sent by the code under test just sit in the queue, and tests
// call the job handlers directly.
beforeAll(async () => {
  const { boss, ensureQueues } = await import("@/server/jobs/queues");
  await ensureQueues(await boss("worker"));
});

afterAll(async () => {
  const { boss } = await import("@/server/jobs/queues");
  await (await boss()).stop({ graceful: false, timeout: 1000 }).catch(() => undefined);
  await db().$disconnect();
});
