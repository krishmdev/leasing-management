import { z } from "zod";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { uuidv7 } from "@/lib/ids";
import { tenantDb } from "@/server/tenant";
import { enqueueEmail } from "@/server/outbox/outbox";
import { audit, type ActorType } from "@/server/audit/audit";
import { deleteObject, putObject } from "@/server/storage";
import { triageTicket } from "@/server/ai/provider";
import { offlineTriage } from "@/server/ai/offline";
import { redact } from "@/server/ai/guardrails/redact";
import { ACCOMMODATION_RE, matchSafetyRule } from "./rules";
import { canTransition, type TicketStatus } from "./stateMachine";

export const TicketInput = z.object({
  title: z.string().trim().min(3, "Add a short title").max(120),
  description: z.string().trim().min(5, "Describe the problem").max(4000),
  permissionToEnter: z.coerce.boolean(),
});

type Urgency = "LOW" | "NORMAL" | "HIGH" | "EMERGENCY";
export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Check magic bytes (not the declared type), then re-encode, which drops EXIF and GPS. */
export async function processPhoto(buf: Buffer) {
  if (buf.length > MAX_PHOTO_BYTES) throw new Error("Photos must be under 10 MB");
  const ft = await fileTypeFromBuffer(buf);
  if (!ft || !["image/jpeg", "image/png", "image/webp"].includes(ft.mime)) throw new Error("Photos must be JPEG, PNG or WebP");
  const img = sharp(buf, { failOn: "error" }).rotate();
  const full = await img.clone().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  const thumb = await img.clone().resize({ width: 320, height: 320, fit: "cover" }).webp({ quality: 70 }).toBuffer();
  return { full: full.data, thumb, width: full.info.width, height: full.info.height };
}

export async function createTicket(
  agencyId: string,
  who: { residencyId: string | null; unitId: string; reporterUserId: string | null },
  input: z.input<typeof TicketInput>,
  photos: Buffer[] = [],
  now = new Date(),
) {
  const d = TicketInput.parse(input);
  if (photos.length > MAX_PHOTOS) throw new Error(`At most ${MAX_PHOTOS} photos`);
  const processed = await Promise.all(photos.map(processPhoto));
  const month = now.getMonth() + 1;
  const text = `${d.title}. ${d.description}`;
  const rule = matchSafetyRule(text, month);
  const accommodation = ACCOMMODATION_RE.test(text);
  const t = tenantDb(agencyId);

  // A safety rule decides on its own; nothing waits on a model for a gas leak. Otherwise the
  // classifier runs on redacted text (names included) and falls back to offline if it fails.
  const reporter = who.reporterUserId ? await t.user.findUnique({ where: { id: who.reporterUserId } }) : null;
  const knownNames = reporter ? [reporter.name] : [];
  const ai = rule
    ? { ...offlineTriage({ title: redact(d.title, { knownNames }).text, redactedText: redact(d.description, { knownNames }).text, month }), source: "OFFLINE" as const }
    : await triageTicket({ agencyId }, { title: redact(d.title, { knownNames }).text, redactedText: redact(d.description, { knownNames }).text, month });
  const urgency: Urgency = rule ? "EMERGENCY" : ai.urgency;
  const category = rule && rule.category !== "OTHER" ? rule.category : ai.category;
  const policy = await t.slaPolicy.findFirst({ where: { urgency } });
  const respondMins = policy?.respondMins ?? 24 * 60;
  const resolveMins = policy?.resolveMins ?? 7 * 24 * 60;
  const id = uuidv7();

  // Photos are written to disk first under fresh keys; if the transaction fails they're removed,
  // so a rollback can't leave orphaned files or rows pointing at missing ones.
  const stored: { key: string; p: (typeof processed)[number] }[] = [];
  for (const p of processed) {
    const key = `agencies/${agencyId}/tickets/${id}/${uuidv7()}`;
    await putObject(`${key}.webp`, p.full);
    await putObject(`${key}.thumb.webp`, p.thumb);
    stored.push({ key, p });
  }
  try {
    return await t.$transaction(async (tx) => {
    const status: TicketStatus = accommodation ? "NEW" : "TRIAGED";
    await tx.maintenanceTicket.create({
      data: {
        id, agencyId, unitId: who.unitId, residencyId: who.residencyId, reporterUserId: who.reporterUserId, title: d.title, description: d.description,
        category, urgency, triageSource: rule ? "RULE" : ai.source, safetyRule: rule?.id ?? null,
        aiTriage: { category: ai.category, urgency: ai.urgency, confidence: ai.confidence, source: ai.source },
        status, permissionToEnter: d.permissionToEnter, possibleAccommodationRequest: accommodation,
        slaRespondBy: new Date(now.getTime() + respondMins * 60_000), slaResolveBy: new Date(now.getTime() + resolveMins * 60_000), createdAt: now,
      },
    });
    await tx.ticketEvent.createMany({
      data: [
        { agencyId, ticketId: id, from: null, to: "NEW", actorType: "RESIDENT", actorId: who.reporterUserId, at: now },
        ...(status === "TRIAGED" ? [{ agencyId, ticketId: id, from: "NEW" as const, to: "TRIAGED" as const, actorType: "AGENT", note: rule ? `safety rule: ${rule.id}` : `classified ${ai.source.toLowerCase()}`, at: now }] : []),
      ],
    });
    for (const { key, p } of stored) {
      await tx.ticketPhoto.create({ data: { agencyId, ticketId: id, storageKey: `${key}.webp`, thumbKey: `${key}.thumb.webp`, bytes: p.full.length, width: p.width, height: p.height } });
    }
    if (who.reporterUserId) await enqueueEmail(tx, agencyId, `mail:ticket:${id}:created`, { template: "ticket.created", to: { kind: "user", id: who.reporterUserId }, params: { ticketId: id } });
    if (urgency === "EMERGENCY" || accommodation) {
      await enqueueEmail(tx, agencyId, `mail:ticket:${id}:staff-alert`, { template: "ticket.staff_alert", to: { kind: "agency-staff", roles: ["owner", "admin", "maintenance"] }, params: { ticketId: id } });
    }
    await audit({ agencyId, actorType: "RESIDENT", actorId: who.reporterUserId, action: "ticket.created", entity: "MaintenanceTicket", entityId: id, metadata: { urgency, category, rule: rule?.id ?? null, accommodation } }, tx);
    return { id, urgency, category, instructions: rule?.instructions ?? null, accommodation };
    });
  } catch (e) {
    await Promise.all(stored.flatMap(({ key }) => [deleteObject(`${key}.webp`), deleteObject(`${key}.thumb.webp`)]));
    throw e;
  }
}

