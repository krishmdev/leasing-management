import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/server/session";
import { can, homeFor } from "@/server/access";
import { dashboardMetrics } from "@/server/domain/metrics/metrics";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { FunnelBars } from "@/components/charts/FunnelBars";
import { MovesChart } from "@/components/charts/MovesChart";
import { human } from "@/components/desk/bits";
import { usd } from "@/lib/format";
import { requestTime } from "@/lib/time";

export const metadata = { title: "Overview" };

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export default async function Overview({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const base = await requireStaff(agencySlug);
  if (!can(base.role, "metrics.read")) redirect(homeFor(agencySlug, base.role));
  const ctx = base;
  const m = await dashboardMetrics(ctx.tdb, new Date(await requestTime()));
  return (
    <>
      <PageHeader
        title="Overview"
        sub={`${ctx.agencyName} · funnel and showings over the last 90 days, maintenance over 30`}
        actions={m.openApprovals > 0 && <Link href={`/dashboard/${agencySlug}/approvals`} className="rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-white">{m.openApprovals} waiting for approval</Link>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Occupancy" value={pct(m.occupancy)} sub={`${m.units - m.vacantUnits} of ${m.units} units`} />
        <Stat label="Vacancy loss to date" value={usd(m.vacancyLossCents)} sub={`${m.vacantUnits} vacant · ${m.vacantDays} unit-days`} />
        <Stat label="T12 turnover" value={pct(m.t12Turnover)} sub={`${m.moveOuts12} move-outs / ${m.units} units`} />
        <Stat label="Showing no-shows" value={pct(m.noShowRate)} sub={`of ${m.showingsAttended} past showings`} />
        <Stat label="Screening turnaround" value={m.turnaroundH == null ? "—" : `${m.turnaroundH.toFixed(1)}h`} sub={`median, ${m.screenedCount} reports`} />
        <Stat label="Maintenance SLA met" value={pct(m.sla.rate)} tone={m.sla.rate != null && m.sla.rate < 0.9 ? "warn" : undefined} sub={`${m.sla.onTime} of ${m.sla.resolved} resolved`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Leasing funnel" sub="Prospects who reached each stage. Conversion is from the stage above; days is median time spent in the stage." />
          <div className="p-4"><FunnelBars rows={m.funnel} /></div>
        </Card>
        <Card>
          <CardHeader title="Move-ins and move-outs" sub="Residencies by month, last 18 months" />
          <div className="p-4"><MovesChart data={m.months} /></div>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Maintenance by urgency" sub="Tickets resolved in the last 30 days. Time on hold doesn't count toward resolution time." />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line text-2xs uppercase tracking-wider text-muted">
              <tr><th className="px-4 py-2 font-medium">Urgency</th><th className="px-4 py-2 text-right font-medium">Resolved</th><th className="px-4 py-2 text-right font-medium">Within SLA</th><th className="px-4 py-2 text-right font-medium">Median time to resolve</th></tr>
            </thead>
            <tbody className="divide-y divide-line font-mono">
              {m.sla.byUrgency.map((u) => (
                <tr key={u.urgency}>
                  <td className="px-4 py-2 font-sans capitalize">{human(u.urgency)}</td>
                  <td className="px-4 py-2 text-right">{u.resolved}</td>
                  <td className="px-4 py-2 text-right">{u.resolved ? `${u.onTime} (${Math.round((u.onTime / u.resolved) * 100)}%)` : "—"}</td>
                  <td className="px-4 py-2 text-right">{u.medianHours == null ? "—" : u.medianHours < 48 ? `${u.medianHours.toFixed(1)}h` : `${(u.medianHours / 24).toFixed(1)}d`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
