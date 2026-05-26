import Link from "next/link";
import { requireStaff } from "@/server/session";
import { Badge, EmptyState, PageHeader, Stat } from "@/components/ui";
import { UrgencyBadge, human } from "@/components/desk/bits";
import { SlaChip } from "@/components/desk/SlaChip";
import { relative } from "@/lib/format";
import { requestTime } from "@/lib/time";

export const metadata = { title: "Maintenance" };

const COLUMNS = [
  ["Triage", ["NEW", "TRIAGED"]],
  ["Assigned", ["ASSIGNED"]],
  ["In progress", ["IN_PROGRESS"]],
  ["On hold", ["ON_HOLD"]],
  ["Resolved", ["RESOLVED"]],
] as const;
const RANK = { EMERGENCY: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export default async function Maintenance({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const ctx = await requireStaff(agencySlug, "maintenance.read");
  const now = new Date(await requestTime());
  const tickets = await ctx.tdb.maintenanceTicket.findMany({
    where: { OR: [{ status: { notIn: ["CLOSED", "CANCELED", "RESOLVED"] } }, { status: "RESOLVED", resolvedAt: { gte: new Date(now.getTime() - 14 * 86_400_000) } }] },
    include: { unit: { include: { property: true } } },
    orderBy: { createdAt: "asc" },
  });
  const staff = await ctx.tdb.member.findMany({ where: { organizationId: ctx.agencyId }, include: { user: true } });
  const nameOf = new Map(staff.map((m) => [m.userId, m.user.name]));
  const open = tickets.filter((t) => t.status !== "RESOLVED");
  const breached = open.filter((t) => t.respondBreached || t.resolveBreached).length;
  const emergencies = open.filter((t) => t.urgency === "EMERGENCY").length;
  const accommodation = open.filter((t) => t.possibleAccommodationRequest).length;

  return (
    <>
      <PageHeader title="Maintenance" sub="Safety rules set emergencies before any classifier runs. SLA clocks pause while a ticket is on hold." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open tickets" value={open.length} />
        <Stat label="Emergencies" value={emergencies} tone={emergencies ? "bad" : undefined} />
        <Stat label="SLA breached" value={breached} tone={breached ? "bad" : "ok"} />
        <Stat label="Possible accommodation" value={accommodation} sub="routed to a person" />
      </div>
      {tickets.length === 0 ? (
        <EmptyState title="No open tickets">Residents file requests from the portal on your public site.</EmptyState>
      ) : (
        <div className="grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3">
          {COLUMNS.map(([label, statuses]) => {
            const col = tickets.filter((t) => (statuses as readonly string[]).includes(t.status)).sort((a, b) => RANK[a.urgency] - RANK[b.urgency] || a.createdAt.getTime() - b.createdAt.getTime());
            return (
              <section key={label} aria-label={label} className="rounded-lg border border-line bg-[#efede7] p-2">
                <header className="mb-2 flex justify-between px-1">
                  <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-2">{label}</h2>
                  <span className="font-mono text-2xs text-muted">{col.length}</span>
                </header>
                <ul className="space-y-1.5">
                  {col.length === 0 && <li className="py-6 text-center text-2xs text-muted">Empty</li>}
                  {col.map((t) => (
                    <li key={t.id}>
                      <Link href={`/dashboard/${agencySlug}/maintenance/${t.id}`} className={`block rounded-md border bg-surface p-2.5 hover:border-line-strong ${t.urgency === "EMERGENCY" ? "border-bad/50 border-l-4 border-l-bad" : "border-line"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[13px] font-medium leading-snug">{t.title}</p>
                          <SlaChip t={t} now={now} />
                        </div>
                        <p className="mt-0.5 truncate text-2xs text-muted">{t.unit.property.name} {t.unit.label} · {human(t.category)}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <UrgencyBadge urgency={t.urgency} />
                          {t.possibleAccommodationRequest && <Badge tone="info">accommodation?</Badge>}
                          {t.safetyRule && <Badge tone="bad">rule: {t.safetyRule}</Badge>}
                          <span className="ml-auto text-2xs text-muted">{t.assigneeUserId ? nameOf.get(t.assigneeUserId) : "unassigned"} · {relative(t.createdAt, now)}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
