import { z } from "zod";
import { tenantDb } from "@/server/tenant";
import { audit } from "@/server/audit/audit";

export const PropertyInput = z.object({
  name: z.string().min(2).max(80),
  street: z.string().min(3),
  city: z.string().min(2),
  zip: z.string().regex(/^\d{5}$/),
  neighborhood: z.string().optional(),
  amenities: z.array(z.string()).default([]),
  description: z.string().max(2000).default(""),
  yearBuilt: z.number().int().min(1850).max(2030).optional(),
});

export const UnitInput = z.object({
  propertyId: z.string(),
  label: z.string().min(1).max(40),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(60),
  beds: z.number().int().min(0).max(6),
  baths: z.number().min(1).max(5),
  sqft: z.number().int().min(200).max(5000),
  rentCents: z.number().int().positive(),
  depositCents: z.number().int().min(0),
  availableOn: z.coerce.date(),
  description: z.string().max(4000).default(""),
  features: z.array(z.string()).default([]),
  listingAgentId: z.string().optional(),
  photoSeed: z.number().int().default(0),
  status: z.enum(["AVAILABLE", "PENDING", "LEASED", "OFF_MARKET"]).default("AVAILABLE"),
});

export function unitSlug(propertyName: string, label: string) {
  return `${propertyName}-${label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function createProperty(agencyId: string, actorId: string | null, input: z.input<typeof PropertyInput>) {
  const data = PropertyInput.parse(input);
  return tenantDb(agencyId).$transaction(async (tx) => {
    const p = await tx.property.create({ data: { agencyId, state: "CA", ...data } });
    await audit({ agencyId, actorType: actorId ? "USER" : "SYSTEM", actorId, action: "property.created", entity: "Property", entityId: p.id }, tx);
    return p;
  });
}

export async function createUnit(agencyId: string, actorId: string | null, input: z.input<typeof UnitInput>) {
  const data = UnitInput.parse(input);
  return tenantDb(agencyId).$transaction(async (tx) => {
    // The composite FK also rejects a foreign propertyId; this gives a readable error first.
    const property = await tx.property.findUnique({ where: { id: data.propertyId } });
    if (!property) throw new Error("property not found");
    const u = await tx.unit.create({ data: { agencyId, ...data } });
    await audit({ agencyId, actorType: actorId ? "USER" : "SYSTEM", actorId, action: "unit.created", entity: "Unit", entityId: u.id, metadata: { rentCents: u.rentCents } }, tx);
    return u;
  });
}

/** Editable listing fields. Status and property are deliberately not here (see setUnitListed). */
export const UnitPatch = UnitInput.pick({ label: true, beds: true, baths: true, sqft: true, rentCents: true, depositCents: true, availableOn: true, description: true, features: true, listingAgentId: true }).partial();

export async function updateUnit(agencyId: string, actorId: string, unitId: string, patch: z.input<typeof UnitPatch>) {
  const data = UnitPatch.strict().parse(patch);
  return tenantDb(agencyId).$transaction(async (tx) => {
    const u = await tx.unit.update({ where: { id: unitId }, data });
    await audit({ agencyId, actorType: "USER", actorId, action: "unit.updated", entity: "Unit", entityId: unitId, metadata: { fields: Object.keys(data) } }, tx);
    return u;
  });
}
