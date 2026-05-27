import { faker } from "@faker-js/faker";
import { uuidv7 } from "@/lib/ids";
import { db } from "@/server/db";
import { emailBidx } from "@/server/crypto/blindIndex";
import { fields } from "@/server/crypto/fieldEncryption";
import { createTicket, transitionTicket } from "@/server/domain/maintenance/tickets";

/**
 * Historical data, written directly: residencies from before this system existed (as if
 * imported from a previous property-management tool), so turnover and vacancy have 18 months
 * to work with. Tickets go through the ticket service with backdated clocks.
 */
export async function seedHistory(agencyId: string, units: { id: string; rentCents: number }[], seed: number, opts: { residentEmail?: string } = {}) {
  faker.seed(seed);
  const now = Date.now();
  const occupied = units.slice(Math.floor(units.length * 0.3)); // the rest are the listings
  const residencies: { id: string; unitId: string; userId: string | null }[] = [];
  // The units now listed were vacated recently; that's where vacancy loss comes from.
  for (const u of units.slice(0, Math.floor(units.length * 0.3))) {
    const out = new Date(now - faker.number.int({ min: 4, max: 45 }) * 86_400_000);
    await db().residency.create({ data: { agencyId, unitId: u.id, moveIn: new Date(out.getTime() - faker.number.int({ min: 380, max: 1100 }) * 86_400_000), moveOut: out, status: "PAST", rentCents: u.rentCents - 10_000 } });
  }
  for (const [i, u] of occupied.entries()) {
    const leadId = uuidv7();
    const name = faker.person.fullName();
    const email = `resident.${i}.${seed}@example.com`;
    const f = fields({ agencyId, model: "Lead", id: leadId });
    await db().lead.create({ data: { id: leadId, agencyId, nameEnc: f.enc("nameEnc", name), emailEnc: f.enc("emailEnc", email), emailBidx: emailBidx(agencyId, email), source: "import" } });
    // Some units turned over in the last 18 months: a past residency, then the current one.
    const turned = i % 3 === 0;
    const currentStart = new Date(now - faker.number.int({ min: turned ? 30 : 400, max: turned ? 300 : 900 }) * 86_400_000);
    if (turned) {
      const pastEnd = new Date(currentStart.getTime() - faker.number.int({ min: 5, max: 40 }) * 86_400_000);
      await db().residency.create({ data: { agencyId, unitId: u.id, leadId, moveIn: new Date(pastEnd.getTime() - 700 * 86_400_000), moveOut: pastEnd, status: "PAST", rentCents: u.rentCents - 15_000 } });
    }
    let userId: string | null = null;
    if (i === 0 && opts.residentEmail) {
      const user = await db().user.upsert({ where: { email: opts.residentEmail }, create: { id: uuidv7(), email: opts.residentEmail, name: "Riley Resident", emailVerified: true }, update: {} });
      userId = user.id;
    }
    const r = await db().residency.create({
      // Month-to-month after the first year, so most current residencies have no end date.
      data: { agencyId, unitId: u.id, leadId, residentUserId: userId, moveIn: currentStart, moveOut: i % 11 === 5 ? new Date(now + 30 * 86_400_000) : null, status: i % 11 === 5 ? "NOTICE" : "CURRENT", rentCents: u.rentCents },
    });
    await db().unit.update({ where: { id: u.id }, data: { status: "LEASED" } });
    residencies.push({ id: r.id, unitId: u.id, userId });
  }
  return residencies;
}

const TICKETS: { title: string; description: string; flow: string[]; daysAgo: number }[] = [
  { title: "Gas smell in kitchen", description: "I smell gas near the stove, it started this morning.", flow: ["ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"], daysAgo: 20 },
  { title: "Kitchen sink leaking", description: "Slow drip under the sink, there's a puddle in the cabinet.", flow: ["ASSIGNED", "IN_PROGRESS", "RESOLVED"], daysAgo: 9 },
  { title: "Dishwasher won't drain", description: "Water sits at the bottom after every cycle.", flow: ["ASSIGNED"], daysAgo: 3 },
  { title: "Bedroom outlet dead", description: "The outlet by the window stopped working. Breaker looks fine.", flow: ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"], daysAgo: 6 },
  { title: "Ants in the pantry", description: "Small ants along the baseboard, minor but annoying.", flow: [], daysAgo: 1 },
  { title: "Bathroom fan noisy", description: "Rattles loudly, cosmetic mostly.", flow: ["ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"], daysAgo: 40 },
  { title: "Front door lock sticking", description: "The key is hard to turn, takes a few tries.", flow: ["ASSIGNED", "IN_PROGRESS"], daysAgo: 2 },
  { title: "Heater not working", description: "No heat since last night, apartment is cold.", flow: ["ASSIGNED", "IN_PROGRESS", "RESOLVED"], daysAgo: 12 },
  { title: "Toilet running", description: "Toilet runs constantly after flushing.", flow: [], daysAgo: 4 },
  { title: "Window latch broken", description: "Bedroom window latch snapped, window won't lock.", flow: ["ASSIGNED"], daysAgo: 5 },
  { title: "Grab bars in shower", description: "Could you install grab bars in the shower? It would help with my mobility.", flow: [], daysAgo: 2 },
  { title: "Water stain on ceiling", description: "Brown water stain spreading on the living room ceiling.", flow: ["ASSIGNED", "IN_PROGRESS", "ON_HOLD", "IN_PROGRESS", "RESOLVED"], daysAgo: 25 },
  { title: "Garbage disposal jammed", description: "Hums but doesn't spin.", flow: ["ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"], daysAgo: 30 },
];

export async function seedTickets(agencyId: string, residencies: { id: string; unitId: string; userId: string | null }[], staffId: string, count: number, offset = 0) {
  const tz = 60 * 60_000;
  for (let i = 0; i < count; i++) {
    const t = TICKETS[(i + offset) % TICKETS.length];
    const r = residencies[i % residencies.length];
    const created = new Date(Date.now() - t.daysAgo * 86_400_000 - i * tz);
    const month = created.getMonth() + 1;
    // "Heater not working" only counts as an emergency in the cold months; the rules check that.
    void month;
    const ticket = await createTicket(agencyId, { residencyId: r.id, unitId: r.unitId, reporterUserId: r.userId }, { title: t.title, description: t.description, permissionToEnter: i % 2 === 0 }, [], created);
    let clock = created.getTime();
    for (const [j, to] of t.flow.entries()) {
      // Two tickets are deliberately slow so the SLA board has breaches to show.
      const step = i === 3 || i === 9 ? 30 * 3_600_000 : (j + 1) * 45 * 60_000;
      clock = Math.min(Date.now() - 60_000, clock + step);
      if (to === "ASSIGNED") await db().maintenanceTicket.update({ where: { id: ticket.id }, data: { assigneeUserId: staffId } });
      await transitionTicket(agencyId, { type: "USER", id: staffId }, ticket.id, to as never, undefined, new Date(clock));
    }
  }
}
