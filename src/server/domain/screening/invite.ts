import { faults } from "@/server/faults";
import { enqueueEmail } from "@/server/outbox/outbox";
import { audit } from "@/server/audit/audit";
import { tenantDb } from "@/server/tenant";
import type { StepCtx } from "@/server/agent/durable";
import { decryptLead } from "@/server/domain/leads/service";
import { screeningProvider } from "./providers";

export const screeningKey = (applicationId: string, criteriaVersion: number) => `app:${applicationId}:screen:v${criteriaVersion}`;

/**
 * The screening.invite step. Order matters for crash safety:
 *   1. commit a ScreeningRequest row carrying the idempotency key, on its own;
 *   2. if the row has no provider ref yet, ask the provider whether it already knows this key
 *      (a previous attempt may have created the invitation and died before step 3);
 *   3. only if it doesn't, create the invitation, sending the same key;
 *   4. record the ref and queue the applicant's email in one guarded transaction.
 */
export async function inviteToScreening(ctx: StepCtx, agencyId: string, applicationId: string) {
  const t = tenantDb(agencyId);
  const app = await t.application.findUniqueOrThrow({ where: { id: applicationId }, include: { unit: true, lead: true, criteria: true } });
  if (!app.criteriaVersionId || !app.criteria) throw new Error("criteria not locked");
  const provider = screeningProvider();
  const key = screeningKey(app.id, app.criteria.version);

  await t.screeningRequest.createMany({ data: [{ agencyId, applicationId, criteriaVersionId: app.criteriaVersionId, provider: provider.id, idempotencyKey: key }], skipDuplicates: true });
  const sr = await t.screeningRequest.findUniqueOrThrow({ where: { idempotencyKey: key } });
  if (sr.providerApplicantRef) return { ref: sr.providerApplicantRef, reconciled: false, created: false };

  let inv = await provider.findExisting(key);
  const reconciled = !!inv;
  if (!inv) {
    inv = await provider.createInvitation({
      idempotencyKey: key,
      applicantEmail: decryptLead(app.lead).email,
      rentCents: app.unit.rentCents,
      callbackUrl: `${(process.env.APP_URL ?? "http://localhost:3041").replace(/\/$/, "")}/api/webhooks/screening/${provider.id}`,
      signal: ctx.signal,
    });
  }
  faults.hit("screening:after-provider-call");

  await ctx.tx(async (tx) => {
    const n = await tx.screeningRequest.updateMany({
      where: { id: sr.id, providerApplicantRef: null },
      data: { providerApplicantRef: inv.providerApplicantRef, hostedUrl: inv.hostedUrl, status: "INVITED" },
    });
    if (n.count === 1) {
      await enqueueEmail(tx, agencyId, `mail:app:${applicationId}:screening-invite:v${app.criteria!.version}`, {
        template: "screening.invite",
        to: { kind: "lead", id: app.leadId },
        params: { applicationId, screeningRequestId: sr.id },
      });
      await audit({ agencyId, actorType: "AGENT", action: "screening.invited", entity: "ScreeningRequest", entityId: sr.id, metadata: { provider: provider.id, reconciled } }, tx);
    }
  });
  return { ref: inv.providerApplicantRef, reconciled, created: !reconciled };
}
