import { tenantDb } from "@/server/tenant";

/** The signed-in user's current (or upcoming) residency at this agency, if any. */
export async function residencyFor(agencyId: string, userId: string) {
  return tenantDb(agencyId).residency.findFirst({
    where: { residentUserId: userId, status: { in: ["CURRENT", "NOTICE", "FUTURE"] } },
    include: { unit: { include: { property: true } } },
    orderBy: { moveIn: "desc" },
  });
}
