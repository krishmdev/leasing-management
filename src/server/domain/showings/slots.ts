import { TZDate } from "@date-fns/tz";

export interface Rule {
  agentUserId: string;
  weekday: number; // 0 = Sunday, in the agency's timezone
  startMin: number; // minutes after local midnight
  endMin: number;
  slotMin: number;
  bufferMin: number;
}
export interface Interval {
  agentUserId: string;
  startsAt: Date;
  endsAt: Date;
}
export interface Slot {
  start: Date;
  end: Date;
  agentIds: string[];
}

const MIN = 60_000;

/**
 * Bookable showing slots. Pure: everything it needs is passed in.
 * Local wall-clock rules are expanded per local day with TZDate, so a 9:00–12:00 rule stays
 * 9:00–12:00 local across DST changes (and a slot that falls in the spring-forward gap simply
 * doesn't exist).
 */
export function generateSlots(opts: {
  rules: Rule[];
  exceptions: Interval[];
  busy: Interval[];
  from: Date;
  to: Date;
  now: Date;
  tz: string;
  leadTimeMin?: number;
}): Slot[] {
  const { rules, exceptions, busy, from, to, now, tz, leadTimeMin = 120 } = opts;
  const earliest = now.getTime() + leadTimeMin * MIN;
  const byStart = new Map<number, Slot>();

  const first = new TZDate(from.getTime(), tz);
  let day = new TZDate(first.getFullYear(), first.getMonth(), first.getDate(), 0, 0, tz);
  while (day.getTime() < to.getTime()) {
    const y = day.getFullYear();
    const m = day.getMonth();
    const d = day.getDate();
    for (const r of rules) {
      if (r.weekday !== day.getDay()) continue;
      for (let t = r.startMin; t + r.slotMin <= r.endMin; t += r.slotMin) {
        const start = new TZDate(y, m, d, Math.floor(t / 60), t % 60, tz);
        // Spring-forward gap: 2:30 local doesn't exist and TZDate shifts it; skip those.
        if (start.getHours() * 60 + start.getMinutes() !== t) continue;
        const s = start.getTime();
        const e = s + r.slotMin * MIN;
        if (s < earliest || s < from.getTime() || e > to.getTime()) continue;
        if (exceptions.some((x) => x.agentUserId === r.agentUserId && overlaps(s, e, x.startsAt.getTime(), x.endsAt.getTime()))) continue;
        const buf = r.bufferMin * MIN;
        if (busy.some((b) => b.agentUserId === r.agentUserId && overlaps(s, e, b.startsAt.getTime() - buf, b.endsAt.getTime() + buf))) continue;
        const slot = byStart.get(s) ?? { start: new Date(s), end: new Date(e), agentIds: [] };
        if (!slot.agentIds.includes(r.agentUserId)) slot.agentIds.push(r.agentUserId);
        byStart.set(s, slot);
      }
    }
    day = new TZDate(y, m, d + 1, 0, 0, tz);
  }
  return [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

/** Listing agent if they're free, otherwise whoever has the fewest showings that day. */
export function pickAgent(slot: Slot, listingAgentId: string | null, loadByAgent: Map<string, number>): string {
  if (listingAgentId && slot.agentIds.includes(listingAgentId)) return listingAgentId;
  return [...slot.agentIds].sort((a, b) => (loadByAgent.get(a) ?? 0) - (loadByAgent.get(b) ?? 0) || a.localeCompare(b))[0];
}
