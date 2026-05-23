import type { TenantTx } from "@/server/tenant";
import { criteriaFor, criteriaHash, CriteriaConfig } from "./criteria";

/** The agency's current criteria version, creating v1 on first use. Rows are immutable. */
export async function activeCriteria(tx: TenantTx, agencyId: string) {
  const settings = await tx.agencySettings.findFirstOrThrow({});
  if (settings.activeCriteriaId) {
    const c = await tx.screeningCriteria.findUnique({ where: { id: settings.activeCriteriaId } });
    if (c) return { ...c, parsed: CriteriaConfig.parse(c.config) };
  }
  const config = criteriaFor(settings.jurisdictionCity);
  await tx.screeningCriteria.createMany({ data: [{ agencyId, version: config.version, config, configSha256: criteriaHash(config) }], skipDuplicates: true });
  const c = await tx.screeningCriteria.findFirstOrThrow({ where: { version: config.version } });
  await tx.agencySettings.updateMany({ where: { activeCriteriaId: null }, data: { activeCriteriaId: c.id } });
  return { ...c, parsed: CriteriaConfig.parse(c.config) };
}

export async function criteriaById(tx: Pick<TenantTx, "screeningCriteria">, id: string) {
  const c = await tx.screeningCriteria.findUniqueOrThrow({ where: { id } });
  return { ...c, parsed: CriteriaConfig.parse(c.config) };
}
