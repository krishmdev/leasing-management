import { existsSync } from "node:fs";
import { resetDatabase } from "../../scripts/reset-db";

// Rebuild the leasing_test database from migrations once per run.
export default async function setup() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  await resetDatabase(url);
}
