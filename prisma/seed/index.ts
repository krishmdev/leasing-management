import { existsSync } from "node:fs";
import { db } from "@/server/db";
import { boss, ensureQueues } from "@/server/jobs/queues";
import { drain } from "@/server/outbox/outbox";
import { composeEmail } from "@/server/email/compose";
import { checkSla } from "@/server/domain/maintenance/sla";
import { signLease } from "@/server/domain/leases/sign";
import { deriveToken } from "@/server/crypto/tokens";
import { emailBidx } from "@/server/crypto/blindIndex";
import { renderDocument } from "@/worker/documents/render";
import { seedAgencies } from "./agencies";
import { seedListings } from "./listings";
import { seedAvailability, seedFunnel } from "./funnel";
import { BAYVIEW_PERSONAS, PENINSULA_PERSONAS, seedApplicant } from "./applications";
import { isListed, seedHistory, seedTickets } from "./history";

if (existsSync(".env")) process.loadEnvFile(".env");

/**
 * Deterministic demo data, built through the domain services (with the offline model), so the
 * audit log, agent timelines and documents look like real use. Seed-time emails are marked
 * sent without delivering them; Mailpit only shows what you do after seeding.
 */
async function main() {
  if ((await db().organization.count()) > 0) {
    console.log("database already seeded; run pnpm db:reset to start over");
    return;
  }
  process.env.LLM_PROVIDER = "offline";
  await ensureQueues(await boss("worker"));
  const agencies = await seedAgencies();
  const sink = { id: "seed", idempotent: false, send: async () => ({ providerMessageId: "seed-suppressed" }) };

  for (const [slug, a] of Object.entries(agencies)) {
    const agents = Object.entries(a.staff).filter(([e]) => e.startsWith("agent")).map(([, id]) => id);
    const owner = a.staff[`owner@${slug}.test`];
    const maint = a.staff[`maintenance@${slug}.test`];
    const units = await seedListings(a.id, slug, agents);
    await seedAvailability(a.id, agents, slug === "bayview" ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);
    const listed = units.filter(isListed);
    const residencies = await seedHistory(a.id, units, slug === "bayview" ? 7 : 8, slug === "bayview" ? { residentEmail: "resident@bayview.test" } : {});
    await seedFunnel(a.id, listed, owner, slug === "bayview" ? 11 : 12);
    const personas = slug === "bayview" ? BAYVIEW_PERSONAS : PENINSULA_PERSONAS;
    for (const p of personas) {
      const u = listed[p.unitIndex % listed.length];
      await seedApplicant(a.id, u, p);
      const app = await db().application.findFirst({ where: { agencyId: a.id, lead: { emailBidx: emailBidx(a.id, p.email) } } });
      console.log(`  ${slug}/${p.key}: ${app?.status}`);
    }
    if (slug === "peninsula") {
      // Dana signs her lease, so there's a signed document and a new residency to look at.
      await drain({ transport: sink, compose: composeEmail, renderDocument, workerId: "seed" }, { max: 50 });
      const app = await db().application.findFirstOrThrow({ where: { agencyId: a.id, lead: { emailBidx: emailBidx(a.id, "dana.whitfield@example.com") } }, include: { lease: true } });
      const doc = await db().generatedDocument.findFirstOrThrow({ where: { applicationId: app.id, kind: "LEASE" } });
      const r = await signLease(deriveToken("lease", app.lease!.id, app.lease!.tokenVersion).token, { typedName: "Dana Whitfield", docSha256: doc.sha256, consent: true }, { ip: "127.0.0.1", ua: "seed" });
      console.log(`  peninsula/dana signed: HTTP ${r.http}`);
    }
    await seedTickets(a.id, residencies, maint, slug === "bayview" ? 15 : 10, slug === "bayview" ? 0 : 5);
    console.log(`${slug}: ${units.length} units, ${residencies.length} residencies`);
  }
  await checkSla();

  const r = await drain({ transport: sink, compose: composeEmail, renderDocument, workerId: "seed" }, { max: 200 });
  console.log(`outbox: ${r.done} done (emails suppressed, documents rendered)`);
  const statuses = await db().application.groupBy({ by: ["status"], _count: true });
  console.log(statuses.map((s) => `${s.status}=${s._count}`).join(" "));
}

main()
  .then(async () => {
    await (await boss()).stop({ graceful: false, timeout: 2000 }).catch(() => undefined);
    await db().$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await db().$disconnect();
    process.exit(1);
  });
