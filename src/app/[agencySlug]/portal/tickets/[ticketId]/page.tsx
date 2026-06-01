import { notFound, redirect } from "next/navigation";
import { publicAgency } from "@/server/domain/agency";
import { getSession } from "@/server/session";
import { tenantDb } from "@/server/tenant";
import { dateLabel } from "@/lib/format";
import { ResidentReply } from "./ResidentReply";
import { TicketStatusStepper } from "./TicketStatusStepper";

export const metadata = { title: "Repair request" };

export default async function TicketPage({ params }: { params: Promise<{ agencySlug: string; ticketId: string }> }) {
  const { agencySlug, ticketId } = await params;
  const agency = await publicAgency(agencySlug);
  if (!agency) notFound();
  const session = await getSession();
  if (!session) redirect(`/${agencySlug}/portal`);

  const t = await tenantDb(agency.id).maintenanceTicket.findUnique({
    where: { id: ticketId },
    include: {
      photos: true,
      comments: { where: { internal: false }, orderBy: { createdAt: "asc" } },
      events: { orderBy: { at: "asc" } },
    },
  });
  if (!t || t.reporterUserId !== session.user.id) notFound();

  let technicianName: string | null = null;
  if (t.assigneeUserId) {
    const member = await tenantDb(agency.id).member.findFirst({
      where: { organizationId: agency.id, userId: t.assigneeUserId },
      include: { user: true },
    });
    technicianName = member?.user?.name ?? null;
  }

  const when = (d: Date) => dateLabel(d, agency.timezone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="mx-auto max-w-2xl px-5 pt-12">
      <p className="text-sm text-muted">Filed {when(t.createdAt)} · {t.urgency.toLowerCase()}</p>
      <h1 className="display mt-1 text-3xl font-semibold">{t.title}</h1>

      <TicketStatusStepper status={t.status} technicianName={technicianName} />

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-ink-2">
          <span>🚪</span>
          <span>{t.permissionToEnter ? "Permission to enter granted" : "Staff will coordinate entry (permission not granted)"}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-ink-2">
          <span>🔧</span>
          <span>{technicianName ? `Assigned to ${technicianName}` : "Technician: Pending assignment"}</span>
        </span>
      </div>

      <p className="mt-6 whitespace-pre-wrap text-ink-2 leading-relaxed">{t.description}</p>

      {t.photos && t.photos.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-ink">Attachments ({t.photos.length})</h2>
          <div className="mt-2.5 flex flex-wrap gap-3" data-testid="ticket-attachments">
            {t.photos.map((p, i) => (
              <a
                key={p.id}
                href={`/api/files/${p.storageKey}`}
                target="_blank"
                rel="noreferrer"
                className="group block overflow-hidden rounded-xl border border-line bg-surface shadow-xs transition hover:border-line-strong hover:shadow-sm"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/files/${p.thumbKey}`}
                  alt={`Photo ${i + 1} for ${t.title}`}
                  className="size-24 object-cover transition-transform group-hover:scale-105"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      <h2 className="mt-10 font-semibold">Updates</h2>
      <ol className="mt-3 space-y-3">
        {t.events.map((e) => (
          <li key={e.id} className="text-sm">
            <span className="text-muted">{when(e.at)}</span> · {e.to.toLowerCase().replace("_", " ")}
          </li>
        ))}
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
