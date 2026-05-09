import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { tenantDb } from "@/server/tenant";

export const ListingFilter = z.object({
  beds: z.coerce.number().int().min(0).max(5).optional(),
  maxRent: z.coerce.number().int().positive().optional(),
  property: z.string().optional(),
  sort: z.enum(["rent-asc", "rent-desc", "available"]).default("available"),
});
export type ListingFilter = z.infer<typeof ListingFilter>;

export async function listPublicUnits(agencyId: string, f: ListingFilter) {
  const where: Prisma.UnitWhereInput = { status: { in: ["AVAILABLE", "PENDING"] } };
  if (f.beds !== undefined) where.beds = f.beds >= 3 ? { gte: 3 } : f.beds;
  if (f.maxRent) where.rentCents = { lte: f.maxRent * 100 };
  if (f.property) where.property = { id: f.property };
  const orderBy: Prisma.UnitOrderByWithRelationInput[] =
    f.sort === "rent-asc" ? [{ rentCents: "asc" }] : f.sort === "rent-desc" ? [{ rentCents: "desc" }] : [{ availableOn: "asc" }, { rentCents: "asc" }];
  return tenantDb(agencyId).unit.findMany({ where, orderBy, include: { property: true } });
}

export async function publicUnit(agencyId: string, slug: string) {
  return tenantDb(agencyId).unit.findFirst({
    where: { slug, status: { not: "OFF_MARKET" } },
    include: { property: true },
  });
}

export async function publicProperties(agencyId: string) {
  return tenantDb(agencyId).property.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { units: { where: { status: "AVAILABLE" } } } } },
  });
}
