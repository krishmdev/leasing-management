import { db } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { tenantDb } from "@/server/tenant";
import { maybeStartEvaluation } from "@/server/domain/applications/service";
import { screeningProvider } from "./providers";

/**
 * Provider webhook. Dedupe on the provider's event id, record the status change and queue the
 * next job in a single transaction: a redelivered event is a no-op, and a crash can't leave the
 * status changed without the evaluation queued (or the reverse).
 */
export async function handleScreeningWebhook(providerId: string, req: Request): Promise<{ status: number; body: object }> {
  const provider = screeningProvider(providerId);
  const ev = await provider.verifyWebhook(req);
  if (!ev) return { status: 401, body: { error: "bad signature" } };
  // Provider refs are globally unique; this lookup tells us which tenant the event belongs to.
  const sr = await db().screeningRequest.findUnique({ where: { providerApplicantRef: ev.ref } });
  if (!sr) return { status: 404, body: { error: "unknown ref" } };
  return tenantDb(sr.agencyId).$transaction(async (tx) => {
    const fresh = await tx.webhookEvent.createMany({ data: [{ provider: provider.id, eventId: ev.eventId, payload: { ref: ev.ref, event: ev.event } }], skipDuplicates: true });
    if (fresh.count === 0) return { status: 200, body: { duplicate: true } };
    await tx.screeningRequest.updateMany({ where: { id: sr.id, status: { not: "COMPLETE" } }, data: { status: ev.event === "COMPLETE" ? "COMPLETE" : "ERROR" } });
    await audit({ agencyId: sr.agencyId, actorType: "SYSTEM", action: `screening.${ev.event.toLowerCase()}`, entity: "ScreeningRequest", entityId: sr.id, metadata: { provider: provider.id } }, tx);
    const queued = ev.event === "COMPLETE" ? await maybeStartEvaluation(tx, sr.agencyId, sr.applicationId) : false;
    return { status: 200, body: { ok: true, evaluationQueued: queued } };
  });
}
