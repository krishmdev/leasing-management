import Link from "next/link";
import { requireStaff } from "@/server/session";
import { listApplications, STATUS_GROUPS } from "@/server/domain/desk/applications";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { AppStatus, OutcomeBadge } from "@/components/desk/bits";
import { relative, usd } from "@/lib/format";
import { requestTime } from "@/lib/time";

export const metadata = { title: "Applications" };

export default async function Applications({ params, searchParams }: { params: Promise<{ agencySlug: string }>; searchParams: Promise<{ view?: string }> }) {
  const [{ agencySlug }, { view = "active" }] = await Promise.all([params, searchParams]);
  const ctx = await requireStaff(agencySlug, "applications.read");
  const g = (view in STATUS_GROUPS ? view : "active") as keyof typeof STATUS_GROUPS;
  const rows = await listApplications(ctx, g);
  const now = new Date(await requestTime());
  const tabs = [["active", "In progress"], ["decision", "Needs decision"], ["done", "Closed"], ["drafts", "Drafts"]] as const;
  return (
    <>
      <PageHeader title="Applications" sub="Names are shortened here. Full details are revealed per application, with a reason, and logged." />
      <div className="mb-3 flex gap-1 text-[13px]" role="tablist">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`?view=${k}`} role="tab" aria-selected={g === k} className={`rounded-md px-2.5 py-1 ${g === k ? "bg-ink text-white" : "text-ink-2 hover:bg-black/5"}`}>
            {label}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No applications here">Applications appear once someone starts one from the public site.</EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="border-b border-line text-2xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Applicant</th>
                <th className="px-4 py-2 font-medium">Home</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Recommendation</th>
                <th className="px-4 py-2 text-right font-medium">Score</th>
                <th className="px-4 py-2 text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((a) => {
                const rec = a.recommendations[0];
                return (
                  <tr key={a.id} className="hover:bg-paper">
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/${agencySlug}/applications/${a.id}`} className="font-medium text-ink underline-offset-2 hover:underline">{a.displayName}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{a.unit.property.name} {a.unit.label} <span className="text-muted">· {usd(a.unit.rentCents)}</span></td>
                    <td className="px-4 py-2.5"><AppStatus status={a.status} /></td>
                    <td className="px-4 py-2.5">{rec ? <OutcomeBadge outcome={rec.outcome} /> : <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular">{rec?.rubricScore ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right text-muted">{relative(a.statusChangedAt, now)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
