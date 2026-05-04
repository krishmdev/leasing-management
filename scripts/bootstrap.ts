// First-run setup: .env with generated keys, containers up, migrations, seed.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { freshSecrets } from "./gen-keys";

const run = (cmd: string) => execSync(cmd, { stdio: "inherit", env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" } });

if (!existsSync(".env")) {
  const secrets = freshSecrets();
  const lines = readFileSync(".env.example", "utf8")
    .split("\n")
    .map((line) => {
      const key = line.split("=")[0];
      return key in secrets && line.endsWith("=") ? `${key}='${secrets[key]}'` : line;
    });
  writeFileSync(".env", lines.join("\n"), { mode: 0o600 });
  console.log("wrote .env with fresh keys");
}

run("docker compose up -d --wait");
run("pnpm exec prisma generate");
run("pnpm exec prisma migrate deploy");
if (!process.argv.includes("--no-seed")) run("pnpm db:seed");
