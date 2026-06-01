import { TZDate } from "@date-fns/tz";
import type { Prisma } from "@/generated/prisma/client";
import { enqueueEmail } from "@/server/outbox/outbox";
import { audit } from "@/server/audit/audit";
import { tenantDb, tenantRaw, type TenantTx } from "@/server/tenant";
import { withTxRetry } from "@/server/txRetry";
import { faults } from "@/server/faults";
import { advanceStage } from "@/server/domain/leads/service";
import { AutomationConfig, mayAutoExecute } from "@/server/domain/agent/policy";
import { lockApplication, lockSettings, lockUnit } from "@/server/domain/locks";
import { generateAdverseActionNotice } from "@/server/domain/screening/adverse";
import type { ReasonCode } from "@/server/domain/screening/rubric";
import { placeHold } from "./holds";

export type ExecOutcome = "APPROVE" | "CONDITIONAL" | "DECLINE";

export interface DecisionInput {
  outcome: ExecOutcome;
  mode: "MANUAL" | "ASSISTED" | "AUTONOMOUS";
  decidedByType: "USER" | "AGENT";
  decidedById?: string | null;
  reasonCodes: ReasonCode[];
  conditions?: string[];
  overrideReason?: string | null;
}

export type DecisionResult =
  | { status: "executed"; outcome: ExecOutcome; hold?: string }
  | { status: "noop"; reason: string }
  | { status: "escalated"; reason: string };

type Raw = { $queryRaw: (sql: Prisma.Sql) => Promise<unknown>; $executeRaw: (sql: Prisma.Sql) => Promise<number> };
const STATUS: Record<ExecOutcome, "APPROVED" | "CONDITIONAL" | "DECLINED"> = { APPROVE: "APPROVED", CONDITIONAL: "CONDITIONAL", DECLINE: "DECLINED" };

export async function escalate(tx: TenantTx, agencyId: string, applicationId: string, reasons: string[], payload: Record<string, unknown> = {}) {
  await tx.approvalTask.createMany({
    data: [{ agencyId, applicationId, type: "ESCALATION", idempotencyKey: `task:${applicationId}:escalation:${reasons.join(",")}`, payload: payload as Prisma.InputJsonObject, escalationReasons: reasons, dueAt: new Date(Date.now() + 86_400_000) }],
    skipDuplicates: true,
  });
  await audit({ agencyId, actorType: "AGENT", action: "decision.escalated", entity: "Application", entityId: applicationId, metadata: { reasons } }, tx);
}

