import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { publicAgency } from "@/server/domain/agency";
import { getSession } from "@/server/session";
import { applicationForUser, decryptApplication, decryptResidence } from "@/server/domain/applications/service";
import { STEP_TITLES, CONSENT_TEXT } from "@/server/domain/applications/steps";
import { StepForm } from "./StepForm";
import { usd } from "@/lib/format";

export const metadata = { title: "Application" };

export default async function StepPage({ params }: { params: Promise<{ agencySlug: string; applicationId: string; step: string }> }) {
  const { agencySlug, applicationId, step: stepStr } = await params;
  const step = Number(stepStr);
  if (!Number.isInteger(step) || step < 1 || step > 5) notFound();
  const session = await getSession();
  if (!session) redirect(`/login?next=/${agencySlug}/apply/${applicationId}/${step}`);
  const agency = await publicAgency(agencySlug);
  const app = agency && (await applicationForUser(agency.id, applicationId, session.user.id));
  if (!agency || !app) notFound();
  if (app.status !== "DRAFT") redirect(`/${agencySlug}/apply/${applicationId}/status`);
  if (step > app.currentStep) redirect(`/${agencySlug}/apply/${applicationId}/${app.currentStep}`);
  const pii = decryptApplication(app);
  const values = {
    legalName: pii.legalName ?? session.user.name ?? "",
    phone: pii.phone ?? "",
    desiredMoveIn: app.desiredMoveIn?.toISOString().slice(0, 10) ?? "",
    totalOccupants: app.totalOccupants?.toString() ?? "1",
    incomeType: app.incomeType ?? "EMPLOYMENT",
    monthlyIncome: app.monthlyIncomeCents ? String(app.monthlyIncomeCents / 100) : "",
    hasRentSubsidy: app.hasRentSubsidy,
    subsidyMonthly: app.subsidyMonthlyCents ? String(app.subsidyMonthlyCents / 100) : "",
    altEvidenceProvided: app.altEvidenceProvided,
    residences: app.residences.map((r) => {
      const d = decryptResidence(r);
      return { address: d.address ?? "", landlordName: d.landlordName ?? "", landlordEmail: d.landlordEmail ?? "", landlordPhone: d.landlordPhone ?? "", startDate: r.startDate.toISOString().slice(0, 10), endDate: r.endDate?.toISOString().slice(0, 10) ?? "", monthlyRent: String(r.monthlyRentCents / 100), consentToContact: r.consentToContact };
    }),
  };
  return (
    <div className="mx-auto max-w-3xl px-5 pt-10">
      <p className="text-sm text-muted">{app.unit.property.name} {app.unit.label} · {usd(app.unit.rentCents)}/mo</p>
      <nav aria-label="Application steps" className="mt-3">
        <ol className="grid grid-cols-5 gap-1.5">
          {STEP_TITLES.map((t, i) => {
            const n = i + 1;
            const reachable = n <= app.currentStep;
            const cls = `block h-1.5 rounded-full ${n === step ? "bg-brand" : n < app.currentStep || n < step ? "bg-brand/50" : "bg-black/10"}`;
            return (
              <li key={t}>
                {reachable ? <Link href={`/${agencySlug}/apply/${applicationId}/${n}`} aria-current={n === step ? "step" : undefined} className={cls}><span className="sr-only">{t}</span></Link> : <span className={cls} aria-hidden />}
                <span className={`mt-1.5 hidden text-xs sm:block ${n === step ? "font-semibold text-ink" : "text-muted"}`}>{t}</span>
              </li>
            );
          })}
        </ol>
      </nav>
      <h1 className="display mt-8 text-3xl font-semibold">{STEP_TITLES[step - 1]}</h1>
      <StepForm slug={agencySlug} applicationId={applicationId} step={step} values={values} fcraText={CONSENT_TEXT.FCRA_AUTHORIZATION.text} agencyName={agency.name} />
    </div>
  );
}
