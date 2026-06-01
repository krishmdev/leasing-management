import type { Prisma } from "@/generated/prisma/client";
import { uuidv7 } from "@/lib/ids";
import { encOpt, fields } from "@/server/crypto/fieldEncryption";
import { enqueueDocument } from "@/server/outbox/outbox";
import { audit } from "@/server/audit/audit";
import { tenantDb } from "@/server/tenant";
import { runStep, type StepCtx } from "./durable";
import { analyzeReference, providerConfig, writeRationale } from "@/server/ai/provider";
import { redact } from "@/server/ai/guardrails/redact";
import type { ReferenceAnalysis, StructuredReference } from "@/server/ai/guardrails/dto";
import { evaluateRubric, type RubricInput, type RubricResult } from "@/server/domain/screening/rubric";
import { criteriaById } from "@/server/domain/screening/criteriaStore";
import { screeningProvider } from "@/server/domain/screening/providers";
import type { DerivedScreeningSummary } from "@/server/domain/screening/providers/types";
import { inviteToScreening } from "@/server/domain/screening/invite";
import { AutomationConfig, decidePolicy } from "@/server/domain/agent/policy";
import { escalate, executeDecision } from "@/server/domain/decisions/decide";
import { decryptApplication } from "@/server/domain/applications/service";

interface JobCtx {
  agencyId: string;
  applicationId: string;
  criteriaVersionId: string;
  signal?: AbortSignal;
}

const step = (j: JobCtx, stepName: string) => ({ agencyId: j.agencyId, applicationId: j.applicationId, criteriaVersionId: j.criteriaVersionId, stepName });

/** application.submitted job: invite the applicant to the screening provider. */
export async function runSubmitted(j: Omit<JobCtx, "criteriaVersionId">) {
  const app = await tenantDb(j.agencyId).application.findUniqueOrThrow({ where: { id: j.applicationId } });
  if (!app.criteriaVersionId) return;
  const jc = { ...j, criteriaVersionId: app.criteriaVersionId };
  return runStep(step(jc, "screening.invite"), { applicationId: j.applicationId }, async (ctx: StepCtx) => {
    const r = await inviteToScreening(ctx, j.agencyId, j.applicationId);
    return { output: { ref: r.ref }, summary: { reconciled: r.reconciled, provider: screeningProvider().id } };
  }, { signal: j.signal });
}

/**
 * agent.evaluate job. Each stage is a durable step, so a retried job skips whatever already
 * finished and picks up where the last attempt stopped.
 */
