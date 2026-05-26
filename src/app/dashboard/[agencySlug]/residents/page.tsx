import { requireStaff } from "@/server/session";
import { decryptLead } from "@/server/domain/leads/service";
import { maskName } from "@/server/domain/desk/applications";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { human } from "@/components/desk/bits";
import { dayLabel, usd } from "@/lib/format";

export const metadata = { title: "Residents" };

export default async function Residents({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const ctx = await requireStaff(agencySlug, "residents.read");
  const rows = await ctx.tdb.residency.findMany({ where: { status: { in: ["CURRENT", "NOTICE", "FUTURE"] } }, include: { unit: { include: { property: true } }, lead: true }, orderBy: { moveIn: "desc" } });
  return (
    <>
      <PageHeader title="Residents" sub={`${rows.length} current and upcoming residencies`} />
      {rows.length === 0 ? <EmptyState title="No residents yet" /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-[13px]">
            <thead className="border-b border-line text-2xs uppercase tracking-wider text-muted"><tr><th className="px-4 py-2">Resident</th><th className="px-4 py-2">Home</th><th className="px-4 py-2">Term</th><th className="px-4 py-2 text-right">Rent</th><th className="px-4 py-2">Status</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">{r.lead ? maskName(decryptLead(r.lead).name) : "—"}</td>
                  <td className="px-4 py-2">{r.unit.property.name} {r.unit.label}</td>
                  <td className="px-4 py-2 text-ink-2">{dayLabel(r.moveIn, { month: "short", year: "numeric" })} – {r.moveOut ? dayLabel(r.moveOut, { month: "short", year: "numeric" }) : "open"}</td>
                  <td className="px-4 py-2 text-right font-mono">{usd(r.rentCents)}</td>
                  <td className="px-4 py-2"><Badge tone={r.status === "NOTICE" ? "warn" : r.status === "FUTURE" ? "info" : "ok"}>{human(r.status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
