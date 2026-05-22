import { Prisma } from "@/generated/prisma/client";
import { db, type Db } from "@/server/db";
import { RELATIONS } from "@/server/relations.generated";

/**
 * Models that belong to one agency. The tenant client below adds `agencyId` to every where
 * clause and every create for these, so a service holding a tenant client can't read or write
 * another agency's rows even if it is handed a foreign id.
 *
 * It is one of three layers:
 *  1. this client (where/data stamping, no nested writes, no raw SQL, no reach-through from
 *     global models like Organization into tenant tables);
 *  2. composite foreign keys (agencyId, xId) -> (agencyId, id) on every tenant-to-tenant
 *     relation, so a row can't point at another agency's row and includes can't cross tenants;
 *  3. raw SQL on a tenant client (the few row locks) must mention "agencyId" and bind this
 *     tenant's id as a parameter; *Unsafe variants are refused outright.
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
  "aggregate", "groupBy", "update", "updateMany", "updateManyAndReturn", "delete", "deleteMany", "upsert",
]);
const DATA_OPS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert"]);

export class TenantViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantViolation";
  }
}

function checkData(model: string, agencyId: string, data: unknown, stamp: boolean): Record<string, unknown> {
  const d = { ...(data as Record<string, unknown>) };
  const rels = RELATIONS[model] ?? {};
  for (const k of Object.keys(d)) {
    if (k in rels) throw new TenantViolation(`nested write through ${model}.${k} is not allowed on a tenant client; write ${rels[k]} separately with flat foreign keys`);
  }
  if (d.agencyId !== undefined && d.agencyId !== agencyId) throw new TenantViolation(`refusing to write ${model} for a different agency`);
  if (stamp) d.agencyId = agencyId;
  return d;
}

/** Global models (Organization, User, Member...) may be read, but not used to reach tenant rows. */
function checkGlobalArgs(model: string, args: Record<string, unknown>) {
  const rels = RELATIONS[model] ?? {};
  for (const key of ["include", "select", "where", "orderBy"] as const) {
    const v = args[key];
    if (!v || typeof v !== "object") continue;
    const entries = Array.isArray(v) ? v.flatMap((o) => Object.keys(o as object)) : Object.keys(v);
    for (const k of entries) {
      if (k === "_count" || (k in rels && TENANT_MODELS.has(rels[k]))) {
        throw new TenantViolation(`${model}.${key}.${k} reaches into tenant data; query the tenant model directly`);
      }
    }
  }
}

function rawAllowed(args: unknown, agencyId: string) {
  const sql = args as { strings?: readonly string[]; values?: readonly unknown[] } | undefined;
  if (!sql || !Array.isArray(sql.strings) || !Array.isArray(sql.values)) return false; // *Unsafe variants
  return sql.strings.join("?").includes('"agencyId"') && sql.values.includes(agencyId);
}

export function tenantDb(agencyId: string, base: Db = db()) {
  if (!agencyId) throw new Error("tenantDb needs an agencyId");
  return base.$extends({
    name: "tenant",
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (!model) {
          if (/raw/i.test(operation) && (/unsafe/i.test(operation) || !rawAllowed(args, agencyId))) {
            throw new TenantViolation(`${operation} is not available on a tenant client; use tenantRaw(agencyId, tx)`);
          }
          return query(args);
        }
        const a = { ...((args ?? {}) as Record<string, unknown>) };
        if (!TENANT_MODELS.has(model)) {
          checkGlobalArgs(model, a);
          if (DATA_OPS.has(operation)) {
            for (const k of Object.keys((a.data ?? {}) as object)) {
              if (k in (RELATIONS[model] ?? {})) throw new TenantViolation(`nested write through ${model}.${k} is not allowed on a tenant client`);
            }
          }
          return query(a as typeof args);
        }
        if (WHERE_OPS.has(operation)) a.where = { ...((a.where as object) ?? {}), agencyId };
        switch (operation) {
          case "create":
            a.data = checkData(model, agencyId, a.data, true);
            break;
          case "createMany":
          case "createManyAndReturn":
            a.data = (Array.isArray(a.data) ? a.data : [a.data]).map((r) => checkData(model, agencyId, r, true));
            break;
          case "update":
          case "updateMany":
          case "updateManyAndReturn":
            a.data = checkData(model, agencyId, a.data, false);
            break;
          case "upsert":
            a.create = checkData(model, agencyId, a.create, true);
            a.update = checkData(model, agencyId, a.update, false);
            break;
        }
        return query(a as typeof args);
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
export type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

type RawClient = { $queryRaw: (sql: Prisma.Sql) => Promise<unknown>; $executeRaw: (sql: Prisma.Sql) => Promise<number> };

/**
 * Raw SQL for one tenant: `tenantRaw(agencyId, tx).query\`SELECT ... WHERE "agencyId" = ${agencyId} FOR UPDATE\``.
 * Refuses statements that don't filter on "agencyId" with this tenant's id as a bound value.
 */
export function tenantRaw(agencyId: string, client: RawClient = db() as unknown as RawClient) {
  const guard = (strings: TemplateStringsArray, values: unknown[]) => {
    const text = strings.join("?");
    if (!text.includes('"agencyId"')) throw new TenantViolation("raw tenant SQL must filter on \"agencyId\"");
    if (!values.includes(agencyId)) throw new TenantViolation("raw tenant SQL must bind this tenant's agencyId");
    return Prisma.sql(strings, ...values);
  };
  return {
    query<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
      return client.$queryRaw(guard(strings, values)) as Promise<T>;
    },
    execute(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> {
      return client.$executeRaw(guard(strings, values));
    },
  };
}

export async function agencyBySlug(slug: string) {
  return db().organization.findUnique({ where: { slug }, include: { settings: true } });
}

export const RESERVED_SLUGS = new Set([
  "dashboard", "api", "login", "r", "mock-provider", "_next", "check-email", "portal", "static", "favicon.ico",
]);

export function isPrismaNotFound(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";
}