export async function runEvaluation(j: JobCtx) {
  const t = tenantDb(j.agencyId);
  const opts = { signal: j.signal };
  const app = await t.application.findUniqueOrThrow({ where: { id: j.applicationId }, include: { unit: true } });
  const sr = await t.screeningRequest.findFirst({ where: { applicationId: j.applicationId, criteriaVersionId: j.criteriaVersionId } });
  // Not ready (or already past this): do nothing, and above all don't snapshot a half-formed input.
  if (!["SCREENED", "DECISION_PENDING"].includes(app.status) || !sr?.providerApplicantRef || sr.status !== "COMPLETE") {
    return { output: { action: "SKIPPED", executed: null, reason: `status ${app.status}, screening ${sr?.status ?? "none"}` }, replayed: false, attempt: 0 };
  }
  const criteria = await criteriaById(t, j.criteriaVersionId);

  // 1. Pull the derived report summary from the provider and store it.
  const summary = await runStep(step(j, "screening.fetchSummary"), { screeningRequestId: sr.id, ref: sr.providerApplicantRef }, async (ctx) => {
    const s = await screeningProvider(sr.provider).getReportSummary(sr.providerApplicantRef!, ctx.signal);
    await ctx.tx(async (tx) => {
      const existing = await tx.screeningResult.findUnique({ where: { screeningRequestId: sr.id } });
      if (existing) return;
      const id = uuidv7();
      await tx.screeningResult.create({
        data: {
          id, agencyId: j.agencyId, screeningRequestId: sr.id, creditBand: s.creditBand,
          creditScoreEnc: encOpt({ agencyId: j.agencyId, model: "ScreeningResult", id, field: "creditScoreEnc" }, s.creditScore?.toString()),
          scoreModel: s.scoreModel, scoreRangeMin: s.scoreRange?.[0] ?? null, scoreRangeMax: s.scoreRange?.[1] ?? null, keyFactorsEnc: encOpt({ agencyId: j.agencyId, model: "ScreeningResult", id, field: "keyFactorsEnc" }, s.keyFactors.length ? JSON.stringify(s.keyFactors) : null),
          scoreDate: s.scoreDate ? new Date(s.scoreDate) : null, evictionJudgmentsInLookback: s.evictionJudgmentsInLookback,
          collectionsNonMedicalCount: s.collectionsNonMedicalCount, collectionsNonMedicalCents: s.collectionsNonMedicalCents,
          identityVerified: s.identityVerified, incomeVerified: s.incomeVerified, craDisclosure: { ...screeningProvider(sr.provider).craDisclosure() },
        },
      });
      await tx.screeningRequest.update({ where: { id: sr.id }, data: { providerReportId: s.reportId } });
    });
    // Only what the rubric needs goes into the step output. The score and its factors, model,
    // range and date live encrypted on ScreeningResult and are purged on the credit window.
    const output = {
      reportId: s.reportId, creditBand: s.creditBand, evictionJudgmentsInLookback: s.evictionJudgmentsInLookback,
      collectionsNonMedicalCount: s.collectionsNonMedicalCount, collectionsNonMedicalCents: s.collectionsNonMedicalCents,
      identityVerified: s.identityVerified, incomeVerified: s.incomeVerified,
    } satisfies Partial<DerivedScreeningSummary>;
    return { output, summary: { creditBand: s.creditBand, evictions: s.evictionJudgmentsInLookback, collections: s.collectionsNonMedicalCount } };
  }, opts);

  // 2. Score each reference's free text. Redaction happens before anything reaches the model.
  const reqs = await t.referenceRequest.findMany({ where: { applicationId: j.applicationId }, include: { response: true }, orderBy: { id: "asc" } });
  const responses = reqs.flatMap((r) => (r.response ? [r.response] : []));
  const knownNames = [decryptApplication(app).legalName ?? ""];
  const analyzed = await runStep(step(j, "references.analyze"), { responseIds: responses.map((r) => r.id) }, async (ctx) => {
    const out: { referenceId: string; structured: StructuredReference; text: ReferenceAnalysis | null; redactions: number; guardTripped: boolean }[] = [];
    for (const r of responses) {
      const structured: StructuredReference = {
        paidOnTime: r.paidOnTime as StructuredReference["paidOnTime"], lateCount: r.lateCount, leaseViolations: r.leaseViolations, noticeGiven: r.noticeGiven,
        propertyCondition: r.propertyCondition, wouldRentAgain: r.wouldRentAgain as StructuredReference["wouldRentAgain"],
      };
      const raw = fields({ agencyId: j.agencyId, model: "ReferenceResponse", id: r.id }).decOpt("freeTextEnc", r.freeTextEnc);
      const req = reqs.find((q) => q.id === r.referenceRequestId)!;
      const residence = await t.residenceHistory.findUniqueOrThrow({ where: { id: req.residenceId } });
      const landlordName = fields({ agencyId: j.agencyId, model: "ResidenceHistory", id: residence.id }).decOpt("landlordNameEnc", residence.landlordNameEnc);
      const tenancyMonths = Math.max(0, Math.round(((residence.endDate ?? new Date()).getTime() - residence.startDate.getTime()) / (30.44 * 86_400_000)));
      if (!raw) {
        out.push({ referenceId: r.id, structured, text: null, redactions: 0, guardTripped: false });
        continue;
      }
      const red = redact(raw, { knownNames: [...knownNames, landlordName ?? ""] });
      const a = await analyzeReference({ agencyId: j.agencyId, applicationId: j.applicationId }, { referenceId: r.id, structured, redactedText: red.text, tenancyMonths }, ctx.signal);
      await ctx.tx((tx) => tx.referenceResponse.update({ where: { id: r.id }, data: { aiAnalysis: a.value as Prisma.InputJsonObject, redactionCount: red.count } }));
      out.push({ referenceId: r.id, structured, text: a.value, redactions: red.count, guardTripped: a.guardTripped });
    }
    return {
      output: out,
      summary: { references: out.length, redactionCount: out.reduce((n, o) => n + o.redactions, 0), model: out.some((o) => o.text) ? providerConfig().model : null, promptVersion: "referenceAnalysis.v1" },
    };
  }, opts);

  // 3. The deterministic rubric.
  const rubricInput: RubricInput = {
    monthlyIncomeCents: app.monthlyIncomeCents ?? 0,
    rentCents: app.unit.rentCents,
    hasRentSubsidy: app.hasRentSubsidy,
    subsidyMonthlyCents: app.subsidyMonthlyCents ?? 0,
    altEvidenceProvided: app.altEvidenceProvided,
    screening: {
      creditBand: summary.output.creditBand,
      evictionJudgmentsInLookback: summary.output.evictionJudgmentsInLookback,
      collectionsNonMedicalCount: summary.output.collectionsNonMedicalCount,
      collectionsNonMedicalCents: summary.output.collectionsNonMedicalCents,
      identityVerified: summary.output.identityVerified,
      incomeVerified: summary.output.incomeVerified,
    },
    references: { expected: reqs.length, received: analyzed.output.map((a) => ({ structured: a.structured, text: a.text })) },
    llmGuardTripped: analyzed.output.some((a) => a.guardTripped),
  };
  const rubric = await runStep(step(j, "rubric.evaluate"), { rubricInput, criteriaVersion: criteria.version }, async () => {
    const r = evaluateRubric(rubricInput, criteria.parsed);
    return { output: r, summary: { score: r.score, outcome: r.outcome, flags: r.flags, llmPoints: r.llmPoints, criteriaVersion: criteria.version } };
  }, opts);

  // 4. A written explanation. The model explains the outcome; it can't change it.
  const r: RubricResult = rubric.output;
  const rationale = await runStep(step(j, "rationale.generate"), { score: r.score, outcome: r.outcome, flags: r.flags }, async (ctx) => {
    const w = await writeRationale(
      { agencyId: j.agencyId, applicationId: j.applicationId },
      { outcome: r.outcome, score: r.score, breakdown: r.breakdown, flags: r.flags, conditions: r.conditions },
      ctx.signal,
    );
    return { output: w, summary: { source: w.source, model: w.model, guardTripped: w.guardTripped } };
  }, opts);

  // 5. Apply the agency's automation policy.
  return runStep(step(j, "policy.apply"), { score: r.score, outcome: r.outcome }, async (ctx) => {
    const settings = await t.agencySettings.findFirstOrThrow({});
    const cfg = AutomationConfig.parse(settings.automation);
    const flags = [...r.flags, ...(rationale.output.guardTripped ? ["LLM_GUARD_TRIPPED"] : [])];
    const action = decidePolicy(cfg, {
      outcome: flags.includes("LLM_GUARD_TRIPPED") ? "NEEDS_REVIEW" : r.outcome,
      score: r.score,
      flags: flags.filter((f) => f !== "NO_REFERENCES" && f !== "INCOME_BELOW_MIN"),
      referencesComplete: reqs.length > 0 && reqs.every((q) => q.status === "COMPLETED"),
      identityVerified: summary.output.identityVerified,
      creditBand: summary.output.creditBand,
    });

    await ctx.tx(async (tx) => {
      await tx.recommendation.createMany({
        data: [{
          agencyId: j.agencyId, applicationId: j.applicationId, criteriaVersionId: j.criteriaVersionId, rubricScore: r.score,
          breakdown: { factors: r.breakdown, reasonCodes: r.reasonCodes, llmPoints: r.llmPoints } as unknown as Prisma.InputJsonObject,
          flags, outcome: flags.includes("LLM_GUARD_TRIPPED") ? "NEEDS_REVIEW" : r.outcome, conditions: r.conditions,
          rationale: rationale.output.summary, rationaleSource: rationale.output.source,
        }],
        skipDuplicates: true,
      });
      await tx.application.updateMany({ where: { id: j.applicationId, status: "SCREENED" }, data: { status: "DECISION_PENDING", statusChangedAt: new Date() } });
      await enqueueDocument(tx, j.agencyId, `doc:${j.applicationId}:SUMMARY:summary.v1`, { kind: "SUMMARY", templateVersion: "summary.v1", applicationId: j.applicationId });
      if (action.kind === "ESCALATE") {
        await escalate(tx, j.agencyId, j.applicationId, action.reasons, { recommendation: r.outcome, score: r.score });
      } else if (action.kind !== "AUTO_EXECUTE") {
        // Manual and assisted: the draft lives on the task. Nothing is decided until a person approves it.
        await tx.approvalTask.createMany({
          data: [{
            agencyId: j.agencyId, applicationId: j.applicationId, type: "DECISION", idempotencyKey: `task:${j.applicationId}:decision:${j.criteriaVersionId}`,
            payload: { mode: cfg.level, draft: { outcome: r.outcome, reasonCodes: r.reasonCodes, conditions: r.conditions } } as unknown as Prisma.InputJsonObject,
            escalationReasons: [], dueAt: new Date(Date.now() + 2 * 86_400_000),
          }],
          skipDuplicates: true,
        });
      }
      await audit({ agencyId: j.agencyId, actorType: "AGENT", action: "recommendation.created", entity: "Application", entityId: j.applicationId, metadata: { outcome: r.outcome, score: r.score, action: action.kind } }, tx);
    });

    let executed: string | null = null;
    if (action.kind === "AUTO_EXECUTE") {
      // Separate transaction: the pause switch and daily cap are re-checked under lock there.
      const res = await executeDecision(j.agencyId, j.applicationId, { outcome: "APPROVE", mode: "AUTONOMOUS", decidedByType: "AGENT", reasonCodes: [], conditions: [] });
      executed = res.status;
    }
    return { output: { action: action.kind, executed }, summary: { action: action.kind, executed, level: cfg.level } };
  }, opts);
}
