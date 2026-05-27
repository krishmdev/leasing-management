import Link from "next/link";
import { notFound } from "next/navigation";
import { publicAgency } from "@/server/domain/agency";
import { getSession } from "@/server/session";
import { tenantDb } from "@/server/tenant";
import { residencyFor } from "@/server/domain/maintenance/portal";
import { PortalSignIn } from "./PortalSignIn";
import { dateLabel } from "@/lib/format";

export const metadata = { title: "Resident portal" };

export default async function Portal({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const agency = await publicAgency(agencySlug);
  if (!agency) notFound();
  const session = await getSession();
  if (!session) {
    return (
      <div className="mx-auto max-w-md px-5 pt-16">
        <h1 className="display text-4xl font-semibold">Resident portal</h1>
        <p className="mt-2 text-ink-2">Request repairs and follow their progress. Sign in with the email on your lease.</p>
        <PortalSignIn slug={agencySlug} />
      </div>
    );
  }
  const residency = await residencyFor(agency.id, session.user.id);
  if (!residency) {
    return (
      <div className="mx-auto max-w-md px-5 pt-16">
        <h1 className="display text-3xl font-semibold">No lease found</h1>
        <p className="mt-2 text-ink-2">{session.user.email} isn&apos;t on a current lease with {agency.name}. Call {agency.contact.phone} if that&apos;s wrong.</p>
      </div>
    );
  }
  const tickets = await tenantDb(agency.id).maintenanceTicket.findMany({ where: { reporterUserId: session.user.id }, orderBy: { createdAt: "desc" } });
  return (
    <div className="mx-auto max-w-3xl px-5 pt-12">
      <p className="text-sm text-muted">{residency.unit.property.name} {residency.unit.label}</p>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="display text-4xl font-semibold">Hi, {session.user.name.split(" ")[0] || "there"}</h1>
        <Link href={`/${agencySlug}/portal/tickets/new`} className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-ink">Request a repair</Link>
      </div>
      <p className="mt-3 rounded-xl bg-surface p-4 text-sm ring-1 ring-black/5">Gas smell, fire, flooding or sparking? Leave the unit and call 911 first, then {agency.contact.phone}.</p>
      <h2 className="mt-10 text-lg font-semibold">Your requests</h2>
      {tickets.length === 0 ? (
        <p className="mt-3 text-ink-2">Nothing yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-black/5 overflow-hidden rounded-2xl bg-surface ring-1 ring-black/5">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link href={`/${agencySlug}/portal/tickets/${t.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-paper">
                <span><span className="font-medium">{t.title}</span><span className="block text-xs text-muted">{dateLabel(t.createdAt, agency.timezone)} · {t.urgency.toLowerCase()}</span></span>
                <span className="rounded-full bg-paper px-3 py-1 text-xs font-medium">{t.status.toLowerCase().replace("_", " ")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
