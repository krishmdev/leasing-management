import type { Prisma } from "@/generated/prisma/client";
import { decryptField } from "@/server/crypto/fieldEncryption";
import { enqueueDocument, enqueueEmail } from "@/server/outbox/outbox";
import type { TenantTx } from "@/server/tenant";
import { screeningProvider } from "./providers";
import type { CraDisclosure } from "./providers/types";
import type { ReasonCode } from "./rubric";

export interface CraScoreSnapshot {
  value: number | null;
  band: string;
  model: string | null;
  range: (number | null)[];
  keyFactors: string[];
  date: string | null;
}

export interface AdverseNoticeSnapshot {
  kind: "DECLINE" | "CONDITIONAL";
  cra: CraDisclosure;
  usedCra: boolean;
  score: CraScoreSnapshot | null;
  conditions: string[];
}

export type NoticeReason = ReasonCode | { code: string; basis: string; text: string; factor?: string; pointsLost?: number };

export interface BuildAdverseNoticeParams {
  kind: "DECLINE" | "CONDITIONAL";
  reasons: NoticeReason[];
  conditions?: string[];
  provider?: string;
  result?: {
    creditBand: string;
    creditScore?: number | null;
    scoreModel?: string | null;
    scoreRangeMin?: number | null;
    scoreRangeMax?: number | null;
    keyFactors?: string[];
    scoreDate?: Date | string | null;
  } | null;
  score?: number | null;
  craDisclosure?: CraDisclosure;
}

/**
 * The CRA block for a notice. Pure, so the FCRA content rules are unit-testable.
 */
export function buildAdverseNoticeSnapshot(params: BuildAdverseNoticeParams): AdverseNoticeSnapshot {
  const { kind, reasons, conditions = [], result, provider, craDisclosure } = params;
  const usedCra = !!result || reasons.some((x) => x.basis === "CRA");
  const cra = craDisclosure ?? screeningProvider(provider).craDisclosure();
  const scoreVal = params.score !== undefined ? params.score : (result?.creditScore ?? null);

  const scoreSnapshot: CraScoreSnapshot | null = (usedCra && result)
    ? {
        value: scoreVal,
        band: result.creditBand,
        model: result.scoreModel ?? null,
        range: [result.scoreRangeMin ?? null, result.scoreRangeMax ?? null],
        keyFactors: result.keyFactors ? result.keyFactors.slice(0, 4) : [],
        date: result.scoreDate ? (result.scoreDate instanceof Date ? result.scoreDate.toISOString() : String(result.scoreDate)) : null,
      }
    : null;

  return {
    kind,
    cra,
    usedCra,
    score: scoreSnapshot,
    conditions: kind === "CONDITIONAL" ? conditions : [],
  };
}

/**
 * Record an adverse-action (or conditional-approval) notice and queue its PDF and email, in the
 * caller's decision transaction. sentAt stays empty: the email is only queued here.
 */
export async function generateAdverseActionNotice(
  tx: TenantTx,
  agencyId: string,
  applicationId: string,
  reasons: NoticeReason[],
  kind: "DECLINE" | "CONDITIONAL",
  conditions: string[] = []
): Promise<AdverseNoticeSnapshot> {
  const sr = await tx.screeningRequest.findFirst({
    where: { applicationId },
    include: { result: true },
  });
  const r = sr?.result;
  const score = r?.creditScoreEnc
    ? Number(decryptField({ agencyId, model: "ScreeningResult", id: r.id, field: "creditScoreEnc" }, r.creditScoreEnc))
    : null;

  const craSnapshot = buildAdverseNoticeSnapshot({
    kind,
    reasons,
    conditions,
    provider: sr?.provider,
    result: r,
    score,
  });

  await tx.adverseActionNotice.createMany({
    data: [{
      agencyId,
      applicationId,
      reasonCodes: reasons as unknown as Prisma.InputJsonArray,
      basis: [...new Set(reasons.map((x) => x.basis))],
      craSnapshot: JSON.parse(JSON.stringify(craSnapshot)) as Prisma.InputJsonObject,
    }],
    skipDuplicates: true,
  });

  await enqueueDocument(
    tx,
    agencyId,
    `doc:${applicationId}:ADVERSE_ACTION:adverseAction.v1`,
    { kind: "ADVERSE_ACTION", templateVersion: "adverseAction.v1", applicationId }
  );

  const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
  await enqueueEmail(
    tx,
    agencyId,
    `mail:app:${applicationId}:adverse-action`,
    {
      template: "application.adverse_action",
      to: { kind: "lead", id: app.leadId },
      params: { applicationId, kind, conditions },
    }
  );

  return craSnapshot;
}
