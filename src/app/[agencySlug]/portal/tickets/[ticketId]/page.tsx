import { notFound, redirect } from "next/navigation";
import { publicAgency } from "@/server/domain/agency";
import { getSession } from "@/server/session";
import { tenantDb } from "@/server/tenant";
import { dateLabel } from "@/lib/format";
import { ResidentReply } from "./ResidentReply";

export const metadata = { title: "Repair request" };

export default async function TicketPage({ params }: { params: Promise<{ agencySlug: string; ticketId: string }> }) {
  const { agencySlug, ticketId } = await params;
  const agency = await publicAgency(agencySlug);
  if (!agency) notFound();
  const session = await getSession();
  if (!session) redirect(`/${agencySlug}/portal`);
  const t = await tenantDb(agency.id).maintenanceTicket.findUnique({ where: { id: ticketId }, include: { comments: { where: { internal: false }, orderBy: { createdAt: "asc" } }, events: { orderBy: { at: "asc" } } } });
  if (!t || t.reporterUserId !== session.user.id) notFound();
  const when = (d: Date) => dateLabel(d, agency.timezone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="mx-auto max-w-2xl px-5 pt-12">
      <p className="text-sm text-muted">Filed {when(t.createdAt)} · {t.urgency.toLowerCase()}</p>
      <h1 className="display mt-1 text-3xl font-semibold">{t.title}</h1>
      <p className="mt-2 inline-block rounded-full bg-brand px-3 py-1 text-sm font-medium text-brand-ink" data-testid="ticket-status">{t.status.toLowerCase().replace("_", " ")}</p>
      <p className="mt-6 whitespace-pre-wrap text-ink-2">{t.description}</p>
      <h2 className="mt-10 font-semibold">Updates</h2>
      <ol className="mt-3 space-y-3">
        {t.events.map((e) => <li key={e.id} className="text-sm"><span className="text-muted">{when(e.at)}</span> · {e.to.toLowerCase().replace("_", " ")}</li>)}
        {t.comments.map((c) => (
          <li key={c.id} className={`rounded-xl p-3 text-sm ${c.authorType === "RESIDENT" ? "ml-10 bg-paper" : "mr-10 bg-surface ring-1 ring-black/5"}`}>
            <p className="text-xs text-muted">{c.authorType === "RESIDENT" ? "You" : agency.name} · {when(c.createdAt)}</p>
            <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ol>
      <ResidentReply slug={agencySlug} ticketId={t.id} />
    </div>
  );
}
