import Link from "next/link";
import { requireStaff } from "@/server/session";
import { Card, PageHeader } from "@/components/ui";
import { dateLabel } from "@/lib/format";

export const metadata = { title: "Audit log" };

const PAGE = 50;
const FILTERS = ["application", "decision", "lease", "pii", "document", "ticket", "settings", "screening", "showing"];

function entityHref(slug: string, entity: string, id: string | null) {
  if (!id) return null;
  if (entity === "Application") return `/dashboard/${slug}/applications/${id}`;
  if (entity === "MaintenanceTicket") return `/dashboard/${slug}/maintenance/${id}`;
  return null;
}

export default async function Audit({ params, searchParams }: { params: Promise<{ agencySlug: string }>; searchParams: Promise<{ action?: string; page?: string }> }) {
  const [{ agencySlug }, { action, page }] = await Promise.all([params, searchParams]);
  const ctx = await requireStaff(agencySlug, "audit.read");
  const p = Math.max(1, Number(page) || 1);
  const where = action ? { action: { startsWith: action } } : {};
  const [rows, total, members] = await Promise.all([
    ctx.tdb.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: PAGE, skip: (p - 1) * PAGE }),
    ctx.tdb.auditLog.count({ where }),
    ctx.tdb.member.findMany({ where: { organizationId: ctx.agencyId }, include: { user: true } }),
  ]);
  const who = new Map(members.map((m) => [m.userId, m.user.name]));
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const q = (o: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams(Object.entries({ action, page: p, ...o }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
    return s ? `?${s}` : "?";
  };
  return (
    <>
      <PageHeader title="Audit log" sub="Append-only: the database rejects edits and deletes. Details never include personal information." />
      <nav aria-label="Filter" className="mb-3 flex flex-wrap gap-1 text-[12px]">
        <Link href={q({ action: "", page: 1 })} className={`inline-flex min-h-7 items-center rounded px-2 ${!action ? "bg-ink text-white" : "bg-black/5"}`}>All</Link>
        {FILTERS.map((f) => (
          <Link key={f} href={q({ action: f, page: 1 })} className={`inline-flex min-h-7 items-center rounded px-2 ${action === f ? "bg-ink text-white" : "bg-black/5"}`}>{f}</Link>
        ))}
      </nav>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[12px]">
          <thead className="border-b border-line text-2xs uppercase tracking-wider text-muted"><tr><th className="px-4 py-2">Time</th><th className="px-4 py-2">Who</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Record</th><th className="px-4 py-2">Details</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No entries{action ? ` for "${action}"` : ""}.</td></tr>
            )}
            {rows.map((r) => {
              const href = entityHref(agencySlug, r.entity, r.entityId);
              const meta = Object.entries((r.metadata ?? {}) as Record<string, unknown>);
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-2 whitespace-nowrap font-mono text-muted">{dateLabel(r.createdAt, "America/Los_Angeles", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</td>
                  <td className="px-4 py-2">{r.actorType.toLowerCase()}{r.actorId && who.get(r.actorId) ? ` · ${who.get(r.actorId)}` : ""}</td>
                  <td className="px-4 py-2 font-mono">{r.action}</td>
                  <td className="px-4 py-2 text-ink-2">
                    {href ? <Link href={href} className="underline underline-offset-2">{r.entity}</Link> : r.entity}
                    {r.entityId && <span className="ml-1 font-mono text-2xs text-muted">{r.entityId.slice(-6)}</span>}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {meta.length === 0 && <span className="text-muted">—</span>}
                      {meta.map(([k, v]) => (
                        <span key={k} className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-2xs">{k}: {Array.isArray(v) ? v.join(", ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <nav aria-label="Pages" className="mt-3 flex items-center justify-between text-[13px]">
        <span className="text-muted">{total} entries · page {p} of {pages}</span>
        <span className="flex gap-2">
          {p > 1 && <Link href={q({ page: p - 1 })} className="inline-flex min-h-8 items-center rounded-md border border-line-strong px-3">Newer</Link>}
          {p < pages && <Link href={q({ page: p + 1 })} className="inline-flex min-h-8 items-center rounded-md border border-line-strong px-3">Older</Link>}
        </span>
      </nav>
    </>
  );
}
