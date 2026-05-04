import { defineConfig } from "prisma/config";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed/index.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://leasing:leasing@localhost:5441/leasing",
  },
});
