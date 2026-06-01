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
  const [unit, doc, sig, signedDoc] = await Promise.all([
    t.unit.findUniqueOrThrow({ where: { id: lease.unitId }, include: { property: true } }),
    t.generatedDocument.findFirst({ where: { applicationId: lease.applicationId, kind: "LEASE", templateVersion: LEASE_TEMPLATE } }),
    t.signature.findFirst({ where: { leaseId: lease.id } }),
    t.generatedDocument.findFirst({ where: { leaseId: lease.id, kind: "SIGNED_LEASE", purgedAt: null } }),
  ]);
  const pdfHref = doc ? `/api/documents/${doc.id}?t=${encodeURIComponent(token)}` : null;
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
      <div className="mt-6 grid gap-6 grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 overflow-hidden rounded-2xl bg-surface ring-1 ring-black/5">
          {pdfHref ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/5 p-4">
                <p className="text-sm text-ink-2">Read the full lease before you sign.</p>
                <div className="flex gap-2">
                  <a href={pdfHref} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-full bg-ink px-4 text-sm font-medium text-white">Open lease PDF</a>
                  <a href={pdfHref} download className="inline-flex min-h-10 items-center rounded-full px-4 text-sm font-medium ring-1 ring-black/15">Download</a>
                </div>
              </div>
              <iframe title="Lease document" src={pdfHref} className="hidden h-[70vh] w-full md:block" />
            </>
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
              statusHref={`/${agencySlug}/apply/${lease.applicationId}/status`}
              signedCopyHref={signedDoc ? `/api/documents/${signedDoc.id}?t=${encodeURIComponent(token)}` : null}
              tz={agency.timezone}
              deadline={`${dateLabel(lease.signTokenExpiresAt, agency.timezone, { month: "long", day: "numeric" })} at ${timeLabel(lease.signTokenExpiresAt, agency.timezone)}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