export class TransitionError extends Error {}

export async function transitionTicket(agencyId: string, actor: { type: ActorType; id: string | null }, ticketId: string, to: TicketStatus, note?: string, now = new Date()) {
  return tenantDb(agencyId).$transaction(async (tx) => {
    const t = await tx.maintenanceTicket.findUniqueOrThrow({ where: { id: ticketId } });
    if (!canTransition(t.status, to)) throw new TransitionError(`Can't move a ${t.status.toLowerCase()} ticket to ${to.toLowerCase()}`);
    const data: Record<string, unknown> = { status: to };
    if (t.status === "ON_HOLD" && t.onHoldSince) {
      data.pausedMs = t.pausedMs + (now.getTime() - t.onHoldSince.getTime());
      data.onHoldSince = null;
    }
    if (to === "ON_HOLD") data.onHoldSince = now;
    if (!t.firstRespondedAt && ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(to)) data.firstRespondedAt = now;
    if (to === "RESOLVED") data.resolvedAt = now;
    if (to === "IN_PROGRESS" && (t.status === "RESOLVED" || t.status === "CLOSED")) data.resolvedAt = null;
    const moved = await tx.maintenanceTicket.updateMany({ where: { id: ticketId, status: t.status }, data });
    if (moved.count !== 1) throw new TransitionError("The ticket changed; reload and try again");
    await tx.ticketEvent.create({ data: { agencyId, ticketId, from: t.status, to, actorType: actor.type, actorId: actor.id, note: note ?? null, at: now } });
    if (t.reporterUserId) {
      await enqueueEmail(tx, agencyId, `mail:ticket:${ticketId}:status:${to}:${now.getTime()}`, { template: "ticket.status", to: { kind: "user", id: t.reporterUserId }, params: { ticketId, to } });
    }
    await audit({ agencyId, actorType: actor.type, actorId: actor.id, action: "ticket.status_changed", entity: "MaintenanceTicket", entityId: ticketId, metadata: { from: t.status, to } }, tx);
  });
}

export async function assignTicket(agencyId: string, actorId: string, ticketId: string, assigneeUserId: string) {
  const t = await tenantDb(agencyId).maintenanceTicket.findUniqueOrThrow({ where: { id: ticketId } });
  const member = await tenantDb(agencyId).member.findFirst({ where: { organizationId: agencyId, userId: assigneeUserId } });
  if (!member) throw new TransitionError("Assignee isn't on this agency's team");
  await tenantDb(agencyId).maintenanceTicket.update({ where: { id: ticketId }, data: { assigneeUserId } });
  if (t.status === "NEW") await transitionTicket(agencyId, { type: "USER", id: actorId }, ticketId, "TRIAGED", "triaged by staff");
  if (t.status === "NEW" || t.status === "TRIAGED") await transitionTicket(agencyId, { type: "USER", id: actorId }, ticketId, "ASSIGNED");
}

export async function commentOnTicket(agencyId: string, actor: { type: "STAFF" | "RESIDENT"; id: string }, ticketId: string, body: string, internal: boolean) {
  const text = z.string().trim().min(1).max(4000).parse(body);
  return tenantDb(agencyId).$transaction(async (tx) => {
    const t = await tx.maintenanceTicket.findUniqueOrThrow({ where: { id: ticketId } });
    const c = await tx.ticketComment.create({ data: { agencyId, ticketId, authorUserId: actor.id, authorType: actor.type, body: text, internal: actor.type === "STAFF" && internal } });
    if (actor.type === "STAFF" && !internal && t.reporterUserId) {
      await enqueueEmail(tx, agencyId, `mail:ticket:${ticketId}:comment:${c.id}`, { template: "ticket.comment", to: { kind: "user", id: t.reporterUserId }, params: { ticketId, commentId: c.id } });
    }
    return c;
  });
}
