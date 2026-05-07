import "server-only";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { cache } from "react";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { tenantDb } from "@/server/tenant";
import { assertCan, type Permission, type Role } from "@/server/access";

export const getSession = cache(async () => auth().api.getSession({ headers: await headers() }));

export interface StaffCtx {
  agencyId: string;
  agencySlug: string;
  agencyName: string;
  userId: string;
  userName: string;
  role: Role;
  tdb: ReturnType<typeof tenantDb>;
}

/** Staff pages call this first. Membership is checked here, never in proxy.ts. */
export const requireStaff = cache(async (slug: string, perm?: Permission): Promise<StaffCtx> => {
  const session = await getSession();
  if (!session) redirect(`/login?next=/dashboard/${slug}`);
  const org = await db().organization.findUnique({ where: { slug } });
  if (!org) notFound();
  const member = await db().member.findFirst({ where: { organizationId: org.id, userId: session.user.id } });
  if (!member) notFound();
  const role = member.role as Role;
  if (perm) assertCan(role, perm);
  return {
    agencyId: org.id,
    agencySlug: org.slug,
    agencyName: org.name,
    userId: session.user.id,
    userName: session.user.name,
    role,
    tdb: tenantDb(org.id),
  };
});

export async function staffMemberships(userId: string) {
  return db().member.findMany({ where: { userId }, include: { organization: true }, orderBy: { createdAt: "asc" } });
}
