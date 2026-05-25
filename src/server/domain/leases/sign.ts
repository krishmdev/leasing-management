import { z } from "zod";
import { uuidv7 } from "@/lib/ids";
import { db } from "@/server/db";
import { hashToken } from "@/server/crypto/tokens";
import { enqueueDocument, enqueueEmail } from "@/server/outbox/outbox";
import { audit } from "@/server/audit/audit";
import { tenantDb } from "@/server/tenant";
import { withTxRetry } from "@/server/txRetry";
import { faults } from "@/server/faults";
import { advanceStage } from "@/server/domain/leads/service";
import { dbNow, lockHoldForApplication, lockLease, lockUnit } from "@/server/domain/locks";
import { escalate } from "@/server/domain/decisions/decide";
import { LEASE_TEMPLATE } from "@/server/domain/decisions/holds";

export const SignInput = z.object({
  typedName: z.string().trim().min(2).max(120),
  docSha256: z.string().regex(/^[0-9a-f]{64}$/),
  consent: z.literal(true),
});

export interface SignSuccess {
  status: "SIGNED";
  leaseId: string;
  signatureId: string;
  docSha256: string;
  signedAt: string;
}

export type SignResult =
  | { http: 200; body: SignSuccess }
  | { http: 404 | 409 | 410 | 422; body: { error: string; code: string } };

const fail = (http: 404 | 409 | 410 | 422, code: string, error: string): SignResult => ({ http, body: { code, error } });

/** Lease lookup by the signing link. Authentication is the hash match alone; see signLease. */
export async function leaseByToken(token: string) {
  return db().lease.findUnique({ where: { signTokenHash: hashToken(token) } });
}

/**
 * Sign a lease. One transaction; locks Unit then Lease then the hold (canonical order).
 *
 * The replay check comes before every other check. A retried request for a signature that
 * already succeeded (a double click, a client timeout, the hold having since been consumed)
 * gets back byte-for-byte the response the first request got, with HTTP 200 and no writes.
 * That's why the token is authenticated by hash alone here and its expiry is only enforced
 * when no signature exists yet, and why the token hash is never cleared.
 *
 * A signer who lost the race for the unit gets a 409 and their own application is escalated.
 * Nothing here touches other applicants' rows; the hold sweeper notifies them afterwards.
 */
