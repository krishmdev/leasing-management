import { faker } from "@faker-js/faker";
import { db } from "@/server/db";
import { submitInterest } from "@/server/domain/leads/service";
import { availableSlots, bookShowing, markShowing } from "@/server/domain/showings/booking";

type U = { id: string; slug: string };

export async function seedAvailability(agencyId: string, agentIds: string[], weekdays: number[]) {
  await db().availabilityRule.createMany({
    data: agentIds.flatMap((a, i) => weekdays.map((weekday) => ({ agencyId, agentUserId: a, weekday, startMin: 10 * 60 + i * 60, endMin: 17 * 60, slotMin: 30, bufferMin: 15 }))),
  });
}

/** Interest from 20 prospects per agency, and a handful of past and upcoming showings. */
export async function seedFunnel(agencyId: string, units: U[], ownerId: string, seed: number) {
  faker.seed(seed);
  for (let i = 0; i < 20; i++) {
    const u = units[i % units.length];
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    await submitInterest(agencyId, u.id, {
      name: `${first} ${last}`,
      email: `${first}.${last}.${i}@example.com`.toLowerCase().replace(/[^a-z0-9.@]/g, ""),
      desiredMoveIn: faker.date.soon({ days: 60, refDate: new Date() }).toISOString().slice(0, 10),
      message: i % 3 === 0 ? "Is parking included?" : "",
    });
  }
  // Past showings: book them as if it were ten days ago, then record what happened.
  const past = new Date(Date.now() - 10 * 86_400_000);
  const pastSlots = (await availableSlots(agencyId, 8, past)).filter((s) => s.start.getTime() < Date.now() - 86_400_000);
  const outcomes: ("COMPLETED" | "NO_SHOW")[] = ["COMPLETED", "COMPLETED", "NO_SHOW", "COMPLETED", "COMPLETED"];
  for (let i = 0; i < outcomes.length && i * 5 < pastSlots.length; i++) {
    const n = faker.person.firstName();
    const { showing } = await bookShowing(agencyId, units[(i + 3) % units.length].id, { name: `${n} ${faker.person.lastName()}`, email: `${n.toLowerCase()}.tour${i}@example.com`, start: pastSlots[i * 5].start }, past);
    await markShowing(agencyId, ownerId, showing.id, outcomes[i]);
  }
  const future = await availableSlots(agencyId, 10);
  for (let i = 0; i < 3 && i * 7 < future.length; i++) {
    const n = faker.person.firstName();
    await bookShowing(agencyId, units[(i + 8) % units.length].id, { name: `${n} ${faker.person.lastName()}`, email: `${n.toLowerCase()}.upcoming${i}@example.com`, start: future[i * 7].start });
  }
}
