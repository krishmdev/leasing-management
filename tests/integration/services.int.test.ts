import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { bookShowing, SlotTakenError, availableSlots, cancelShowing, rescheduleShowing } from "@/server/domain/showings/booking";
import { createTicket, transitionTicket, processPhoto } from "@/server/domain/maintenance/tickets";
import { purgeExpired } from "@/server/domain/retention/purge";
import { executeDecision } from "@/server/domain/decisions/decide";
import { renderDocument, docStorageKey } from "@/worker/documents/render";
import { getObject } from "@/server/storage";
import { resetDb, makeUser } from "../helpers/db";
import { agencyWith, answerReferences, completeScreening, evaluate, flushOutbox, mail, submittedApplication } from "../helpers/pipeline";

beforeAll(async () => {
  await resetDb();
});

describe("showings", () => {
  it("two people booking the last slot at once: one wins, the other gets fresh slots", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const agent = await makeUser();
    await db().availabilityRule.create({ data: { agencyId: agency.id, agentUserId: agent.id, weekday: 1, startMin: 600, endMin: 630, slotMin: 30, bufferMin: 0 } });
    const now = new Date("2026-10-01T12:00:00Z");
    const [slot] = await availableSlots(agency.id, 10, now);
    expect(slot).toBeTruthy();
    const results = await Promise.allSettled([
      bookShowing(agency.id, unit.id, { name: "Ann A", email: "ann@example.com", start: slot.start }, now),
      bookShowing(agency.id, unit.id, { name: "Bob B", email: "bob@example.com", start: slot.start }, now),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(SlotTakenError);
  });

  it("confirmation carries an .ics with a stable UID; reschedule bumps SEQUENCE; cancel sends METHOD:CANCEL", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const agent = await makeUser();
    await db().availabilityRule.createMany({ data: [1, 2, 3, 4, 5].map((weekday) => ({ agencyId: agency.id, agentUserId: agent.id, weekday, startMin: 540, endMin: 720, slotMin: 30, bufferMin: 0 })) });
    const now = new Date(Date.now() + 86_400_000);
    const slots = await availableSlots(agency.id, 10, now);
    const email = `ics-${Date.now()}@example.com`;
    const { showing, manageToken } = await bookShowing(agency.id, unit.id, { name: "Cal C", email, start: slots[0].start }, now);
    await rescheduleShowing(manageToken, slots[3].start, now);
    await cancelShowing(manageToken);
    await flushOutbox();
    const mine = mail.delivered.filter((m) => m.to === email);
    const bySeq = (n: number) => mine.flatMap((m) => m.attachments ?? []).map((a) => String(a.content)).filter((v) => v.includes(`SEQUENCE:${n}`));
    const ics = [bySeq(0), bySeq(1), bySeq(2)].flat();
    expect(ics).toHaveLength(3);
    for (const v of ics) expect(v).toContain(`UID:${showing.icsUid}`);
    expect(ics[0]).toContain("SEQUENCE:0");
    expect(ics[1]).toContain("SEQUENCE:1");
    expect(ics[2]).toMatch(/METHOD:CANCEL[\s\S]*SEQUENCE:2/);
    // reminders for the old times were scheduled but will render as nothing
    expect(mine.some((m) => m.subject.startsWith("Reminder"))).toBe(false);
  });
});

