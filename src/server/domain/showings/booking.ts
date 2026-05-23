import { z } from "zod";
import { uuidv7 } from "@/lib/ids";
import { db, pgCode } from "@/server/db";
import { deriveToken, hashToken } from "@/server/crypto/tokens";
import { enqueueEmail } from "@/server/outbox/outbox";
import { audit } from "@/server/audit/audit";
import { tenantDb, type TenantTx } from "@/server/tenant";
import { ContactInput, advanceStage, ensureOpportunity, upsertLead } from "@/server/domain/leads/service";
import { generateSlots, pickAgent, type Slot } from "./slots";

export class SlotTakenError extends Error {
  constructor(public readonly freshSlots: Slot[]) {
    super("That time was just booked by someone else.");
    this.name = "SlotTakenError";
  }
}

export function reminderOffsetsMin(): number[] {
  return (process.env.REMINDER_OFFSETS_MIN ?? "1440,120").split(",").map(Number).filter((n) => n > 0);
}

export async function availableSlots(agencyId: string, days = 10, now = new Date()) {
  const t = tenantDb(agencyId);
  const settings = await t.agencySettings.findFirstOrThrow({});
  const from = now;
  const to = new Date(now.getTime() + days * 86_400_000);
  const [rules, exceptions, busy] = await Promise.all([
    t.availabilityRule.findMany({}),
    t.availabilityException.findMany({ where: { endsAt: { gt: from }, startsAt: { lt: to } } }),
    t.showing.findMany({ where: { status: "SCHEDULED", endsAt: { gt: from }, startsAt: { lt: to } }, select: { agentUserId: true, startsAt: true, endsAt: true } }),
  ]);
  return generateSlots({ rules, exceptions, busy, from, to, now, tz: settings.timezone });
}

export const BookingInput = ContactInput.extend({ start: z.coerce.date() });

export const showingToken = (s: { id: string; tokenVersion: number }) => deriveToken("showing", s.id, s.tokenVersion).token;

export async function bookShowing(agencyId: string, unitId: string, input: z.input<typeof BookingInput>, now = new Date()) {
  const data = BookingInput.parse(input);
  const t = tenantDb(agencyId);
  const slots = await availableSlots(agencyId, 21, now);
  const slot = slots.find((s) => s.start.getTime() === data.start.getTime());
  if (!slot) throw new SlotTakenError(slots);
  const unit = await t.unit.findUniqueOrThrow({ where: { id: unitId } });
  const dayStart = new Date(slot.start.getTime() - 12 * 3_600_000);
  const dayEnd = new Date(slot.start.getTime() + 12 * 3_600_000);
  const loads = await t.showing.groupBy({ by: ["agentUserId"], where: { status: "SCHEDULED", startsAt: { gte: dayStart, lt: dayEnd } }, _count: true });
  const agentUserId = pickAgent(slot, unit.listingAgentId, new Map(loads.map((l) => [l.agentUserId, l._count])));
  const id = uuidv7();
  const { token, hash } = deriveToken("showing", id, 1);

  try {
    const showing = await t.$transaction(async (tx) => {
      const lead = await upsertLead(tx, agencyId, data);
      await ensureOpportunity(tx, agencyId, lead.id, unit.id);
      await advanceStage(tx, agencyId, lead.id, unit.id, "SHOWING");
      const s = await tx.showing.create({
        data: { id, agencyId, unitId: unit.id, leadId: lead.id, agentUserId, startsAt: slot.start, endsAt: slot.end, icsUid: `showing-${id}@leasing.test`, manageTokenHash: hash, tokenVersion: 1 },
      });
      await queueShowingMail(tx, agencyId, s, "showing.confirmed");
      await audit({ agencyId, actorType: "APPLICANT", action: "showing.booked", entity: "Showing", entityId: s.id, metadata: { agentUserId } }, tx);
      return s;
    });
    return { showing, manageToken: token };
  } catch (e) {
    if (pgCode(e) === "23P01") throw new SlotTakenError(await availableSlots(agencyId, 21, now));
    throw e;
  }
}

