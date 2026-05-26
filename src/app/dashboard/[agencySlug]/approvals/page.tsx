import Link from "next/link";
import { requireStaff } from "@/server/session";
import { maskName } from "@/server/domain/desk/applications";
import { decryptApplication } from "@/server/domain/applications/service";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { OutcomeBadge, human } from "@/components/desk/bits";
import { relative } from "@/lib/format";
import { requestTime } from "@/lib/time";
import { dismissTaskAction } from "../actions";

export const metadata = { title: "Approvals" };

type Tasks = Awaited<ReturnType<typeof loadTasks>>;

async function loadTasks(agencySlug: string) {
  const ctx = await requireStaff(agencySlug, "applications.decide");
  return ctx.tdb.approvalTask.findMany({
    where: { status: "OPEN" },
    include: { application: { include: { unit: { include: { property: true } }, recommendations: { orderBy: { createdAt: "desc" }, take: 1 } } } },
    orderBy: [{ type: "desc" }, { createdAt: "asc" }],
  });
}

function TaskList({ items, empty, agencySlug, now }: { items: Tasks; empty: string; agencySlug: string; now: Date }) {
  return items.length === 0 ? (
      <EmptyState title={empty} />
    ) : (
      <Card className="divide-y divide-line">
        {items.map((t) => {
          const a = t.application;
          const rec = a?.recommendations[0];
          const draft = (t.payload as { draft?: { outcome?: string } }).draft;
          const overdue = t.dueAt && t.dueAt < now;
          return (
            <div key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-48 flex-1">
                {a ? (
                  <Link href={`/dashboard/${agencySlug}/applications/${a.id}`} className="font-medium underline-offset-2 hover:underline">
                    {maskName(decryptApplication(a).legalName)}
                  </Link>
                ) : (
                  <span className="font-medium">Task</span>
                )}
                <p className="text-2xs text-muted">{a ? `${a.unit.property.name} ${a.unit.label}` : ""} · opened {relative(t.createdAt, now)}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {t.escalationReasons.map((r) => <Badge key={r} tone="warn">{human(r)}</Badge>)}
                {draft?.outcome && <span className="text-2xs text-muted">draft:</span>}
                {draft?.outcome && <OutcomeBadge outcome={draft.outcome} />}
              </div>
              <span className="w-12 text-right font-mono text-[13px] tabular">{rec?.rubricScore ?? "—"}</span>
              <span className={`w-20 text-right text-2xs ${overdue ? "font-semibold text-bad" : "text-muted"}`}>{t.dueAt ? (overdue ? "overdue" : `due ${relative(t.dueAt, now)}`) : ""}</span>
              <div className="flex gap-2">
                {a && <Link href={`/dashboard/${agencySlug}/applications/${a.id}`} className="rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-white">Review</Link>}
                <form action={dismissTaskAction.bind(null, agencySlug, t.id)}>
                  <button className="rounded-md border border-line-strong px-3 py-1.5 text-[13px]">Dismiss</button>
                </form>
              </div>
            </div>
          );
        })}
      </Card>
    );
}


export default async function Approvals({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const now = new Date(await requestTime());
  const tasks = await loadTasks(agencySlug);
  const escalations = tasks.filter((t) => t.type === "ESCALATION");
  const drafts = tasks.filter((t) => t.type !== "ESCALATION");

  return (
    <>
      <PageHeader title="Approvals" sub="Drafted decisions wait here for a person. Escalations are cases the agent won't decide: flags, caps, pauses, or lost races for a unit." />
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold">Escalations <span className="font-mono text-muted">{escalations.length}</span></h2>
        <TaskList items={escalations} empty="Nothing escalated" agencySlug={agencySlug} now={now} />
      </section>
      <section className="mt-6 space-y-2">
        <h2 className="text-[13px] font-semibold">Drafted decisions <span className="font-mono text-muted">{drafts.length}</span></h2>
        <TaskList items={drafts} empty="No drafts waiting" agencySlug={agencySlug} now={now} />
      </section>
    </>
  );
}
