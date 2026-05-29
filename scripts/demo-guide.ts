import { existsSync } from "node:fs";
import { db } from "@/server/db";

if (existsSync(".env")) process.loadEnvFile(".env");

const appUrl = (process.env.APP_URL ?? "http://localhost:3041").replace(/\/$/, "");
const mailpitUrl = process.env.MAILPIT_URL ?? "http://localhost:8041";

async function main() {
  console.log("\n=======================================================");
  console.log("   LEASING MANAGEMENT — LOCAL DEMO WALKTHROUGH GUIDE   ");
  console.log("=======================================================\n");

  const orgCount = await db().organization.count();
  if (orgCount === 0) {
    console.log("⚠️ Database has not been seeded yet.");
    console.log("👉 Run: pnpm db:reset\n");
    return;
  }

  console.log("📍 SERVICES & PORTS:");
  console.log(`  • Web Application:  ${appUrl}`);
  console.log(`  • Mailpit Web UI:   ${mailpitUrl} (view all local emails, tokens, & ICS invites)`);
  console.log(`  • PostgreSQL:       localhost:${process.env.PG_PORT ?? 5441}`);
  console.log(`  • SMTP Server:      localhost:${process.env.SMTP_PORT ?? 1041}\n`);

  console.log("🏢 MULTI-TENANT AGENCIES:");
  console.log("  1. Bayview Property Group (Assisted Staff Approval Workflow)");
  console.log(`     • Public Listings:  ${appUrl}/bayview/listings`);
  console.log(`     • Staff Dashboard:  ${appUrl}/dashboard/bayview`);
  console.log(`     • Staff Login:      owner@bayview.test / demo-password-2026`);
  console.log(`     • Resident Portal:  ${appUrl}/bayview/portal (resident@bayview.test / demo-password-2026)`);
  console.log();
  console.log("  2. Peninsula Homes (Autonomous Auto-Approval Workflow)");
  console.log(`     • Public Listings:  ${appUrl}/peninsula/listings`);
  console.log(`     • Staff Dashboard:  ${appUrl}/dashboard/peninsula`);
  console.log(`     • Staff Login:      owner@peninsula.test / demo-password-2026\n`);

  console.log("📋 COMPLETE 5-STEP APPLICANT JOURNEY:");
  console.log(`  Step 1: Explore Listings & Schedule Showing`);
  console.log(`          Visit ${appUrl}/bayview/listings -> choose a unit -> book a showing slot.`);
  console.log(`          Open Mailpit (${mailpitUrl}) to inspect the confirmation email with .ics attachment.`);
  console.log();
  console.log(`  Step 2: Submit Application`);
  console.log(`          Visit ${appUrl}/bayview/apply -> complete 4-step identity, income, and reference form.`);
  console.log();
  console.log(`  Step 3: Reference Verification`);
  console.log(`          Open Mailpit (${mailpitUrl}) to find the reference request email with tokenized link.`);
  console.log(`          Open the link (${appUrl}/r/<token>) and submit reference verification.`);
  console.log();
  console.log(`  Step 4: Zero-PII Background Screening & Decision`);
  console.log(`          Sign into Staff Dashboard (${appUrl}/dashboard/bayview) as owner@bayview.test.`);
  console.log(`          Inspect applicant timeline, rubric score, and policy checks -> Record decision.`);
  console.log();
  console.log(`  Step 5: Digital Lease Signing & Resident Move-In`);
  console.log(`          Applicant receives lease email in Mailpit (${mailpitUrl}).`);
  console.log(`          Sign the lease -> Review signed PDF -> Resident account provisioned in Portal.`);
  console.log("\n=======================================================\n");
}

main().catch(console.error).finally(() => process.exit(0));
