import type { TenantDb } from "@/server/tenant";

const DAY = 86_400_000;
export const FUNNEL = ["INTEREST", "SHOWING", "APPLIED", "SCREENED", "DECISION", "LEASE_SIGNED"] as const;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Pure: stage events -> reached counts and median days spent in each stage. */
export function funnelFrom(events: { opportunityId: string; from: string | null; to: string; at: Date }[]) {
  const reached = new Map<string, Set<string>>(FUNNEL.map((s) => [s, new Set()]));
  const byOpp = new Map<string, { to: string; at: Date }[]>();
  for (const e of events) {
    reached.get(e.to)?.add(e.opportunityId);
    byOpp.set(e.opportunityId, [...(byOpp.get(e.opportunityId) ?? []), { to: e.to, at: e.at }]);
  }
  const dwell = new Map<string, number[]>(FUNNEL.map((s) => [s, []]));
  for (const list of byOpp.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    for (let i = 0; i + 1 < list.length; i++) dwell.get(list[i].to)?.push((list[i + 1].at.getTime() - list[i].at.getTime()) / DAY);
  }
  // Anyone further down the funnel also passed through the earlier stages, even if they skipped one (e.g. applied without a showing).
  const counts = FUNNEL.map((s, i) => ({ stage: s, count: new Set(FUNNEL.slice(i).flatMap((x) => [...reached.get(x)!])).size }));
  return counts.map((c, i) => ({
    ...c,
    conversion: i === 0 || counts[i - 1].count === 0 ? null : c.count / counts[i - 1].count,
    medianDays: median(dwell.get(c.stage)!),
  }));
}

/** Trailing-12-month turnover: move-outs in the window over the number of units. */
export function turnoverRate(moveOuts: number, units: number) {
  return units ? moveOuts / units : 0;
}

export async function dashboardMetrics(t: TenantDb, now = new Date()) {
  const since90 = new Date(now.getTime() - 90 * DAY);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since12m = new Date(now.getTime() - 365 * DAY);
  const [events, showings, screened, units, residencies, resolved, openApprovals] = await Promise.all([
    t.stageEvent.findMany({ where: { at: { gte: since90 } }, select: { opportunityId: true, from: true, to: true, at: true } }),
    t.showing.groupBy({ by: ["status"], where: { startsAt: { gte: since90, lt: now } }, _count: true }),
    t.screeningRequest.findMany({ where: { status: "COMPLETE", createdAt: { gte: since90 } }, select: { createdAt: true, updatedAt: true } }),
    t.unit.findMany({ select: { id: true, status: true, rentCents: true, availableOn: true } }),
    t.residency.findMany({ where: { OR: [{ moveOut: { gte: new Date(now.getTime() - 18 * 31 * DAY) } }, { moveIn: { gte: new Date(now.getTime() - 18 * 31 * DAY) } }, { status: { in: ["CURRENT", "NOTICE", "FUTURE"] } }] }, select: { unitId: true, moveIn: true, moveOut: true, status: true } }),
    t.maintenanceTicket.findMany({ where: { resolvedAt: { gte: since30 } }, select: { urgency: true, createdAt: true, resolvedAt: true, pausedMs: true, respondBreached: true, resolveBreached: true } }),
    t.approvalTask.count({ where: { status: "OPEN" } }),
  ]);

  const funnel = funnelFrom(events);
  const sc = Object.fromEntries(showings.map((s) => [s.status, s._count])) as Record<string, number>;
  const attended = (sc.COMPLETED ?? 0) + (sc.NO_SHOW ?? 0);
  const noShowRate = attended ? (sc.NO_SHOW ?? 0) / attended : null;
  const turnaroundH = median(screened.map((s) => (s.updatedAt.getTime() - s.createdAt.getTime()) / 3_600_000));

  // Vacancy: a unit is vacant today if no residency covers today. Days vacant count from the
  // later of its last move-out and its listed available date.
  const today = now.getTime();
  const covered = new Set(residencies.filter((r) => r.moveIn.getTime() <= today && (!r.moveOut || r.moveOut.getTime() > today)).map((r) => r.unitId));
  const lastOut = new Map<string, number>();
  for (const r of residencies) if (r.moveOut && r.moveOut.getTime() <= today) lastOut.set(r.unitId, Math.max(lastOut.get(r.unitId) ?? 0, r.moveOut.getTime()));
  const vacant = units.filter((u) => u.status !== "OFF_MARKET" && !covered.has(u.id));
  let vacancyLossCents = 0;
  let vacantDays = 0;
  for (const u of vacant) {
    const from = Math.max(lastOut.get(u.id) ?? 0, u.availableOn.getTime());
    const days = Math.max(0, Math.floor((today - from) / DAY));
    vacantDays += days;
    vacancyLossCents += Math.round((u.rentCents / 30) * days);
  }
  const occupancy = units.length ? covered.size / units.length : 0;
  const moveOuts12 = residencies.filter((r) => r.moveOut && r.moveOut >= since12m && r.moveOut.getTime() <= today && r.status === "PAST").length;

  // Monthly move-ins and move-outs, last 18 months.
  const months: { month: string; moveIns: number; moveOuts: number }[] = [];
  for (let i = 17; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    months.push({
      month: key,
      moveIns: residencies.filter((r) => r.moveIn.toISOString().startsWith(key)).length,
      moveOuts: residencies.filter((r) => r.moveOut && r.moveOut.getTime() <= today && r.moveOut.toISOString().startsWith(key)).length,
    });
  }

  const byUrgency = (["EMERGENCY", "HIGH", "NORMAL", "LOW"] as const).map((u) => {
    const rows = resolved.filter((r) => r.urgency === u);
    const mttr = median(rows.map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime() - r.pausedMs) / 3_600_000));
    return { urgency: u, resolved: rows.length, onTime: rows.filter((r) => !r.resolveBreached && !r.respondBreached).length, medianHours: mttr };
  });
  const slaResolved = resolved.length;
  const slaOnTime = resolved.filter((r) => !r.resolveBreached && !r.respondBreached).length;

  return {
    funnel,
    noShowRate,
    showingsAttended: attended,
    turnaroundH,
    screenedCount: screened.length,
    occupancy,
    units: units.length,
    vacantUnits: vacant.length,
    vacantDays,
    vacancyLossCents,
    t12Turnover: turnoverRate(moveOuts12, units.length),
    moveOuts12,
    months,
    sla: { resolved: slaResolved, onTime: slaOnTime, rate: slaResolved ? slaOnTime / slaResolved : null, byUrgency },
    openApprovals,
  };
}