async function queueShowingMail(tx: TenantTx, agencyId: string, s: { id: string; leadId: string; icsSequence: number; startsAt: Date }, template: string) {
  // Payloads are references only. compose() re-reads the showing and re-derives the manage link.
  await enqueueEmail(tx, agencyId, `mail:showing:${s.id}:${template}:${s.icsSequence}`, {
    template,
    to: { kind: "lead", id: s.leadId },
    params: { showingId: s.id, sequence: s.icsSequence },
  });
  if (template === "showing.canceled") return;
  for (const off of reminderOffsetsMin()) {
    const at = new Date(s.startsAt.getTime() - off * 60_000);
    if (at.getTime() <= Date.now()) continue;
    // Scheduled outbox rows. When one comes due, compose() checks the showing is still
    // SCHEDULED at this sequence; otherwise it sends nothing.
    await enqueueEmail(tx, agencyId, `mail:showing:${s.id}:reminder:${off}:${s.icsSequence}`, {
      template: "showing.reminder",
      to: { kind: "lead", id: s.leadId },
      params: { showingId: s.id, sequence: s.icsSequence, offsetMin: off },
    }, at);
  }
}

/** Public lookup by manage token. Token hashes are globally unique, so this is the one unscoped read. */
export async function showingByToken(token: string) {
  return db().showing.findUnique({ where: { manageTokenHash: hashToken(token) }, include: { unit: { include: { property: true } } } });
}

export async function rescheduleShowing(token: string, start: Date, now = new Date()) {
  const s = await showingByToken(token);
  if (!s || s.status !== "SCHEDULED") throw new Error("showing can't be changed");
  const slots = await availableSlots(s.agencyId, 21, now);
  const slot = slots.find((x) => x.start.getTime() === start.getTime());
  if (!slot) throw new SlotTakenError(slots);
  const agentUserId = slot.agentIds.includes(s.agentUserId) ? s.agentUserId : slot.agentIds[0];
  try {
    return await tenantDb(s.agencyId).$transaction(async (tx) => {
      const r = await tx.showing.updateManyAndReturn({
        where: { id: s.id, status: "SCHEDULED", icsSequence: s.icsSequence },
        data: { startsAt: slot.start, endsAt: slot.end, agentUserId, icsSequence: { increment: 1 }, changedAt: new Date() },
      });
      if (r.length !== 1) throw new Error("showing changed while rescheduling; try again");
      await queueShowingMail(tx, s.agencyId, r[0], "showing.rescheduled");
      await audit({ agencyId: s.agencyId, actorType: "APPLICANT", action: "showing.rescheduled", entity: "Showing", entityId: s.id, metadata: { sequence: r[0].icsSequence } }, tx);
      return r[0];
    });
  } catch (e) {
    if (pgCode(e) === "23P01") throw new SlotTakenError(await availableSlots(s.agencyId, 21, now));
    throw e;
  }
}

export async function cancelShowing(token: string) {
  const s = await showingByToken(token);
  if (!s || s.status !== "SCHEDULED") return null;
  return tenantDb(s.agencyId).$transaction(async (tx) => {
    const r = await tx.showing.updateManyAndReturn({
      where: { id: s.id, status: "SCHEDULED" },
      data: { status: "CANCELED", icsSequence: { increment: 1 }, changedAt: new Date() },
    });
    if (r.length !== 1) return null;
    await queueShowingMail(tx, s.agencyId, r[0], "showing.canceled");
    await audit({ agencyId: s.agencyId, actorType: "APPLICANT", action: "showing.canceled", entity: "Showing", entityId: s.id }, tx);
    return r[0];
  });
}

export async function markShowing(agencyId: string, actorId: string, showingId: string, status: "COMPLETED" | "NO_SHOW") {
  await tenantDb(agencyId).$transaction(async (tx) => {
    const r = await tx.showing.updateMany({ where: { id: showingId, status: "SCHEDULED" }, data: { status } });
    if (r.count) await audit({ agencyId, actorType: "USER", actorId, action: `showing.${status.toLowerCase()}`, entity: "Showing", entityId: showingId }, tx);
  });
}
