import { existsSync } from "node:fs";
import { db } from "@/server/db";
import { seedAgencies } from "./agencies";
import { seedListings } from "./listings";

if (existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  if ((await db().organization.count()) > 0) {
    console.log("database already seeded; run pnpm db:reset to start over");
    return;
  }
  const agencies = await seedAgencies();
  for (const [slug, a] of Object.entries(agencies)) {
    const agents = Object.entries(a.staff).filter(([e]) => e.startsWith("agent")).map(([, id]) => id);
    const units = await seedListings(a.id, slug, agents);
    console.log(`${slug}: ${units.length} units`);
  }
}

main()
  .then(() => db().$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db().$disconnect();
    process.exit(1);
  });
