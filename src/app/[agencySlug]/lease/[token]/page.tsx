import { notFound } from "next/navigation";
import { publicAgency } from "@/server/domain/agency";
import { leaseByToken } from "@/server/domain/leases/sign";
import { tenantDb } from "@/server/tenant";
import { LEASE_TEMPLATE } from "@/server/domain/decisions/holds";
import { dayLabel, dateLabel, timeLabel, usd } from "@/lib/format";
import { SignForm } from "./SignForm";
import { requestTime } from "@/lib/time";

export const metadata = { title: "Review and sign your lease" };

export default async function LeasePage({ params }: { params: Promise<{ agencySlug: string; token: string }> }) {
  const { agencySlug, token } = await params;
  const [agency, lease] = await Promise.all([publicAgency(agencySlug), leaseByToken(token)]);
  if (!agency || !lease || lease.agencyId !== agency.id) notFound();
  const t = tenantDb(agency.id);
  const [unit, doc, sig] = await Promise.all([
    t.unit.findUniqueOrThrow({ where: { id: lease.unitId }, include: { property: true } }),
    t.generatedDocument.findFirst({ where: { applicationId: lease.applicationId, kind: "LEASE", templateVersion: LEASE_TEMPLATE } }),
    t.signature.findFirst({ where: { leaseId: lease.id } }),
  ]);
  const expired = !sig && lease.signTokenExpiresAt.getTime() < (await requestTime());
  return (
    <div className="mx-auto max-w-5xl px-5 pt-10">
      <p className="text-sm font-medium uppercase tracking-widest text-brand">Lease</p>
      <h1 className="display mt-1 text-4xl font-semibold">{unit.property.name}, {unit.label}</h1>
      <dl className="mt-5 grid grid-cols-2 gap-4 rounded-2xl bg-surface p-5 ring-1 ring-black/5 md:grid-cols-4">
        {[["Rent", `${usd(lease.rentCents)}/mo`], ["Deposit", usd(lease.depositCents)], ["Starts", dayLabel(lease.startDate, { month: "long", day: "numeric", year: "numeric" })], ["Ends", dayLabel(lease.endDate, { month: "long", day: "numeric", year: "numeric" })]].map(([k, v]) => (
          <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="display text-lg font-semibold">{v}</dd></div>
        ))}
      </dl>
      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_340px]">
        <div className="overflow-hidden rounded-2xl bg-surface ring-1 ring-black/5">
          {doc ? (
            <iframe title="Lease document" src={`/api/documents/${doc.id}?t=${encodeURIComponent(token)}`} className="h-[70vh] w-full" />
          ) : (
            <p className="p-8 text-ink-2" role="status">Your lease document is being prepared. Refresh this page in a minute.</p>
          )}
        </div>
        <div className="md:sticky md:top-24 md:self-start">
          {expired ? (
            <p className="rounded-2xl bg-surface p-6 ring-1 ring-black/5">The hold on this home ended {dateLabel(lease.signTokenExpiresAt, agency.timezone)}. Contact {agency.name} at {agency.contact.phone}.</p>
          ) : (
            <SignForm
              token={token}
              docSha256={doc?.sha256 ?? null}
              signed={sig ? (sig.responseJson as { signatureId: string; signedAt: string }) : null}
              deadline={`${dateLabel(lease.signTokenExpiresAt, agency.timezone, { month: "long", day: "numeric" })} at ${timeLabel(lease.signTokenExpiresAt, agency.timezone)}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
