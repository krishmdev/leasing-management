import Link from "next/link";
import { BuildingArt, seedOf } from "./BuildingArt";
import { bathsLabel, bedsLabel, usd } from "@/lib/format";

export function UnitAside({ agencySlug, unit, brand, accent }: { agencySlug: string; unit: { slug: string; label: string; beds: number; baths: number; sqft: number; rentCents: number; photoSeed: number; property: { id: string; name: string; street: string; city: string } }; brand: string; accent: string }) {
  return (
    <aside className="overflow-hidden rounded-3xl bg-surface ring-1 ring-black/5 md:sticky md:top-24 md:self-start">
      <BuildingArt seed={seedOf(unit.property.id)} brand={brand} accent={accent} className="aspect-[4/3] w-full" label={`Illustration of ${unit.property.name}`} />
      <div className="p-5">
        <p className="display text-2xl font-semibold">{unit.property.name}, {unit.label}</p>
        <p className="text-sm text-ink-2">{unit.property.street}, {unit.property.city}</p>
        <p className="mt-3 text-sm">{bedsLabel(unit.beds)} · {bathsLabel(unit.baths)} · {unit.sqft.toLocaleString()} sq ft · <span className="font-semibold">{usd(unit.rentCents)}/mo</span></p>
        <Link href={`/${agencySlug}/listings/${unit.slug}`} className="mt-3 inline-block text-sm text-brand underline-offset-4 hover:underline">← Back to the listing</Link>
      </div>
    </aside>
  );
}
