import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

export type ActorType = "USER" | "AGENT" | "SYSTEM" | "APPLICANT" | "REFERENCE" | "RESIDENT";

export interface AuditEntry {
  agencyId: string | null;
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  /** Counts, ids, versions. Never names, emails or other PII. */
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Anything with an auditLog delegate: the base client, a tenant client, or either's transaction. */
export type AuditClient = { auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown> } };

const PII_KEY = /(name|email|phone|address|ssn|dob|birth|text|message)/i;

/** Pass the transaction client so the audit row commits (or rolls back) with the change it records. */
export async function audit(entry: AuditEntry, client: AuditClient = db()) {
  const metadata = entry.metadata ?? {};
  for (const k of Object.keys(metadata)) {
    if (PII_KEY.test(k) && !/(count|Id|version|Version)$/.test(k)) {
      throw new Error(`audit metadata key "${k}" looks like PII`);
    }
  }
  await client.auditLog.create({
    data: {
      agencyId: entry.agencyId,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      metadata: metadata as Prisma.InputJsonObject,
      ip: entry.ip ?? null,
    },
  });
}