export async function signLease(token: string, input: z.input<typeof SignInput>, meta: { ip?: string | null; ua?: string | null } = {}): Promise<SignResult> {
  const parsed = SignInput.safeParse(input);
  if (!parsed.success) return fail(422, "INVALID", "Type your full name, confirm, and sign the reviewed document.");
  const d = parsed.data;
  const pre = await leaseByToken(token);
  if (!pre) return fail(404, "NOT_FOUND", "This signing link isn't valid.");
  const agencyId = pre.agencyId;

  return withTxRetry(() =>
    tenantDb(agencyId).$transaction(async (tx): Promise<SignResult> => {
      const unit = await lockUnit(tx, agencyId, pre.unitId);
      const lease = await lockLease(tx, agencyId, pre.id);
      if (!unit || !lease) return fail(404, "NOT_FOUND", "This signing link isn't valid.");

      const prior = await tx.signature.findUnique({ where: { leaseId_signerId: { leaseId: lease.id, signerId: lease.signerId } } });
      if (prior) return { http: 200, body: prior.responseJson as unknown as SignSuccess };

      // First signature from here on.
      const current = await tx.lease.findUniqueOrThrow({ where: { id: lease.id } });
      if (current.signTokenHash !== hashToken(token)) return fail(410, "LINK_REPLACED", "A newer signing link was sent; use the latest email.");
      const now = await dbNow(tx, agencyId);
      const hold = await lockHoldForApplication(tx, agencyId, lease.applicationId);

      const occupied = await tx.residency.count({ where: { unitId: unit.id, status: { in: ["FUTURE", "CURRENT", "NOTICE"] } } });
      const heldByOther = await tx.unitHold.count({ where: { unitId: unit.id, status: "ACTIVE", applicationId: { not: lease.applicationId } } });
      const unavailable = unit.status === "LEASED" || unit.status === "OFF_MARKET" || occupied > 0 || (heldByOther > 0 && !hold?.live);
      if (unavailable) {
        await escalate(tx, agencyId, lease.applicationId, ["UNIT_NO_LONGER_AVAILABLE"], { leaseId: lease.id });
        return fail(409, "UNIT_UNAVAILABLE", "Sorry, this home is no longer available. A leasing agent will contact you.");
      }
      if (lease.status !== "SENT") return fail(409, "LEASE_NOT_OPEN", "This lease isn't open for signing.");
      if (!hold || hold.unitId !== lease.unitId || hold.status !== "ACTIVE" || !hold.live || lease.signTokenExpiresAt <= now) {
        return fail(409, "HOLD_EXPIRED", "Your hold on this home has expired. Contact the leasing office.");
      }
      const doc = await tx.generatedDocument.findFirst({ where: { applicationId: lease.applicationId, kind: "LEASE", templateVersion: LEASE_TEMPLATE } });
      if (!doc) return fail(409, "NOT_READY", "The lease document is still being prepared. Try again in a minute.");
      if (doc.sha256 !== d.docSha256) return fail(409, "DOC_CHANGED", "The lease changed since you opened it. Reload and review it again.");

      const sig = { id: uuidv7() };
      const body: SignSuccess = { status: "SIGNED", leaseId: lease.id, signatureId: sig.id, docSha256: doc.sha256, signedAt: now.toISOString() };
      await tx.signature.create({
        data: {
          id: sig.id, agencyId, leaseId: lease.id, signerId: lease.signerId, typedName: d.typedName, ip: meta.ip ?? null, ua: meta.ua?.slice(0, 300) ?? null,
          docSha256: doc.sha256, signedAt: now, responseJson: { ...body },
        },
      });
      await tx.lease.update({ where: { id: lease.id }, data: { status: "SIGNED", signedAt: now } });
      const app = await tx.application.findUniqueOrThrow({ where: { id: lease.applicationId } });
      const today = now.toISOString().slice(0, 10);
      await tx.residency.create({
        data: {
          agencyId, unitId: unit.id, leaseId: lease.id, leadId: lease.signerId, residentUserId: app.userId,
          moveIn: lease.startDate, moveOut: lease.endDate, status: lease.startDate.toISOString().slice(0, 10) <= today ? "CURRENT" : "FUTURE", rentCents: current.rentCents,
        },
      });
      await tx.unitHold.update({ where: { id: hold.id }, data: { status: "CONSUMED" } });
      await tx.unit.update({ where: { id: unit.id }, data: { status: "LEASED" } });
      await tx.application.updateMany({ where: { id: app.id, status: "LEASE_SENT" }, data: { status: "LEASE_SIGNED", statusChangedAt: now } });
      await advanceStage(tx, agencyId, app.leadId, app.unitId, "LEASE_SIGNED", now);
      await enqueueDocument(tx, agencyId, `doc:${lease.id}:SIGNED_LEASE:v1`, { kind: "SIGNED_LEASE", templateVersion: "signedLease.v1", applicationId: app.id, leaseId: lease.id });
      await enqueueEmail(tx, agencyId, `mail:lease:${lease.id}:signed`, { template: "lease.signed", to: { kind: "lead", id: app.leadId }, params: { leaseId: lease.id } });
      await audit({ agencyId, actorType: "APPLICANT", actorId: app.userId, action: "lease.signed", entity: "Lease", entityId: lease.id, metadata: { signatureId: sig.id, docSha256: doc.sha256 } }, tx);
      faults.hit("sign:before-commit");
      return { http: 200, body };
    }),
  );
}

/** Staff can only list or unlist a unit; LEASED and PENDING are set by holds and signing. */
export async function setUnitListed(agencyId: string, actorId: string, unitId: string, listed: boolean) {
  return tenantDb(agencyId).$transaction(async (tx) => {
    const unit = await lockUnit(tx, agencyId, unitId);
    if (!unit) throw new Error("unit not found");
    const from = listed ? "OFF_MARKET" : "AVAILABLE";
    const to = listed ? "AVAILABLE" : "OFF_MARKET";
    if (unit.status !== from) throw new Error(`can't change a ${unit.status.toLowerCase()} unit`);
    await tx.unit.update({ where: { id: unitId }, data: { status: to } });
    await audit({ agencyId, actorType: "USER", actorId, action: listed ? "unit.listed" : "unit.unlisted", entity: "Unit", entityId: unitId }, tx);
  });
}