describe("maintenance", () => {
  it("'I smell gas' is an EMERGENCY by rule, alerts staff, and photos lose their EXIF", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const withExif = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#888" } }).jpeg().withMetadata({ exif: { IFD0: { Make: "TestCam", Copyright: "GPS 37.8,-122.2" } } }).toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeTruthy();
    const r = await createTicket(agency.id, { residencyId: null, unitId: unit.id, reporterUserId: null }, { title: "Kitchen", description: "I smell gas near the stove", permissionToEnter: true }, [withExif]);
    expect(r).toMatchObject({ urgency: "EMERGENCY" });
    expect(r.instructions).toMatch(/Leave the unit/);
    const t = await db().maintenanceTicket.findUniqueOrThrow({ where: { id: r.id }, include: { photos: true } });
    expect(t).toMatchObject({ triageSource: "RULE", safetyRule: "gas", status: "TRIAGED" });
    const stored = await getObject(t.photos[0].storageKey);
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(await db().outboxMessage.count({ where: { idempotencyKey: `mail:ticket:${r.id}:staff-alert` } })).toBe(1);
  });

  it("rejects a file that only claims to be an image", async () => {
    await expect(processPhoto(Buffer.from("GIF89a not really"))).rejects.toThrow(/JPEG, PNG or WebP/);
  });

  it("ON_HOLD pauses the resolve clock", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const r = await createTicket(agency.id, { residencyId: null, unitId: unit.id, reporterUserId: null }, { title: "Dripping faucet", description: "the bathroom faucet drips", permissionToEnter: true });
    const t0 = new Date();
    const actor = { type: "USER" as const, id: null };
    await transitionTicket(agency.id, actor, r.id, "ASSIGNED", undefined, t0);
    await transitionTicket(agency.id, actor, r.id, "IN_PROGRESS", undefined, t0);
    await transitionTicket(agency.id, actor, r.id, "ON_HOLD", "waiting on part", t0);
    await transitionTicket(agency.id, actor, r.id, "IN_PROGRESS", undefined, new Date(t0.getTime() + 2 * 3_600_000));
    const t = await db().maintenanceTicket.findUniqueOrThrow({ where: { id: r.id } });
    expect(t.pausedMs).toBe(2 * 3_600_000);
    expect(t.firstRespondedAt).toBeTruthy();
    await expect(transitionTicket(agency.id, actor, r.id, "NEW")).rejects.toThrow(/Can't move/);
  });
});

describe("documents", () => {
  it("adverse action notice names the CRA, the score used, and the rights; re-rendering is byte-identical", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const s = await submittedApplication(agency.id, unit.id, { incomeCents: 540_000 });
    await answerReferences(s.applicationId);
    await completeScreening(agency.id, s.applicationId, "poor");
    await evaluate(agency.id, s.applicationId);
    const rec = await db().recommendation.findFirstOrThrow({ where: { applicationId: s.applicationId } });
    expect(rec.outcome).toBe("DECLINE");
    const b = rec.breakdown as { reasonCodes: never[] };
    await executeDecision(agency.id, s.applicationId, { outcome: "DECLINE", mode: "MANUAL", decidedByType: "USER", reasonCodes: b.reasonCodes });
    await flushOutbox();
    const n = await db().adverseActionNotice.findUniqueOrThrow({ where: { applicationId: s.applicationId } });
    expect(n.basis).toEqual(expect.arrayContaining(["CRA", "APPLICANT_INFO"]));
    expect(n.craSnapshot).toMatchObject({ usedCra: true, cra: { name: expect.stringContaining("MockCRA") }, score: { value: 548, range: [300, 850] } });
    const doc = await db().generatedDocument.findFirstOrThrow({ where: { applicationId: s.applicationId, kind: "ADVERSE_ACTION" } });
    expect(n.documentId).toBe(doc.id);
    // Delete the row and render again from the same outbox key: same bytes, same hash.
    const row = await db().outboxMessage.findUniqueOrThrow({ where: { idempotencyKey: doc.idempotencyKey } });
    await db().adverseActionNotice.update({ where: { id: n.id }, data: { documentId: null } });
    await db().generatedDocument.delete({ where: { id: doc.id } });
    const again = await renderDocument({ ...row, payload: row.payload as never, firstAttemptAt: null, renderedSha256: null } as never);
    expect((again as { sha256: string }).sha256).toBe(doc.sha256);
    expect(docStorageKey(agency.id, doc.idempotencyKey)).toBe(doc.storageKey);
  });
});

