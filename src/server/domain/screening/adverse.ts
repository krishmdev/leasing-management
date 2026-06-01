import type { Prisma } from "@/generated/prisma/client";
import { uuidv7 } from "@/lib/ids";
import { decryptField, encryptField } from "@/server/crypto/fieldEncryption";
import { enqueueDocument, enqueueEmail } from "@/server/outbox/outbox";
import type { TenantTx } from "@/server/tenant";
import { screeningProvider } from "./providers";
import type { CraDisclosure } from "./providers/types";
import type { ReasonCode } from "./rubric";

/** The credit details a notice must disclose when a score was used. Stored encrypted only. */
export interface CraScore {
  value: number | null;
  band: string;
  model: string | null;
  range: (number | null)[];
  keyFactors: string[];
  date: string | null;
}

/** What the notice row keeps in plain JSON: nothing from the consumer report itself. */
export interface AdverseNoticeSnapshot {
  kind: "DECLINE" | "CONDITIONAL";
  cra: CraDisclosure;
  usedCra: boolean;
  hasScore: boolean;
  conditions: string[];
}

export type NoticeReason = ReasonCode | { code: string; basis: string; text: string; factor?: string; pointsLost?: number };

export interface ReportForNotice {
  creditBand: string;
  creditScore: number | null;
  scoreModel: string | null;
  scoreRangeMin: number | null;
  scoreRangeMax: number | null;
  keyFactors: string[];
  scoreDate: Date | string | null;
}

/**
 * The CRA block for a notice. Pure, so the FCRA content rules are unit-testable. The CRA block
 * (and the score) appear only when a report-based reason is among the notice's reasons; an
 * income-only decline doesn't claim to rest on the report.
 */
export function buildAdverseNotice(params: {
  kind: "DECLINE" | "CONDITIONAL";
  reasons: NoticeReason[];
  conditions?: string[];
  provider?: string;
  report: ReportForNotice | null;
}): { snapshot: AdverseNoticeSnapshot; score: CraScore | null } {
  const { kind, reasons, conditions = [], report, provider } = params;
  const usedCra = reasons.some((x) => x.basis === "CRA");
  const score: CraScore | null = usedCra && report
    ? {
        value: report.creditScore,
        band: report.creditBand,
        model: report.scoreModel,
        range: [report.scoreRangeMin, report.scoreRangeMax],
        keyFactors: report.keyFactors.slice(0, 4),
        date: report.scoreDate ? (report.scoreDate instanceof Date ? report.scoreDate.toISOString() : String(report.scoreDate)).slice(0, 10) : null,
      }
    : null;
  return {
    snapshot: { kind, cra: screeningProvider(provider).craDisclosure(), usedCra, hasScore: !!score, conditions: kind === "CONDITIONAL" ? conditions : [] },
    score,
  };
}

const scoreRef = (agencyId: string, id: string) => ({ agencyId, model: "AdverseActionNotice", id, field: "craScoreEnc" });

/** Read a notice's credit block. Null once the credit retention window has passed. */
export function noticeScore(n: { id: string; agencyId: string; craScoreEnc: string | null }): CraScore | null {
  return n.craScoreEnc ? (JSON.parse(decryptField(scoreRef(n.agencyId, n.id), n.craScoreEnc)) as CraScore) : null;
}

/**
 * Record an adverse-action (or conditional-approval) notice and queue its PDF and email, in the
 * caller's decision transaction. sentAt is set when the email is accepted.
 */
export async function generateAdverseActionNotice(
  tx: TenantTx,
  agencyId: string,
  applicationId: string,
  reasons: NoticeReason[],
  kind: "DECLINE" | "CONDITIONAL",
  conditions: string[] = [],
): Promise<AdverseNoticeSnapshot> {
  const sr = await tx.screeningRequest.findFirst({ where: { applicationId }, include: { result: true } });
  const r = sr?.result;
  const report: ReportForNotice | null = r
    ? {
        creditBand: r.creditBand,
        creditScore: r.creditScoreEnc ? Number(decryptField({ agencyId, model: "ScreeningResult", id: r.id, field: "creditScoreEnc" }, r.creditScoreEnc)) : null,
        scoreModel: r.scoreModel,
        scoreRangeMin: r.scoreRangeMin,
        scoreRangeMax: r.scoreRangeMax,
        keyFactors: r.keyFactorsEnc ? (JSON.parse(decryptField({ agencyId, model: "ScreeningResult", id: r.id, field: "keyFactorsEnc" }, r.keyFactorsEnc)) as string[]) : [],
        scoreDate: r.scoreDate,
      }
    : null;
  const { snapshot, score } = buildAdverseNotice({ kind, reasons, conditions, provider: sr?.provider, report });
  const id = uuidv7();
  await tx.adverseActionNotice.createMany({
    data: [{
      id,
      agencyId,
      applicationId,
      reasonCodes: reasons as unknown as Prisma.InputJsonArray,
      basis: [...new Set(reasons.map((x) => x.basis))],
      craSnapshot: snapshot as unknown as Prisma.InputJsonObject,
      craScoreEnc: score ? encryptField(scoreRef(agencyId, id), JSON.stringify(score)) : null,
    }],
    skipDuplicates: true,
  });
  await enqueueDocument(tx, agencyId, `doc:${applicationId}:ADVERSE_ACTION:adverseAction.v1`, { kind: "ADVERSE_ACTION", templateVersion: "adverseAction.v1", applicationId });
  const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
  await enqueueEmail(tx, agencyId, `mail:app:${applicationId}:adverse-action`, {
    template: "application.adverse_action",
    to: { kind: "lead", id: app.leadId },
    params: { applicationId, kind, conditions },
  });
  return snapshot;
}
