import { requireStaff } from "@/server/session";
import { decryptLead } from "@/server/domain/leads/service";
import { maskName } from "@/server/domain/desk/applications";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { human } from "@/components/desk/bits";
import { dateLabel, timeLabel } from "@/lib/format";
import { requestTime } from "@/lib/time";
import { markShowingAction } from "../actions";

export const metadata = { title: "Showings" };

export default async function Showings({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const ctx = await requireStaff(agencySlug, "showings.manage");
  const now = await requestTime();
  const [rows, rules, members] = await Promise.all([
    ctx.tdb.showing.findMany({ where: { startsAt: { gte: new Date(now - 7 * 86_400_000) } }, include: { unit: { include: { property: true } }, lead: true }, orderBy: { startsAt: "asc" }, take: 200 }),
    ctx.tdb.availabilityRule.findMany({ orderBy: [{ weekday: "asc" }, { startMin: "asc" }] }),
    ctx.tdb.member.findMany({ where: { organizationId: ctx.agencyId }, include: { user: true } }),
  ]);
  const name = new Map(members.map((m) => [m.userId, m.user.name]));
  const tz = "America/Los_Angeles";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  return (
    <>
      <PageHeader title="Showings" sub="The database rejects double-booking an agent (exclusion constraint), so two people racing for one slot can't both get it." />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {rows.length === 0 ? (
          <EmptyState title="No showings this week" />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="border-b border-line text-2xs uppercase tracking-wider text-muted">
                <tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Home</th><th className="px-4 py-2">Prospect</th><th className="px-4 py-2">Agent</th><th className="px-4 py-2">Status</th><th className="px-4 py-2" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((s) => (
                  <tr key={s.id} className={s.startsAt.getTime() < now ? "text-ink-2" : ""}>
                    <td className="px-4 py-2 whitespace-nowrap">{dateLabel(s.startsAt, tz, { weekday: "short", month: "short", day: "numeric" })} · {timeLabel(s.startsAt, tz)}</td>
                    <td className="px-4 py-2">{s.unit.property.name} {s.unit.label}</td>
                    <td className="px-4 py-2">{maskName(decryptLead(s.lead).name)}</td>
                    <td className="px-4 py-2">{name.get(s.agentUserId) ?? "—"}</td>
                    <td className="px-4 py-2"><Badge tone={s.status === "NO_SHOW" ? "bad" : s.status === "COMPLETED" ? "ok" : s.status === "CANCELED" ? "neutral" : "info"}>{human(s.status)}</Badge></td>
                    <td className="px-4 py-2 text-right">
                      {s.status === "SCHEDULED" && s.startsAt.getTime() < now && (
                        <div className="flex justify-end gap-1.5">
                          <form action={markShowingAction.bind(null, agencySlug, s.id, "COMPLETED")}><button className="rounded border border-line-strong px-2 py-0.5 text-2xs">Attended</button></form>
                          <form action={markShowingAction.bind(null, agencySlug, s.id, "NO_SHOW")}><button className="rounded border border-line-strong px-2 py-0.5 text-2xs">No-show</button></form>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <Card>
          <div className="border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">Weekly availability</h2><p className="text-xs text-muted">Agency time (Pacific). Slots are generated per local day, so DST changes don&apos;t shift them.</p></div>
          <ul className="divide-y divide-line text-[13px]">
            {rules.map((r) => <li key={r.id} className="flex justify-between px-4 py-1.5"><span>{days[r.weekday]} · {name.get(r.agentUserId)}</span><span className="font-mono text-2xs">{hm(r.startMin)}–{hm(r.endMin)} / {r.slotMin}m</span></li>)}
            {rules.length === 0 && <li className="px-4 py-3 text-muted">No availability set.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
