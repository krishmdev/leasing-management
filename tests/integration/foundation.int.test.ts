import { beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@/lib/ids";
import { db, pgCode } from "@/server/db";
import { tenantDb, tenantRaw, TenantViolation } from "@/server/tenant";
import { audit } from "@/server/audit/audit";
import { decryptField, DecryptError, fields } from "@/server/crypto/fieldEncryption";
import { makeAgency, makeLead, makeUnit, makeUser, resetDb } from "../helpers/db";

let A: Awaited<ReturnType<typeof makeAgency>>;
let B: Awaited<ReturnType<typeof makeAgency>>;

beforeAll(async () => {
  await resetDb();
  A = await makeAgency("alpha");
  B = await makeAgency("beta");
});

describe("tenant isolation", () => {
  it("a tenant client can't read another agency's rows, even by id", async () => {
    const unitB = await makeUnit(B.id);
    const tA = tenantDb(A.id);
    expect(await tA.unit.findUnique({ where: { id: unitB.id } })).toBeNull();
    expect(await tA.unit.findFirst({ where: { slug: unitB.slug } })).toBeNull();
    expect(await tA.unit.count()).toBe(0);
    expect(await tenantDb(B.id).unit.count()).toBe(1);
  });

  it("can't update or delete another agency's rows", async () => {
    const unitB = await makeUnit(B.id);
    const tA = tenantDb(A.id);
    await expect(tA.unit.update({ where: { id: unitB.id }, data: { rentCents: 1 } })).rejects.toThrow();
    expect((await tA.unit.updateMany({ where: { id: unitB.id }, data: { rentCents: 1 } })).count).toBe(0);
    await expect(tA.unit.delete({ where: { id: unitB.id } })).rejects.toThrow();
    expect((await db().unit.findUnique({ where: { id: unitB.id } }))!.rentCents).toBe(unitB.rentCents);
  });

  it("stamps agencyId on create and refuses a foreign one", async () => {
    const tA = tenantDb(A.id);
    const p = await tA.property.create({
      data: { agencyId: A.id, name: "x", street: "x", city: "x", zip: "x", amenities: [], description: "" },
    });
    expect(p.agencyId).toBe(A.id);
    await expect(
      tA.property.create({ data: { agencyId: B.id, name: "x", street: "x", city: "x", zip: "x", amenities: [], description: "" } }),
    ).rejects.toBeInstanceOf(TenantViolation);
  });

  it("updateManyAndReturn is scoped too", async () => {
    const unitB = await makeUnit(B.id);
    const rows = await tenantDb(A.id).unit.updateManyAndReturn({ where: { id: unitB.id }, data: { label: "pwned" } });
    expect(rows).toHaveLength(0);
    expect((await db().unit.findUniqueOrThrow({ where: { id: unitB.id } })).label).toBe(unitB.label);
  });

  it("a row can't reference another agency's row (composite foreign keys)", async () => {
    const unitB = await makeUnit(B.id);
    const leadA = await makeLead(A.id);
    const err = await tenantDb(A.id)
      .showing.create({
        data: { agencyId: A.id, unitId: unitB.id, leadId: leadA.id, agentUserId: "x", startsAt: new Date(), endsAt: new Date(Date.now() + 1000), icsUid: uuidv7(), manageTokenHash: uuidv7() },
      })
      .catch((e) => e);
    expect(pgCode(err) ?? String(err)).toMatch(/23503|foreign key/i);
  });

  it("rejects nested relation writes", async () => {
    const unitA = await makeUnit(A.id);
    const leadA = await makeLead(A.id);
    await expect(
      tenantDb(A.id).unit.update({
        where: { id: unitA.id },
        data: { showings: { create: { agencyId: B.id, leadId: leadA.id, agentUserId: "y", startsAt: new Date(), endsAt: new Date(Date.now() + 1000), icsUid: uuidv7(), manageTokenHash: uuidv7() } } } as never,
      }),
    ).rejects.toBeInstanceOf(TenantViolation);
  });

  it("global models can't be used to reach tenant rows", async () => {
    const tA = tenantDb(A.id);
    await expect(tA.organization.findUnique({ where: { id: B.id }, include: { units: true } })).rejects.toBeInstanceOf(TenantViolation);
    await expect(tA.organization.findUnique({ where: { id: B.id }, select: { _count: true } })).rejects.toBeInstanceOf(TenantViolation);
    await expect(tA.organization.findMany({ where: { units: { some: {} } } })).rejects.toBeInstanceOf(TenantViolation);
    expect((await tA.organization.findUnique({ where: { id: A.id } }))?.slug).toBe("alpha");
  });

  it("bare raw SQL is refused; tenantRaw requires this tenant's agencyId", async () => {
    const tA = tenantDb(A.id);
    await expect(tA.$queryRaw`SELECT count(*) FROM "Unit"`).rejects.toBeInstanceOf(TenantViolation);
    await expect(tA.$executeRawUnsafe(`DELETE FROM "Unit"`)).rejects.toBeInstanceOf(TenantViolation);
    expect(() => tenantRaw(A.id, tA).query`SELECT count(*) FROM "Unit"`).toThrow(TenantViolation);
    expect(() => tenantRaw(A.id, tA).query`SELECT count(*) FROM "Unit" WHERE "agencyId" = ${B.id}`).toThrow(TenantViolation);
    const rows = await tenantRaw(A.id, tA).query<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "Unit" WHERE "agencyId" = ${A.id}`;
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(0);
  });

  it("the extension survives into interactive transactions", async () => {
    await makeUnit(B.id);
    const n = await tenantDb(A.id).$transaction(async (tx) => tx.unit.count());
    expect(n).toBe(await db().unit.count({ where: { agencyId: A.id } }));
  });
});

describe("audit log", () => {
  it("is append-only", async () => {
    await audit({ agencyId: A.id, actorType: "SYSTEM", action: "test.event", entity: "Test" });
    const row = await db().auditLog.findFirstOrThrow({ where: { action: "test.event" } });
    await expect(db().auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(db().auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(db().$executeRawUnsafe(`TRUNCATE "AuditLog"`)).rejects.toThrow(/append-only/);
  });

  it("rejects metadata keys that look like PII", async () => {
    await expect(
      audit({ agencyId: A.id, actorType: "SYSTEM", action: "x", entity: "x", metadata: { email: "a@b.c" } }),
    ).rejects.toThrow(/PII/);
    await audit({ agencyId: A.id, actorType: "SYSTEM", action: "x", entity: "x", metadata: { redactionCount: 2 } });
  });
});

describe("encrypted records in the database", () => {
  it("ciphertext swapped between two leads' rows no longer decrypts", async () => {
    const l1 = await makeLead(A.id, "one@example.com", "One Person");
    const l2 = await makeLead(A.id, "two@example.com", "Two Person");
    await db().$executeRaw`UPDATE "Lead" SET "emailEnc" = ${l1.emailEnc} WHERE id = ${l2.id}`;
    const row = await db().lead.findUniqueOrThrow({ where: { id: l2.id } });
    expect(() => decryptField({ agencyId: A.id, model: "Lead", id: l2.id, field: "emailEnc" }, row.emailEnc)).toThrow(DecryptError);
    expect(fields({ agencyId: A.id, model: "Lead", id: l1.id }).dec("emailEnc", l1.emailEnc)).toBe("one@example.com");
  });

  it("ciphertext moved to another tenant's row no longer decrypts", async () => {
    const la = await makeLead(A.id, "a@example.com");
    const lb = await makeLead(B.id, "b@example.com");
    await db().$executeRaw`UPDATE "Lead" SET "nameEnc" = ${la.nameEnc} WHERE id = ${lb.id}`;
    const row = await db().lead.findUniqueOrThrow({ where: { id: lb.id } });
    expect(() => decryptField({ agencyId: B.id, model: "Lead", id: lb.id, field: "nameEnc" }, row.nameEnc)).toThrow(DecryptError);
  });

  it("record identity can't be changed after insert", async () => {
    const l = await makeLead(A.id);
    await expect(db().$executeRaw`UPDATE "Lead" SET id = ${uuidv7()} WHERE id = ${l.id}`).rejects.toThrow(/immutable/);
    await expect(db().$executeRaw`UPDATE "Lead" SET "agencyId" = ${B.id} WHERE id = ${l.id}`).rejects.toThrow(/immutable/);
  });

  it("the same email gets different blind indexes per agency", async () => {
    const la = await makeLead(A.id, "same@example.com");
    const lb = await makeLead(B.id, "same@example.com");
    expect(la.emailBidx).not.toBe(lb.emailBidx);
    await expect(makeLead(A.id, "SAME@example.com")).rejects.toThrow();
  });
});

describe("criteria versions", () => {
  it("are immutable once written", async () => {
    const c = await db().screeningCriteria.create({ data: { agencyId: A.id, version: 1, config: {}, configSha256: "x" } });
    await expect(db().screeningCriteria.update({ where: { id: c.id }, data: { config: { changed: true } } })).rejects.toThrow(/immutable/);
  });
});

describe("database backstops", () => {
  it("rejects overlapping showings for the same agent (23P01), even concurrently", async () => {
    const unit = await makeUnit(A.id);
    const lead = await makeLead(A.id);
    const agent = await makeUser();
    const at = new Date("2026-10-05T17:00:00Z");
    const book = (offsetMin: number) =>
      db().showing.create({
        data: {
          agencyId: A.id, unitId: unit.id, leadId: lead.id, agentUserId: agent.id,
          startsAt: new Date(at.getTime() + offsetMin * 60_000), endsAt: new Date(at.getTime() + (offsetMin + 30) * 60_000),
          icsUid: uuidv7(), manageTokenHash: uuidv7(),
        },
      });
    const results = await Promise.allSettled([book(0), book(10)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(pgCode(rejected.reason)).toBe("23P01");
    await book(30); // back-to-back is fine: ranges are half-open
  });

  it("allows only one ACTIVE hold row per unit", async () => {
    const unit = await makeUnit(A.id);
    const lead = await makeLead(A.id);
    const mkApp = () =>
      db().application.create({ data: { id: uuidv7(), agencyId: A.id, leadId: lead.id, unitId: unit.id, status: "WITHDRAWN" } });
    const [a1, a2, a3] = [await mkApp(), await mkApp(), await mkApp()];
    const now = Date.now();
    const hold = (appId: string, startOffsetH: number, hours = 72) =>
      db().unitHold.create({
        data: {
          agencyId: A.id, unitId: unit.id, applicationId: appId, status: "ACTIVE",
          startsAt: new Date(now + startOffsetH * 3_600_000), expiresAt: new Date(now + (startOffsetH + hours) * 3_600_000),
        },
      });
    await hold(a1.id, -1);
    const err = await hold(a2.id, 0).catch((e) => e);
    expect(pgCode(err)).toBe("23P01");
    // a waitlisted hold doesn't conflict
    await db().unitHold.create({ data: { agencyId: A.id, unitId: unit.id, applicationId: a2.id, status: "WAITLISTED" } });
    // even a non-overlapping window can't be ACTIVE while an older ACTIVE row exists: the old
    // one has to be expired first, under the unit lock
    expect(pgCode(await hold(a3.id, 80).catch((e) => e))).toBe("23505");
    await db().unitHold.updateMany({ where: { applicationId: a1.id }, data: { status: "EXPIRED" } });
    await hold(a3.id, 80);
  });

  it("rejects overlapping residencies on the same unit", async () => {
    const unit = await makeUnit(A.id);
    const res = (moveIn: string, moveOut: string | null, status: "CURRENT" | "PAST" | "FUTURE" = "CURRENT") =>
      db().residency.create({
        data: { agencyId: A.id, unitId: unit.id, moveIn: new Date(moveIn), moveOut: moveOut ? new Date(moveOut) : null, status, rentCents: 1 },
      });
    await res("2025-01-01", "2026-01-01", "PAST");
    await res("2026-01-01", null, "CURRENT");
    expect(pgCode(await res("2026-06-01", "2027-06-01", "FUTURE").catch((e) => e))).toBe("23P01");
    // PAST rows are outside the constraint (history can be messy)
    await res("2025-06-01", "2025-09-01", "PAST");
  });

  it("allows one live application per lead and unit", async () => {
    const unit = await makeUnit(A.id);
    const lead = await makeLead(A.id);
    await db().application.create({ data: { id: uuidv7(), agencyId: A.id, leadId: lead.id, unitId: unit.id } });
    const err = await db().application.create({ data: { id: uuidv7(), agencyId: A.id, leadId: lead.id, unitId: unit.id } }).catch((e) => e);
    expect(pgCode(err)).toBe("23505");
  });
});
