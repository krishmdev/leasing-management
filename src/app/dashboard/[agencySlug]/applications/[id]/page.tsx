import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/session";
import { can } from "@/server/access";
import { applicationDetail } from "@/server/domain/desk/applications";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { AppStatus, FactorRow, OutcomeBadge, ScoreBar, Timeline, human } from "@/components/desk/bits";
import { DecisionPanel } from "./DecisionPanel";
import { RevealPanel } from "./RevealPanel";
import { dateLabel, usd } from "@/lib/format";

export const metadata = { title: "Application" };

export default async function ApplicationPage({ params }: { params: Promise<{ agencySlug: string; id: string }> }) {
  const { agencySlug, id } = await params;
  const ctx = await requireStaff(agencySlug, "applications.read");
  const d = await applicationDetail(ctx, id);
  if (!d) notFound();
  const { app } = d;
  const rec = app.recommendations[0];
  const decision = app.decisions[0];
  const breakdown = (rec?.breakdown ?? { factors: [], reasonCodes: [], llmPoints: 0 }) as { factors: { factor: string; points: number; max: number; detail: string }[]; reasonCodes: { code: string; text: string; basis: string; pointsLost: number }[]; llmPoints: number };
  const sr = app.screeningRequests[0];
  const openTask = app.tasks.find((t) => t.status === "OPEN");
  const redactions = app.references.reduce((n, r) => n + (r.response?.redactionCount ?? 0), 0);
  const tz = "America/Los_Angeles";

  return (
    <>
      <PageHeader
        crumbs={<Link href={`/dashboard/${agencySlug}/applications`} className="hover:underline">Applications</Link>}
        title={d.displayName}
        sub={`${app.unit.property.name} ${app.unit.label} · ${usd(app.unit.rentCents)}/mo · submitted ${app.submittedAt ? dateLabel(app.submittedAt, tz) : "not yet"}${app.criteria ? ` · criteria v${app.criteria.version}` : ""}`}
        actions={<AppStatus status={app.status} />}
      />

      {openTask && (
        <div className="mb-4">
          <Alert tone={openTask.type === "ESCALATION" ? "warn" : "info"} title={openTask.type === "ESCALATION" ? "Needs a person" : "Waiting for your decision"}>
            {openTask.escalationReasons.length ? openTask.escalationReasons.map(human).join(", ") : "The agent drafted a decision below. Nothing is sent until you approve it."}
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Recommendation" sub={rec ? `Rubric score and flags from criteria v${app.criteria?.version}. The model's reading of reference text moved ${breakdown.llmPoints} of these points (cap 4.5).` : undefined} action={rec && <OutcomeBadge outcome={rec.outcome} />} />
            {rec ? (
              <div className="space-y-4 p-4">
                <div className="flex items-end gap-4">
                  <p className="font-mono text-4xl font-medium tabular">{rec.rubricScore}</p>
                  <div className="flex-1 pb-2">
                    <ScoreBar score={rec.rubricScore} />
                    <div className="mt-1 flex justify-between text-2xs text-muted"><span>0</span><span>conditional 60 · approve 75</span><span>100</span></div>
                  </div>
                </div>
                <div>{breakdown.factors.map((f) => <FactorRow key={f.factor} {...f} />)}</div>
                {rec.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">{rec.flags.map((f) => <Badge key={f} tone="warn">{human(f)}</Badge>)}</div>
                )}
                <div className="rounded-md bg-paper p-3 text-[13px] leading-relaxed text-ink-2">
                  <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted">Rationale · {rec.rationaleSource.toLowerCase()}</p>
                  {rec.rationale}
                </div>
                {breakdown.reasonCodes.length > 0 && (
                  <div>
                    <p className="text-2xs font-semibold uppercase tracking-wide text-muted">Adverse-action reasons if declined</p>
                    <ul className="mt-1 space-y-0.5 text-[13px]">
                      {breakdown.reasonCodes.map((r) => (
                        <li key={r.code}>{r.text} <span className="font-mono text-2xs text-muted">({r.basis.toLowerCase().replace("_", " ")}, −{r.pointsLost})</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="p-4 text-[13px] text-muted">No recommendation yet. It appears once screening is back and references are in or expired.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Agent timeline" sub={`${app.steps.length} steps · ${redactions} protected-term redaction${redactions === 1 ? "" : "s"} before any model call${d.llm[0] ? ` · ${d.llm[0].provider}/${d.llm[0].model}` : ""}`} />
            <div className="p-4"><Timeline steps={app.steps} /></div>
          </Card>

          <Card>
            <CardHeader title="Screening and references" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wide text-muted">Consumer report (derived only)</p>
                {sr?.result ? (
                  <dl className="mt-2 space-y-1 text-[13px]">
                    <div className="flex justify-between"><dt className="text-muted">Credit band</dt><dd>{human(sr.result.creditBand)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Evictions (5y)</dt><dd className="font-mono">{sr.result.evictionJudgmentsInLookback}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Non-medical collections</dt><dd className="font-mono">{sr.result.collectionsNonMedicalCount} · {usd(sr.result.collectionsNonMedicalCents)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Identity verified</dt><dd>{sr.result.identityVerified ? "yes" : "no"}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Report id</dt><dd className="font-mono text-2xs">{sr.providerReportId}</dd></div>
                  </dl>
                ) : (
                  <p className="mt-2 text-[13px] text-muted">{sr ? `Invitation ${human(sr.status)}.` : "Not requested yet."} We never receive the applicant&apos;s SSN or date of birth.</p>
                )}
              </div>
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wide text-muted">Landlord references</p>
                <ul className="mt-2 space-y-2 text-[13px]">
                  {app.references.length === 0 && <li className="text-muted">None requested.</li>}
                  {app.references.map((r, i) => (
                    <li key={r.id} className="rounded-md border border-line p-2">
                      <div className="flex justify-between"><span>Reference {i + 1}</span><Badge tone={r.status === "COMPLETED" ? "ok" : r.status === "EXPIRED" ? "neutral" : "info"}>{human(r.status)}</Badge></div>
                      {r.response && (
                        <p className="mt-1 text-2xs text-ink-2">
                          Paid {human(r.response.paidOnTime)} · {r.response.lateCount} late · would rent again: {human(r.response.wouldRentAgain)}
                          {r.response.redactionCount > 0 && <> · <span className="text-warn">{r.response.redactionCount} redacted</span></>}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {can(ctx.role, "applications.decide") && (
            <DecisionPanel
              slug={agencySlug}
              applicationId={app.id}
              status={app.status}
              recommended={rec?.outcome ?? null}
              decided={decision ? { outcome: decision.outcome, by: decision.decidedByType, mode: decision.mode, overrode: decision.overrodeRecommendation, reason: decision.overrideReason, at: decision.createdAt.toISOString() } : null}
            />
          )}
          <Card>
            <CardHeader title="Hold and lease" />
            <dl className="space-y-1 p-4 text-[13px]">
              <div className="flex justify-between"><dt className="text-muted">Hold</dt><dd>{app.hold ? `${human(app.hold.status)}${app.hold.expiresAt ? ` until ${dateLabel(app.hold.expiresAt, tz, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}` : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Lease</dt><dd>{app.lease ? human(app.lease.status) : "—"}</dd></div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Documents" />
            <ul className="divide-y divide-line text-[13px]">
              {app.documents.length === 0 && <li className="p-4 text-muted">None yet.</li>}
              {app.documents.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between px-4 py-2">
                  <span>{human(doc.kind)} <span className="font-mono text-2xs text-muted">{doc.templateVersion}</span></span>
                  <a className="text-info underline-offset-2 hover:underline" href={`/api/documents/${doc.id}?agency=${agencySlug}`}>Download</a>
                </li>
              ))}
            </ul>
          </Card>
          {can(ctx.role, "pii.reveal") && <RevealPanel slug={agencySlug} applicationId={app.id} />}
          <Card>
            <CardHeader title="History" sub="From the append-only audit log" />
            <ol className="max-h-72 space-y-1.5 overflow-y-auto p-4 font-mono text-2xs text-ink-2">
              {d.history.map((h) => (
                <li key={h.id}>
                  <span className="text-muted">{dateLabel(h.createdAt, tz, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> {h.action} <span className="text-muted">({h.actorType.toLowerCase()})</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
