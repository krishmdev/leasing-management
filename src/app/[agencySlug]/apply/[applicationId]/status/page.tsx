import { notFound, redirect } from "next/navigation";
import { Check, Circle } from "lucide-react";
import { publicAgency } from "@/server/domain/agency";
import { getSession } from "@/server/session";
import { tenantDb } from "@/server/tenant";
import { deriveToken } from "@/server/crypto/tokens";
import { withdrawMine } from "../../../actions";
import { dateLabel, timeLabel, usd } from "@/lib/format";

export const metadata = { title: "Application status" };

type StepState = "done" | "current" | "todo";

export default async function Status({ params }: { params: Promise<{ agencySlug: string; applicationId: string }> }) {
  const { agencySlug, applicationId } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/${agencySlug}/apply/${applicationId}/status`);
  const agency = await publicAgency(agencySlug);
  if (!agency) notFound();
  const t = tenantDb(agency.id);
  const app = await t.application.findUnique({ where: { id: applicationId }, include: { unit: { include: { property: true } }, references: true, screeningRequests: true, lease: true, hold: true, documents: true, adverseAction: true } });
  if (!app || app.userId !== session.user.id) notFound();
  if (app.status === "DRAFT") redirect(`/${agencySlug}/apply/${applicationId}/${app.currentStep}`);
  const sr = app.screeningRequests[0];
  const refsDone = app.references.filter((r) => r.status === "COMPLETED" || r.status === "EXPIRED").length;
  const decided = ["APPROVED", "CONDITIONAL", "DECLINED", "LEASE_SENT", "LEASE_SIGNED"].includes(app.status);
  const steps: { title: string; body: React.ReactNode; state: StepState }[] = [
    { title: "Application submitted", body: app.submittedAt ? dateLabel(app.submittedAt, agency.timezone) : "", state: "done" },
    {
      title: "Screening",
      state: sr?.status === "COMPLETE" ? "done" : "current",
      body:
        sr?.status === "COMPLETE" ? "Report received." : sr?.hostedUrl ? (
          <>The screening company is waiting for you. <a className="font-medium text-brand underline" href={sr.hostedUrl}>Open the secure screening page</a> (your SSN goes there, not to us).</>
        ) : "We're setting up your screening. You'll get an email from the screening company shortly.",
    },
    { title: "Landlord references", state: refsDone === app.references.length ? "done" : "current", body: app.references.length ? `${refsDone} of ${app.references.length} received` : "None requested" },
    {
      title: "Decision",
      state: decided ? "done" : app.status === "WITHDRAWN" ? "todo" : "current",
      body: app.status === "DECLINED" ? "We weren't able to approve this application. Your notice explains why and lists your rights." : decided ? "Approved." : app.status === "WITHDRAWN" ? "Withdrawn." : "Usually within two business days of the last item above.",
    },
  ];
  const lease = app.lease && app.lease.status === "SENT" ? `/${agencySlug}/lease/${deriveToken("lease", app.lease.id, app.lease.tokenVersion).token}` : null;
  const notice = app.documents.find((d) => d.kind === "ADVERSE_ACTION");
  const signed = app.documents.find((d) => d.kind === "SIGNED_LEASE");
  return (
    <div className="mx-auto max-w-2xl px-5 pt-12">
      <p className="text-sm text-muted">{app.unit.property.name} {app.unit.label} · {usd(app.unit.rentCents)}/mo</p>
      <h1 className="display mt-1 text-4xl font-semibold">{app.status === "LEASE_SIGNED" ? "Welcome home" : "Your application"}</h1>
      <ol className="mt-8 space-y-5">
        {steps.map((s) => (
          <li key={s.title} className="flex gap-4">
            <span aria-hidden className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${s.state === "done" ? "bg-brand text-brand-ink" : s.state === "current" ? "ring-2 ring-brand text-brand" : "bg-black/10 text-muted"}`}>
              {s.state === "done" ? <Check aria-hidden className="size-4" /> : <Circle aria-hidden className="size-2 fill-current" />}
            </span>
            <div>
              <p className="font-semibold">{s.title} <span className="sr-only">({s.state})</span></p>
              <p className="text-sm text-ink-2">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {lease && (
        <div className="mt-8 rounded-2xl bg-brand p-6 text-brand-ink">
          <p className="display text-2xl font-semibold">Your lease is ready</p>
          {app.hold?.expiresAt && <p className="mt-1 text-sm opacity-85">We&apos;re holding the home until {dateLabel(app.hold.expiresAt, agency.timezone, { month: "long", day: "numeric" })} at {timeLabel(app.hold.expiresAt, agency.timezone)}.</p>}
          <a href={lease} className="mt-4 inline-block rounded-full bg-brand-ink px-5 py-2.5 text-sm font-semibold text-brand">Review and sign</a>
        </div>
      )}
      {(notice || signed) && (
        <ul className="mt-6 space-y-2 text-sm">
          {notice && (
            <li>
              <a className="font-medium text-brand underline" href={`/api/documents/${notice.id}`}>
                {(app.adverseAction?.craSnapshot as { kind?: string } | null)?.kind === "CONDITIONAL" ? "Notice about the conditions on your approval (PDF)" : "Adverse action notice (PDF)"}
              </a>
            </li>
          )}
          {signed && <li><a className="font-medium text-brand underline" href={`/api/documents/${signed.id}`}>Signed lease with certificate (PDF)</a></li>}
        </ul>
      )}
      {!["WITHDRAWN", "DECLINED", "LEASE_SIGNED"].includes(app.status) && (
        <form action={withdrawMine.bind(null, agencySlug, applicationId)} className="mt-12 border-t border-black/10 pt-6">
          <button className="text-sm text-ink-2 underline underline-offset-4">Withdraw my application</button>
        </form>
      )}
    </div>
  );
}
