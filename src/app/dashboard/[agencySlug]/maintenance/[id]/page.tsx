import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/session";
import { nextStatuses } from "@/server/domain/maintenance/stateMachine";
import { SAFETY_RULES } from "@/server/domain/maintenance/rules";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { UrgencyBadge, human } from "@/components/desk/bits";
import { SlaChip } from "@/components/desk/SlaChip";
import { dateLabel } from "@/lib/format";
import { requestTime } from "@/lib/time";
import { TicketControls } from "./TicketControls";

export const metadata = { title: "Ticket" };

export default async function Ticket({ params }: { params: Promise<{ agencySlug: string; id: string }> }) {
  const { agencySlug, id } = await params;
  const ctx = await requireStaff(agencySlug, "maintenance.read");
  const now = new Date(await requestTime());
  const t = await ctx.tdb.maintenanceTicket.findUnique({ where: { id }, include: { unit: { include: { property: true } }, photos: true, comments: { orderBy: { createdAt: "asc" } }, events: { orderBy: { at: "asc" } } } });
  if (!t) notFound();
  const staff = await ctx.tdb.member.findMany({ where: { organizationId: ctx.agencyId, role: { in: ["maintenance", "agent", "owner", "admin"] } }, include: { user: true } });
  const names = new Map(staff.map((m) => [m.userId, m.user.name]));
  const rule = SAFETY_RULES.find((r) => r.id === t.safetyRule);
  const ai = t.aiTriage as { category?: string; urgency?: string; confidence?: number; source?: string } | null;
  const tz = "America/Los_Angeles";
  const when = (d: Date | null) => (d ? dateLabel(d, tz, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

  return (
    <>
      <PageHeader
        crumbs={<Link href={`/dashboard/${agencySlug}/maintenance`} className="hover:underline">Maintenance</Link>}
        title={t.title}
        sub={`${t.unit.property.name} ${t.unit.label} · ${human(t.category)} · filed ${when(t.createdAt)}`}
        actions={<><UrgencyBadge urgency={t.urgency} /><Badge>{human(t.status)}</Badge><SlaChip t={t} now={now} /></>}
      />
      {rule && <div className="mb-4"><Alert tone="bad" title={`Safety rule matched: ${rule.id}`}>{rule.instructions}</Alert></div>}
      {t.possibleAccommodationRequest && <div className="mb-4"><Alert tone="info" title="Possible reasonable-accommodation request">A person should handle this one directly. It was not auto-triaged.</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Description" sub={t.permissionToEnter ? "Permission to enter: yes" : "Permission to enter: no, schedule with the resident"} />
            <p className="whitespace-pre-wrap p-4 text-[13px] leading-relaxed">{t.description}</p>
            {t.photos.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pb-4">
                {t.photos.map((p) => (
                  <a key={p.id} href={`/api/files/${p.storageKey}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/files/${p.thumbKey}`} alt="Photo from the resident" className="size-24 rounded-md object-cover ring-1 ring-line" />
                  </a>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Conversation" sub="Internal notes are hidden from the resident." />
            <ul className="divide-y divide-line">
              {t.comments.length === 0 && <li className="p-4 text-[13px] text-muted">No messages yet.</li>}
              {t.comments.map((c) => (
                <li key={c.id} className={`px-4 py-3 text-[13px] ${c.internal ? "bg-warn-bg/40" : ""}`}>
                  <p className="text-2xs text-muted">{c.authorType === "RESIDENT" ? "Resident" : (names.get(c.authorUserId ?? "") ?? "Staff")} · {when(c.createdAt)}{c.internal && " · internal"}</p>
                  <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-4">
          <TicketControls
            slug={agencySlug}
            ticketId={t.id}
            next={nextStatuses(t.status)}
            assignee={t.assigneeUserId}
            staff={staff.map((m) => ({ id: m.userId, name: `${m.user.name} (${m.role})` }))}
          />
          <Card>
            <CardHeader title="Triage and SLA" />
            <dl className="space-y-1 p-4 text-[13px]">
              <div className="flex justify-between gap-3"><dt className="text-muted">Set by</dt><dd className="text-right">{{ RULE: "Safety rule", LLM: "Language model", OFFLINE: "Keyword classifier", HUMAN: "Staff" }[t.triageSource ?? ""] ?? "—"}</dd></div>
              {ai && <div className="flex justify-between gap-3"><dt className="text-muted">Automatic guess</dt><dd className="text-right">{human(ai.category ?? "")}, {human(ai.urgency ?? "")} urgency{(ai.confidence ?? 0) < 0.5 ? " (low confidence)" : ""}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">Respond by</dt><dd className={t.respondBreached ? "text-bad" : ""}>{when(t.slaRespondBy)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">First response</dt><dd>{when(t.firstRespondedAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Resolve by</dt><dd className={t.resolveBreached ? "text-bad" : ""}>{when(t.slaResolveBy)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Paused</dt><dd className="font-mono">{Math.round(t.pausedMs / 60000)} min</dd></div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="History" />
            <ol className="space-y-1 p-4 font-mono text-2xs text-ink-2">
              {t.events.map((e) => (
                <li key={e.id}><span className="text-muted">{when(e.at)}</span> {e.from ? `${human(e.from)} → ` : ""}{human(e.to)} {e.note && <span className="text-muted">({e.note})</span>}</li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
