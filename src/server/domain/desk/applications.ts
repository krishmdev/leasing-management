import type { ApplicationStatus } from "@/generated/prisma/client";
import type { StaffCtx } from "@/server/session";
import { assertCan } from "@/server/access";
import { audit } from "@/server/audit/audit";
import { decryptLead } from "@/server/domain/leads/service";
import { decryptApplication, decryptResidence } from "@/server/domain/applications/service";

export const STATUS_GROUPS: Record<string, ApplicationStatus[]> = {
  active: ["SUBMITTED", "REFERENCES_PENDING", "SCREENING", "SCREENED", "DECISION_PENDING", "APPROVED", "CONDITIONAL", "LEASE_SENT"],
  decision: ["DECISION_PENDING"],
  done: ["LEASE_SIGNED", "DECLINED", "WITHDRAWN"],
  drafts: ["DRAFT"],
};

export function maskName(name: string | null) {
  if (!name) return "Unnamed applicant";
  const [first, ...rest] = name.trim().split(/\s+/);
  return rest.length ? `${first} ${rest.at(-1)![0]}.` : first;
}

export async function listApplications(ctx: StaffCtx, group: keyof typeof STATUS_GROUPS = "active") {
  assertCan(ctx.role, "applications.read");
  const rows = await ctx.tdb.application.findMany({
    where: { status: { in: STATUS_GROUPS[group] ?? STATUS_GROUPS.active } },
    include: { unit: { include: { property: true } }, recommendations: { orderBy: { createdAt: "desc" }, take: 1 }, hold: true },
    orderBy: { statusChangedAt: "desc" },
    take: 200,
  });
  return rows.map((a) => ({ ...a, displayName: maskName(decryptApplication(a).legalName) }));
}

export async function applicationDetail(ctx: StaffCtx, id: string) {
  assertCan(ctx.role, "applications.read");
  const app = await ctx.tdb.application.findUnique({
    where: { id },
    include: {
      unit: { include: { property: true } },
      criteria: true,
      steps: { orderBy: { createdAt: "asc" } },
      recommendations: { orderBy: { createdAt: "desc" } },
      decisions: { orderBy: { createdAt: "desc" } },
      references: { include: { response: true }, orderBy: { createdAt: "asc" } },
      screeningRequests: { include: { result: true } },
      documents: { orderBy: { createdAt: "asc" } },
      tasks: { orderBy: { createdAt: "desc" } },
      consents: true,
      hold: true,
      lease: true,
      residences: { orderBy: { startDate: "desc" } },
      adverseAction: true,
    },
  });
  if (!app) return null;
  const history = await ctx.tdb.auditLog.findMany({ where: { entityId: { in: [id, ...app.screeningRequests.map((s) => s.id), ...(app.lease ? [app.lease.id] : [])] } }, orderBy: { createdAt: "asc" } });
  const llm = await ctx.tdb.llmCall.findMany({ where: { applicationId: id }, select: { purpose: true, provider: true, model: true, promptVersion: true, latencyMs: true, createdAt: true } });
  return { app, history, llm, displayName: maskName(decryptApplication(app).legalName) };
}

/** Full PII, only on request, only with a stated purpose, and always audited. */
export async function revealApplicantPII(ctx: StaffCtx, id: string, purpose: string) {
  assertCan(ctx.role, "pii.reveal");
  if (purpose.trim().length < 4) throw new Error("Say why you need this");
  const app = await ctx.tdb.application.findUniqueOrThrow({ where: { id }, include: { lead: true, residences: true } });
  await audit({ agencyId: ctx.agencyId, actorType: "USER", actorId: ctx.userId, action: "application.pii.revealed", entity: "Application", entityId: id, metadata: { purposeLength: purpose.length, purposeCategory: purpose.slice(0, 40).replace(/[^\w\s-]/g, "") } }, ctx.tdb);
  return {
    ...decryptApplication(app),
    ...(() => {
      const l = decryptLead(app.lead);
      return { email: l.email, leadPhone: l.phone };
    })(),
    residences: app.residences.map((r) => ({ id: r.id, ...decryptResidence(r), startDate: r.startDate, endDate: r.endDate, monthlyRentCents: r.monthlyRentCents })),
    totalOccupants: app.totalOccupants,
  };
}
