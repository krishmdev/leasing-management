import Link from "next/link";
import { requireStaff } from "@/server/session";
import { Card, PageHeader } from "@/components/ui";
import { dateLabel } from "@/lib/format";

export const metadata = { title: "Audit log" };

export default async function Audit({ params, searchParams }: { params: Promise<{ agencySlug: string }>; searchParams: Promise<{ action?: string }> }) {
  const [{ agencySlug }, { action }] = await Promise.all([params, searchParams]);
  const ctx = await requireStaff(agencySlug, "audit.read");
  const rows = await ctx.tdb.auditLog.findMany({ where: action ? { action: { startsWith: action } } : {}, orderBy: { createdAt: "desc" }, take: 300 });
  const members = await ctx.tdb.member.findMany({ where: { organizationId: ctx.agencyId }, include: { user: true } });
  const who = new Map(members.map((m) => [m.userId, m.user.name]));
  const filters = ["application", "decision", "lease", "pii", "document", "ticket", "settings", "screening"];
  return (
    <>
      <PageHeader title="Audit log" sub="Append-only: a database trigger rejects UPDATE, DELETE and TRUNCATE. Metadata never holds PII." />
      <div className="mb-3 flex flex-wrap gap-1 text-[12px]">
        <Link href="?" className={`rounded px-2 py-0.5 ${!action ? "bg-ink text-white" : "bg-black/5"}`}>All</Link>
        {filters.map((f) => <Link key={f} href={`?action=${f}`} className={`rounded px-2 py-0.5 ${action === f ? "bg-ink text-white" : "bg-black/5"}`}>{f}</Link>)}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left font-mono text-[12px]">
          <thead className="border-b border-line font-sans text-2xs uppercase tracking-wider text-muted"><tr><th className="px-4 py-2">Time</th><th className="px-4 py-2">Actor</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Entity</th><th className="px-4 py-2">Details</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-1.5 whitespace-nowrap text-muted">{dateLabel(r.createdAt, "America/Los_Angeles", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</td>
                <td className="px-4 py-1.5">{r.actorType.toLowerCase()}{r.actorId && who.get(r.actorId) ? ` · ${who.get(r.actorId)}` : ""}</td>
                <td className="px-4 py-1.5">{r.action}</td>
                <td className="px-4 py-1.5 text-ink-2">{r.entity}{r.entityId ? ` ${r.entityId.slice(-6)}` : ""}</td>
                <td className="max-w-md truncate px-4 py-1.5 text-muted" title={JSON.stringify(r.metadata)}>{JSON.stringify(r.metadata)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
