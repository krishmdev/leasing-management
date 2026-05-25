import { renderToBuffer } from "@react-pdf/renderer";
import { sha256Hex } from "@/server/crypto/tokens";
import { decryptField } from "@/server/crypto/fieldEncryption";
import { tenantDb } from "@/server/tenant";
import { putObject } from "@/server/storage";
import type { DocumentPayload, OutboxRow } from "@/server/outbox/outbox";
import { decryptApplication } from "@/server/domain/applications/service";
import { dayLabel, usd } from "@/lib/format";
import { AdverseActionDoc, LeaseDoc, SummaryDoc, type Meta } from "./templates";

export const docStorageKey = (agencyId: string, idempotencyKey: string) => `agencies/${agencyId}/documents/${sha256Hex(idempotencyKey).slice(0, 40)}.pdf`;

/**
 * Outbox DOCUMENT handler. Storage key and PDF dates derive from the outbox key and the source
 * records, so a re-render after a crash writes the same file, and the GeneratedDocument insert
 * is create-only: if an earlier attempt already recorded it, that row stands.
 */
export async function renderDocument(row: OutboxRow & { payload: DocumentPayload }) {
  const { agencyId } = row;
  const p = row.payload;
  const t = tenantDb(agencyId);
  const existing = await t.generatedDocument.findUnique({ where: { idempotencyKey: row.idempotencyKey } });
  if (existing) return existing;

  const org = await t.organization.findUniqueOrThrow({ where: { id: agencyId } });
  const app = await t.application.findUniqueOrThrow({ where: { id: p.applicationId }, include: { unit: { include: { property: true } } } });
  const applicant = decryptApplication(app).legalName ?? "Applicant";
  const address = `${app.unit.property.street}, ${app.unit.label}, ${app.unit.property.city}, CA ${app.unit.property.zip}`;
  const meta = (title: string, createdAt: Date): Meta => ({ title, agencyName: org.name, createdAt, docRef: `${p.kind} · ${row.idempotencyKey}` });

  let el;
  if (p.kind === "LEASE" || p.kind === "SIGNED_LEASE") {
    const lease = await t.lease.findUniqueOrThrow({ where: { id: p.leaseId! } });
    const sig = p.kind === "SIGNED_LEASE" ? await t.signature.findFirstOrThrow({ where: { leaseId: lease.id } }) : null;
    el = (
      <LeaseDoc
        d={{
          meta: meta(p.kind === "LEASE" ? "Lease" : "Signed lease", sig?.signedAt ?? lease.createdAt),
          tenant: applicant, address, rent: usd(lease.rentCents), deposit: usd(lease.depositCents),
          start: dayLabel(lease.startDate, { month: "long", day: "numeric", year: "numeric" }), end: dayLabel(lease.endDate, { month: "long", day: "numeric", year: "numeric" }),
          jurisdiction: "California",
          signature: sig ? { typedName: sig.typedName, signedAt: sig.signedAt.toISOString(), ip: sig.ip ?? "unknown", docSha256: sig.docSha256, signatureId: sig.id } : undefined,
        }}
      />
    );
  } else if (p.kind === "SUMMARY") {
    const rec = await t.recommendation.findFirstOrThrow({ where: { applicationId: app.id, criteriaVersionId: app.criteriaVersionId! } });
    const crit = await t.screeningCriteria.findUniqueOrThrow({ where: { id: app.criteriaVersionId! } });
    const steps = await t.agentStep.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "asc" } });
    const b = rec.breakdown as { factors: { factor: string; points: number; max: number; detail: string }[] };
    el = (
      <SummaryDoc
        d={{
          meta: meta("Application summary", rec.createdAt), applicant, unit: `${app.unit.property.name} ${app.unit.label}`, score: rec.rubricScore, outcome: rec.outcome,
          flags: rec.flags, factors: b.factors, rationale: rec.rationale, rationaleSource: rec.rationaleSource, criteriaVersion: crit.version,
          steps: steps.map((x) => ({ name: x.stepName, status: x.status, ms: x.durationMs })),
        }}
      />
    );
  } else {
    const n = await t.adverseActionNotice.findUniqueOrThrow({ where: { applicationId: app.id } });
    const snap = n.craSnapshot as unknown as { cra: { name: string; address: string; phone: string; website: string }; usedCra: boolean; score: { value: number; model: string | null; range: (number | null)[]; keyFactors: string[]; date: string | null } | null };
    const reasons = n.reasonCodes as unknown as { text: string; basis: string }[];
    el = (
      <AdverseActionDoc
        d={{
          meta: meta("Notice of adverse action", n.createdAt), applicant, address, reasons,
          cra: snap.usedCra ? snap.cra : null, score: snap.score ? { ...snap.score, date: snap.score.date ? String(snap.score.date).slice(0, 10) : null } : null,
          thirdParty: reasons.some((r) => r.basis === "THIRD_PARTY"),
        }}
      />
    );
  }

  const pdf = await renderToBuffer(el);
  const storageKey = docStorageKey(agencyId, row.idempotencyKey);
  await putObject(storageKey, pdf);
  await t.generatedDocument.createMany({
    data: [{ agencyId, applicationId: app.id, leaseId: p.leaseId ?? null, kind: p.kind, templateVersion: p.templateVersion, idempotencyKey: row.idempotencyKey, storageKey, sha256: sha256Hex(pdf), bytes: pdf.length }],
    skipDuplicates: true,
  });
  if (p.kind === "ADVERSE_ACTION") {
    const doc = await t.generatedDocument.findUniqueOrThrow({ where: { idempotencyKey: row.idempotencyKey } });
    await t.adverseActionNotice.updateMany({ where: { applicationId: app.id, documentId: null }, data: { documentId: doc.id } });
  }
  return t.generatedDocument.findUniqueOrThrow({ where: { idempotencyKey: row.idempotencyKey } });
}
