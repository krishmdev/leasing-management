import { existsSync } from "node:fs";
import { afterAll } from "vitest";
import { createDb, setDb, db } from "@/server/db";
import { setKeyProvider } from "@/server/crypto/keyProvider";

if (existsSync(".env")) process.loadEnvFile(".env");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.LLM_PROVIDER = "offline";
setKeyProvider(undefined);
setDb(createDb(process.env.TEST_DATABASE_URL));

afterAll(async () => {
  await db().$disconnect();
});
