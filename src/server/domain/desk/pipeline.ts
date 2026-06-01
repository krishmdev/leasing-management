import type { TenantDb } from "@/server/tenant";
import { decryptLead } from "@/server/domain/leads/service";
import { maskName } from "./applications";

/** Kanban cards: open opportunities, plus ones lost in the last 30 days. Purged leads show as tombstones. */
export async function pipelineCards(t: TenantDb, now: number) {
  const opps = await t.opportunity.findMany({
    where: { OR: [{ stage: { not: "LOST" } }, { stageChangedAt: { gte: new Date(now - 30 * 86_400_000) } }] },
    include: { lead: true, unit: { include: { property: true } } },
    orderBy: { stageChangedAt: "desc" },
    take: 400,
  });
  const apps = await t.application.findMany({ where: { OR: opps.map((o) => ({ leadId: o.leadId, unitId: o.unitId })) }, select: { id: true, leadId: true, unitId: true } });
  return opps.map((o) => {
    const lead = decryptLead(o.lead);
    return {
      id: o.id,
      stage: o.stage,
      name: lead.purged ? lead.name : maskName(lead.name),
      unit: `${o.unit.property.name} ${o.unit.label}`,
      days: Math.floor((now - o.stageChangedAt.getTime()) / 86_400_000),
      applicationId: apps.find((a) => a.leadId === o.leadId && a.unitId === o.unitId)?.id ?? null,
    };
  });
}