/** Agency-local calendar day, for the daily automation cap. */
export function localDay(tz: string, at = new Date()): Date {
  const d = new TZDate(at.getTime(), tz);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/**
 * Execute a decision. One transaction, locks in the canonical order:
 *   AgencySettings -> Unit -> Application  (then holds/leases inside placeHold)
 *
 * For an autonomous execution the pause switch, the automation level and the daily cap are all
 * re-checked here, under the settings lock, rather than trusted from when the recommendation
 * was made. The cap is a conditional increment, so N concurrent approvals against a cap of k
 * execute exactly k and escalate the rest.
 */
export async function executeDecision(agencyId: string, applicationId: string, d: DecisionInput): Promise<DecisionResult> {
  if (d.mode === "AUTONOMOUS" && (d.decidedByType !== "AGENT" || !mayAutoExecute(d.outcome))) {
    throw new Error("only a clean approval can be executed autonomously");
  }
  const t = tenantDb(agencyId);
  const pre = await t.application.findUnique({ where: { id: applicationId } });
  if (!pre?.criteriaVersionId) return { status: "noop", reason: "application not found or not submitted" };

  return withTxRetry(() =>
    t.$transaction(async (tx) => {
      const settings = await lockSettings(tx, agencyId);
      const cfg = AutomationConfig.parse(settings.automation);
      const unit = await lockUnit(tx, agencyId, pre.unitId);
      const app = await lockApplication(tx, agencyId, applicationId);
      if (!unit || !app) return { status: "noop", reason: "missing" } as const;
      if (app.status !== "DECISION_PENDING") return { status: "noop", reason: `status is ${app.status}` } as const;
      if (d.mode === "AUTONOMOUS" && (settings.automationPaused || cfg.level !== "AUTONOMOUS")) {
        const reason = settings.automationPaused ? "AUTOMATION_PAUSED" : "AUTOMATION_LEVEL_CHANGED";
        await escalate(tx, agencyId, applicationId, [reason], { draft: d.outcome });
        return { status: "escalated", reason } as const;
      }
      if (d.outcome !== "APPROVE" && d.reasonCodes.length === 0) {
        throw new Error("choose at least one reason for a decline or a conditional approval; the applicant's notice lists them");
      }

      if (d.mode === "AUTONOMOUS") {
        const day = localDay(settings.timezone);
        const raw = tenantRaw(agencyId, tx as unknown as Raw);
        await raw.execute`INSERT INTO "AutomationQuota" ("agencyId", day, used, cap) VALUES (${agencyId}, ${day}::date, 0, ${cfg.dailyCap}) ON CONFLICT DO NOTHING`;
        const took = await raw.query<{ used: number }[]>`
          UPDATE "AutomationQuota" SET used = used + 1, cap = GREATEST(${cfg.dailyCap}, used + 1)
          WHERE "agencyId" = ${agencyId} AND day = ${day}::date AND used < ${cfg.dailyCap} RETURNING used`;
        if (took.length === 0) {
          await escalate(tx, agencyId, applicationId, ["DAILY_CAP_REACHED"], { draft: d.outcome });
          return { status: "escalated", reason: "DAILY_CAP_REACHED" } as const;
        }
      }

      const now = new Date();
      const moved = await tx.application.updateMany({ where: { id: applicationId, status: "DECISION_PENDING" }, data: { status: STATUS[d.outcome], statusChangedAt: now } });
      if (moved.count !== 1) return { status: "noop", reason: "status changed" } as const;

      const rec = await tx.recommendation.findFirst({ where: { applicationId, criteriaVersionId: app.criteriaVersionId! } });
      const overrode = !!rec && rec.outcome !== d.outcome && rec.outcome !== "NEEDS_REVIEW";
      if (overrode && !d.overrideReason?.trim()) throw new Error("overriding the recommendation requires a reason");
      await tx.decision.create({
        data: {
          agencyId, applicationId, criteriaVersionId: app.criteriaVersionId!, outcome: d.outcome, mode: d.mode, decidedByType: d.decidedByType,
          decidedById: d.decidedById ?? null, reasonCodes: d.reasonCodes.map((r) => r.code), overrodeRecommendation: overrode, overrideReason: d.overrideReason ?? null,
        },
      });

      let hold: string | undefined;
      if (d.outcome === "DECLINE") {
        await generateAdverseActionNotice(tx, agencyId, applicationId, d.reasonCodes, "DECLINE");
      } else {
        // Approval on less favorable terms (a guarantor) because of the report is an adverse
        // action under FCRA too, so a conditional approval gets a notice as well.
        if (d.outcome === "CONDITIONAL") await generateAdverseActionNotice(tx, agencyId, applicationId, d.reasonCodes, "CONDITIONAL", d.conditions);
        const h = await placeHold(tx, agencyId, unit, applicationId, settings.holdHours);
        hold = h.status;
        await enqueueEmail(tx, agencyId, `mail:app:${applicationId}:decision:${d.outcome}`, {
          template: h.status === "ACTIVE" ? "application.approved" : "application.waitlisted",
          to: { kind: "lead", id: app.leadId },
          params: { applicationId, outcome: d.outcome, conditions: d.conditions ?? [] },
        });
      }
      await tx.approvalTask.updateMany({ where: { applicationId, status: "OPEN", type: { in: ["DECISION", "ESCALATION"] } }, data: { status: "RESOLVED", resolvedAt: now, resolvedById: d.decidedById ?? null } });
      await advanceStage(tx, agencyId, app.leadId, app.unitId, "DECISION", now);
      await audit({
        agencyId, actorType: d.decidedByType === "AGENT" ? "AGENT" : "USER", actorId: d.decidedById ?? null,
        action: d.mode === "AUTONOMOUS" ? "decision.auto_executed" : "decision.executed", entity: "Application", entityId: applicationId,
        metadata: { outcome: d.outcome, mode: d.mode, overrode, hold: hold ?? null },
      }, tx);
      faults.hit("decision:before-commit");
      return { status: "executed", outcome: d.outcome, hold } as const;
    }),
  );
}