describe("retention", () => {
  it("purges credit data and declined applicants' PII, keeping a tombstone and an audit entry", async () => {
    const { agency, unit } = await agencyWith("MANUAL");
    const s = await submittedApplication(agency.id, unit.id, { incomeCents: 540_000 });
    await answerReferences(s.applicationId);
    await completeScreening(agency.id, s.applicationId, "poor");
    await evaluate(agency.id, s.applicationId);
    await executeDecision(agency.id, s.applicationId, { outcome: "DECLINE", mode: "MANUAL", decidedByType: "USER", reasonCodes: [] });
    const future = new Date(Date.now() + 800 * 86_400_000);
    const dry = await purgeExpired({ dryRun: true, now: future, agencyId: agency.id });
    expect(dry[agency.id]).toMatchObject({ credit: 1, applicants: 1 });
    expect((await db().application.findUniqueOrThrow({ where: { id: s.applicationId } })).legalNameEnc).not.toBeNull();
    await purgeExpired({ dryRun: false, now: future, agencyId: agency.id });
    const app = await db().application.findUniqueOrThrow({ where: { id: s.applicationId } });
    expect(app).toMatchObject({ legalNameEnc: null, phoneEnc: null, status: "DECLINED" });
    expect(app.purgedAt).toBeTruthy();
    expect(await db().decision.count({ where: { applicationId: s.applicationId } })).toBe(1);
    const sr = await db().screeningRequest.findFirstOrThrow({ where: { applicationId: s.applicationId }, include: { result: true } });
    expect(sr.result).toMatchObject({ creditScoreEnc: null, keyFactors: [] });
    expect(await db().user.findUnique({ where: { id: s.userId } })).toBeNull();
    expect(await db().auditLog.count({ where: { agencyId: agency.id, action: "pii.purged" } })).toBe(1);
  });
});

describe("retention across tenants", () => {
  async function declinedApplicantAt(agencyId: string, unitId: string) {
    const s = await submittedApplication(agencyId, unitId, { incomeCents: 540_000 });
    await answerReferences(s.applicationId);
    await completeScreening(agencyId, s.applicationId, "poor");
    await evaluate(agencyId, s.applicationId);
    await executeDecision(agencyId, s.applicationId, { outcome: "DECLINE", mode: "MANUAL", decidedByType: "USER", reasonCodes: [] });
    return s;
  }
  const future = () => new Date(Date.now() + 800 * 86_400_000);

  it("keeps the user if they're staff at another agency", async () => {
    const a = await agencyWith("MANUAL");
    const b = await agencyWith("MANUAL");
    const s = await declinedApplicantAt(a.agency.id, a.unit.id);
    await db().member.create({ data: { id: crypto.randomUUID(), organizationId: b.agency.id, userId: s.userId, role: "agent", createdAt: new Date() } });
    await purgeExpired({ dryRun: false, now: future(), agencyId: a.agency.id });
    expect(await db().user.findUnique({ where: { id: s.userId } })).not.toBeNull();
    expect(await db().member.count({ where: { userId: s.userId } })).toBe(1);
    expect((await db().application.findUniqueOrThrow({ where: { id: s.applicationId } })).legalNameEnc).toBeNull();
  });

  it("keeps the user if they're a resident at another agency", async () => {
    const a = await agencyWith("MANUAL");
    const b = await agencyWith("MANUAL");
    const s = await declinedApplicantAt(a.agency.id, a.unit.id);
    await db().residency.create({ data: { agencyId: b.agency.id, unitId: b.unit.id, residentUserId: s.userId, moveIn: new Date("2026-01-01"), status: "CURRENT", rentCents: 1 } });
    await purgeExpired({ dryRun: false, now: future(), agencyId: a.agency.id });
    expect(await db().user.findUnique({ where: { id: s.userId } })).not.toBeNull();
  });
});
