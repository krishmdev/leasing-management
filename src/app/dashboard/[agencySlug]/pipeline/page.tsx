import { requireStaff } from "@/server/session";
import { decryptLead } from "@/server/domain/leads/service";
import { maskName } from "@/server/domain/desk/applications";
import { PageHeader } from "@/components/ui";
import { requestTime } from "@/lib/time";
import { Kanban } from "./Kanban";

export const metadata = { title: "Pipeline" };

export default async function Pipeline({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const ctx = await requireStaff(agencySlug, "applications.read");
  const now = await requestTime();
  const opps = await ctx.tdb.opportunity.findMany({
    where: { OR: [{ stage: { not: "LOST" } }, { stageChangedAt: { gte: new Date(now - 30 * 86_400_000) } }] },
    include: { lead: true, unit: { include: { property: true } } },
    orderBy: { stageChangedAt: "desc" },
    take: 400,
  });
  const cards = opps.map((o) => ({
    id: o.id,
    stage: o.stage,
    name: maskName(decryptLead(o.lead).name),
    unit: `${o.unit.property.name} ${o.unit.label}`,
    days: Math.floor((now - o.stageChangedAt.getTime()) / 86_400_000),
  }));
  return (
    <>
      <PageHeader title="Pipeline" sub="Cards move on their own as prospects book, apply, get screened and sign. You can drag between Interest and Showing, or to Lost." />
      <Kanban slug={agencySlug} cards={cards} />
    </>
  );
}
