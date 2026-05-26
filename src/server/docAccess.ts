import { headers } from "next/headers";
import { db } from "@/server/db";
import { auth } from "@/server/auth";
import { can } from "@/server/access";
import { hashToken } from "@/server/crypto/tokens";
import { audit } from "@/server/audit/audit";
import { getObject } from "@/server/storage";

/**
 * Who may download a generated document:
 *  - staff of the owning agency with applications.read;
 *  - the applicant (their Better Auth session owns the application);
 *  - the holder of the lease signing link, for that lease's documents.
 * Every download is audited.
 */
export async function loadDocumentFor(id: string, leaseToken: string | null) {
  const doc = await db().generatedDocument.findUnique({ where: { id } });
  if (!doc) return null;
  const session = await auth().api.getSession({ headers: await headers() });
  let actor: { type: "USER" | "APPLICANT"; id: string | null } | null = null;
  if (session) {
    const m = await db().member.findFirst({ where: { organizationId: doc.agencyId, userId: session.user.id } });
    if (m && can(m.role, "applications.read")) actor = { type: "USER", id: session.user.id };
    if (!actor && doc.applicationId) {
      const app = await db().application.findUnique({ where: { id: doc.applicationId } });
      if (app?.userId === session.user.id && app.agencyId === doc.agencyId) actor = { type: "APPLICANT", id: session.user.id };
    }
  }
  if (!actor && leaseToken && doc.leaseId) {
    const lease = await db().lease.findUnique({ where: { signTokenHash: hashToken(leaseToken) } });
    if (lease && lease.id === doc.leaseId && lease.agencyId === doc.agencyId) actor = { type: "APPLICANT", id: null };
  }
  if (!actor) return "forbidden" as const;
  await audit({ agencyId: doc.agencyId, actorType: actor.type, actorId: actor.id, action: "document.downloaded", entity: "GeneratedDocument", entityId: doc.id, metadata: { kind: doc.kind } });
  return { doc, bytes: await getObject(doc.storageKey) };
}
