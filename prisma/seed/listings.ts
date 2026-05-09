import { faker } from "@faker-js/faker";
import { createProperty, createUnit, unitSlug } from "@/server/domain/listings/service";

const PROPERTIES: Record<string, { name: string; street: string; city: string; zip: string; neighborhood: string; yearBuilt: number; amenities: string[]; description: string }[]> = {
  bayview: [
    {
      name: "The Alder", street: "4701 Telegraph Ave", city: "Oakland", zip: "94609", neighborhood: "Temescal", yearBuilt: 1928,
      amenities: ["Bike room", "Shared laundry", "Courtyard", "Package lockers"],
      description: "A restored 1928 brick building a block from the Temescal farmers market, with a planted courtyard and original hardwood floors.",
    },
    {
      name: "Lakeshore Commons", street: "3300 Lakeshore Ave", city: "Oakland", zip: "94610", neighborhood: "Grand Lake", yearBuilt: 1964,
      amenities: ["Elevator", "In-unit laundry", "Covered parking", "Roof deck"],
      description: "Mid-century building across from Lake Merritt. Most units have lake-facing balconies.",
    },
    {
      name: "Rockridge Court", street: "5800 College Ave", city: "Oakland", zip: "94618", neighborhood: "Rockridge", yearBuilt: 1998,
      amenities: ["Gated entry", "EV charging", "Storage units", "Near BART"],
      description: "Townhome-style court four minutes on foot from Rockridge BART.",
    },
  ],
  peninsula: [
    {
      name: "Hillsdale Terrace", street: "180 W 31st Ave", city: "San Mateo", zip: "94403", neighborhood: "Hillsdale", yearBuilt: 1972,
      amenities: ["Pool", "Assigned parking", "Shared laundry", "Garden"],
      description: "Garden apartments set around a heated pool, near Hillsdale Caltrain.",
    },
    {
      name: "Baywood Gardens", street: "610 Baywood Ave", city: "San Mateo", zip: "94402", neighborhood: "Baywood", yearBuilt: 1956,
      amenities: ["Private patios", "Garage parking", "In-unit laundry"],
      description: "Quiet, tree-lined fourplexes a short walk from Central Park and downtown San Mateo.",
    },
    {
      name: "Burlingame Row", street: "1400 Floribunda Ave", city: "Burlingame", zip: "94010", neighborhood: "Downtown Burlingame", yearBuilt: 2012,
      amenities: ["Elevator", "Fitness room", "EV charging", "Bike storage", "Package room"],
      description: "Newer building two blocks from Burlingame Avenue shops and the Caltrain station.",
    },
  ],
};

const FEATURES = ["Hardwood floors", "Dishwasher", "Gas range", "Walk-in closet", "Bay window", "Balcony", "Updated bath", "Ceiling fans", "Quartz counters", "Pantry", "Built-in shelving", "Skylight"];

export async function seedListings(agencyId: string, slug: string, agentIds: string[]) {
  faker.seed(slug === "bayview" ? 42 : 4242);
  const units: { id: string; slug: string; rentCents: number; propertyName: string }[] = [];
  let seed = slug === "bayview" ? 1 : 101;
  for (const p of PROPERTIES[slug]) {
    const prop = await createProperty(agencyId, null, p);
    const count = faker.number.int({ min: 8, max: 12 });
    for (let i = 0; i < count; i++) {
      const floor = 1 + Math.floor(i / 4);
      const label = `${floor}${String.fromCharCode(65 + (i % 4))}`;
      const beds = faker.helpers.weightedArrayElement([
        { value: 0, weight: 1 }, { value: 1, weight: 4 }, { value: 2, weight: 4 }, { value: 3, weight: 1 },
      ]);
      const sqft = [480, 690, 940, 1250][beds] + faker.number.int({ min: -40, max: 120 });
      const base = [2400, 2750, 3450, 4400][beds] + (slug === "peninsula" ? 200 : 0);
      const rent = Math.min(4800, Math.round((base + faker.number.int({ min: -100, max: 350 })) / 25) * 25);
      const avail = faker.date.between({ from: "2026-06-01", to: "2026-12-15" });
      const unit = await createUnit(agencyId, null, {
        propertyId: prop.id,
        label: `Unit ${label}`,
        slug: unitSlug(p.name, label),
        beds,
        baths: beds >= 2 ? faker.helpers.arrayElement([1, 1.5, 2]) : 1,
        sqft,
        rentCents: rent * 100,
        depositCents: rent * 100,
        availableOn: new Date(avail.toISOString().slice(0, 10)),
        description: `${beds === 0 ? "Studio" : `${beds}-bedroom`} on the ${floor === 1 ? "ground" : ordinal(floor)} floor of ${p.name}. ${faker.helpers.arrayElement([
          "Morning light in the living room and a kitchen that was redone in 2023.",
          "Faces the courtyard, so it stays quiet even on weekends.",
          "Corner unit with windows on two sides.",
          "Freshly painted, with new appliances.",
        ])} Water and trash included; tenant pays PG&E.`,
        features: faker.helpers.arrayElements(FEATURES, { min: 3, max: 5 }),
        listingAgentId: agentIds[i % agentIds.length],
        photoSeed: seed++,
      });
      units.push({ id: unit.id, slug: unit.slug, rentCents: unit.rentCents, propertyName: p.name });
    }
  }
  return units;
}

function ordinal(n: number) {
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`;
}
