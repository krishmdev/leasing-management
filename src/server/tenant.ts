import { Prisma } from "@/generated/prisma/client";
import { db, type Db } from "@/server/db";

/**
 * Models that belong to one agency. The tenant client below adds `agencyId` to every where
 * clause and every create for these, so a service holding a tenant client can't read or write
 * another agency's rows even if it is handed a foreign id.
 */
export const TENANT_MODELS = new Set<string>([
  "AgencySettings", "AutomationQuota", "Property", "Unit", "Lead", "Opportunity", "StageEvent",
  "IndicationOfInterest", "AvailabilityRule", "AvailabilityException", "Showing", "Application",
  "ResidenceHistory", "ConsentRecord", "ReferenceRequest", "ReferenceResponse", "ScreeningCriteria",
  "ScreeningRequest", "ScreeningResult", "AgentStep", "LlmCall", "Recommendation", "Decision",
  "ApprovalTask", "AdverseActionNotice", "OutboxMessage", "GeneratedDocument", "UnitHold", "Lease",
  "Signature", "Residency", "MaintenanceTicket", "TicketPhoto", "TicketComment", "TicketEvent",
  "SlaPolicy", "AuditLog",
]);

const WHERE_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count",
  "aggregate", "groupBy", "update", "updateMany", "delete", "deleteMany", "upsert",
]);

export class TenantMismatchError extends Error {
  constructor(model: string) {
    super(`refusing to write ${model} for a different agency`);
    this.name = "TenantMismatchError";
  }
}

function stamp(model: string, agencyId: string, data: Record<string, unknown>) {
  if (data.agencyId !== undefined && data.agencyId !== agencyId) throw new TenantMismatchError(model);
  return { ...data, agencyId };
}

export function tenantDb(agencyId: string, base: Db = db()) {
  if (!agencyId) throw new Error("tenantDb needs an agencyId");
  return base.$extends({
    name: "tenant",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const a = (args ?? {}) as Record<string, unknown>;
          if (WHERE_OPS.has(operation)) {
            a.where = { ...((a.where as object) ?? {}), agencyId };
          }
          if (operation === "create") a.data = stamp(model, agencyId, a.data as Record<string, unknown>);
          if (operation === "upsert") a.create = stamp(model, agencyId, a.create as Record<string, unknown>);
          if (operation === "createMany" || operation === "createManyAndReturn") {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            a.data = rows.map((r) => stamp(model, agencyId, r as Record<string, unknown>));
          }
          if ((operation === "update" || operation === "updateMany" || operation === "upsert") && a.data) {
            const d = a.data as Record<string, unknown>;
            if (d.agencyId !== undefined && d.agencyId !== agencyId) throw new TenantMismatchError(model);
          }
          return query(a as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;

export async function agencyBySlug(slug: string) {
  return db().organization.findUnique({ where: { slug }, include: { settings: true } });
}

export const RESERVED_SLUGS = new Set([
  "dashboard", "api", "login", "r", "mock-provider", "_next", "check-email", "portal", "static", "favicon.ico",
]);

export function isPrismaNotFound(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";
}
