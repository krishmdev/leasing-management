import { uuidv7 } from "@/lib/ids";
import { db } from "@/server/db";
import { fields } from "@/server/crypto/fieldEncryption";
import { emailBidx } from "@/server/crypto/blindIndex";

/** Empty every table (audit triggers included) between test files. */
export async function resetDb() {
  const rows = await db().$queryRaw<{ t: string }[]>`
    SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables
    WHERE schemaname IN ('public', 'mockcra') AND tablename <> '_prisma_migrations'`;
  await db().$transaction([
    db().$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
    db().$executeRawUnsafe(`TRUNCATE ${rows.map((r) => r.t).join(", ")} CASCADE`),
  ]);
}

export async function makeAgency(slug = `agency-${uuidv7().slice(-6)}`, opts: { automation?: object; paused?: boolean } = {}) {
  const org = await db().organization.create({ data: { id: uuidv7(), name: slug, slug, createdAt: new Date() } });
  await db().agencySettings.create({
    data: {
      agencyId: org.id,
      theme: {},
      contact: {},
      automation: opts.automation ?? { level: "ASSISTED" },
      retention: {},
      automationPaused: opts.paused ?? false,
    },
  });
  return org;
}

export async function makeUnit(agencyId: string, over: { rentCents?: number; slug?: string } = {}) {
  const property = await db().property.create({
    data: { agencyId, name: "Test Flats", street: "1 Main St", city: "Oakland", zip: "94612", amenities: [], description: "" },
  });
  return db().unit.create({
    data: {
      agencyId,
      propertyId: property.id,
      slug: over.slug ?? `u-${uuidv7().slice(-8)}`,
      label: "Unit 1",
      beds: 2,
      baths: 1,
      sqft: 850,
      rentCents: over.rentCents ?? 300000,
      depositCents: 300000,
      availableOn: new Date("2026-10-01"),
      description: "",
      features: [],
    },
  });
}

export async function makeLead(agencyId: string, email = `p${uuidv7().slice(-8)}@example.com`, name = "Pat Example") {
  const id = uuidv7();
  const f = fields({ agencyId, model: "Lead", id });
  return db().lead.create({
    data: { id, agencyId, nameEnc: f.enc("nameEnc", name), emailEnc: f.enc("emailEnc", email), emailBidx: emailBidx(agencyId, email) },
  });
}

export async function makeUser(email = `u${uuidv7().slice(-8)}@example.com`, name = "Staff Person") {
  return db().user.create({ data: { id: uuidv7(), email, name, emailVerified: true } });
}
