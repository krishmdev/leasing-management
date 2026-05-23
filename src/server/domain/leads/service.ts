import { z } from "zod";
import { uuidv7 } from "@/lib/ids";
import type { OpportunityStage } from "@/generated/prisma/client";
import { tenantDb, type TenantTx } from "@/server/tenant";
import { emailBidx } from "@/server/crypto/blindIndex";
import { fields } from "@/server/crypto/fieldEncryption";
import { enqueueEmail } from "@/server/outbox/outbox";
import { audit } from "@/server/audit/audit";

export const ContactInput = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  email: z.email("Enter a valid email").max(200),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
});

export const InterestInput = ContactInput.extend({
  desiredMoveIn: z.coerce.date(),
  message: z.string().trim().max(1500).optional().or(z.literal("")),
});

const ORDER: OpportunityStage[] = ["INTEREST", "SHOWING", "APPLIED", "SCREENED", "DECISION", "LEASE_SIGNED"];

/** Finds a lead by blind index or creates one. Names and contact details are stored encrypted. */
export async function upsertLead(tx: TenantTx, agencyId: string, c: z.infer<typeof ContactInput>, source = "website") {
  const bidx = emailBidx(agencyId, c.email);
  const existing = await tx.lead.findUnique({ where: { agencyId_emailBidx: { agencyId, emailBidx: bidx } } });
  if (existing) return existing;
  const id = uuidv7();
  const f = fields({ agencyId, model: "Lead", id });
  await tx.lead.createMany({
    data: [{ id, agencyId, nameEnc: f.enc("nameEnc", c.name), emailEnc: f.enc("emailEnc", c.email), emailBidx: bidx, phoneEnc: f.encOpt("phoneEnc", c.phone), source }],
    skipDuplicates: true,
  });
  // A concurrent request for the same email may have won the insert.
  return tx.lead.findUniqueOrThrow({ where: { agencyId_emailBidx: { agencyId, emailBidx: bidx } } });
}

export function decryptLead(l: { id: string; agencyId: string; nameEnc: string; emailEnc: string; phoneEnc: string | null }) {
  const f = fields({ agencyId: l.agencyId, model: "Lead", id: l.id });
  return { name: f.dec("nameEnc", l.nameEnc), email: f.dec("emailEnc", l.emailEnc), phone: f.decOpt("phoneEnc", l.phoneEnc) };
}

export async function ensureOpportunity(tx: TenantTx, agencyId: string, leadId: string, unitId: string) {
  const opp = await tx.opportunity.upsert({
    where: { leadId_unitId: { leadId, unitId } },
    create: { agencyId, leadId, unitId, stage: "INTEREST" },
    update: {},
  });
  if (opp.createdAt.getTime() === opp.stageChangedAt.getTime()) {
    await tx.stageEvent.createMany({ data: [{ agencyId, opportunityId: opp.id, from: null, to: "INTEREST", at: opp.createdAt }], skipDuplicates: true });
  }
  return opp;
}

/** Moves an opportunity forward only; stages never go backwards except to LOST. */
export async function advanceStage(tx: TenantTx, agencyId: string, leadId: string, unitId: string, to: OpportunityStage, at = new Date()) {
  const opp = await tx.opportunity.findUnique({ where: { leadId_unitId: { leadId, unitId } } });
  if (!opp) return;
  if (to !== "LOST" && (opp.stage === "LOST" || ORDER.indexOf(to) <= ORDER.indexOf(opp.stage))) return;
  const moved = await tx.opportunity.updateMany({ where: { id: opp.id, stage: opp.stage }, data: { stage: to, stageChangedAt: at } });
  if (moved.count) await tx.stageEvent.create({ data: { agencyId, opportunityId: opp.id, from: opp.stage, to, at } });
}

export async function submitInterest(agencyId: string, unitId: string, input: z.input<typeof InterestInput>) {
  const data = InterestInput.parse(input);
  return tenantDb(agencyId).$transaction(async (tx) => {
    const unit = await tx.unit.findFirst({ where: { id: unitId } });
    if (!unit) throw new Error("unit not found");
    const lead = await upsertLead(tx, agencyId, data);
    const opp = await ensureOpportunity(tx, agencyId, lead.id, unit.id);
    const ioiId = uuidv7();
    const f = fields({ agencyId, model: "IndicationOfInterest", id: ioiId });
    await tx.indicationOfInterest.create({
      data: { id: ioiId, agencyId, opportunityId: opp.id, desiredMoveIn: data.desiredMoveIn, messageEnc: f.encOpt("messageEnc", data.message) },
    });
    await enqueueEmail(tx, agencyId, `mail:ioi:${ioiId}`, { template: "ioi.received", to: { kind: "lead", id: lead.id }, params: { unitId: unit.id } });
    await audit({ agencyId, actorType: "APPLICANT", action: "ioi.created", entity: "IndicationOfInterest", entityId: ioiId, metadata: { unitId: unit.id } }, tx);
    return { leadId: lead.id, opportunityId: opp.id, ioiId };
  });
}
