import Link from "next/link";
import { BuildingArt } from "./BuildingArt";
import { bathsLabel, bedsLabel, dayLabel, usd } from "@/lib/format";

export interface UnitCardData {
  slug: string;
  label: string;
  beds: number;
  baths: number;
  sqft: number;
  rentCents: number;
  availableOn: Date;
  status: string;
  photoSeed: number;
  property: { name: string; neighborhood: string | null; city: string };
}

export function UnitCard({ unit, agencySlug, brand, accent, now }: { unit: UnitCardData; agencySlug: string; brand: string; accent: string; now: number }) {
  const soon = unit.availableOn.getTime() <= now + 14 * 86_400_000;
  return (
    <Link
      href={`/${agencySlug}/listings/${unit.slug}`}
      className="group block overflow-hidden rounded-2xl border border-black/5 bg-surface shadow-[0_1px_0_rgba(0,0,0,0.03)] transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        <BuildingArt seed={unit.photoSeed} brand={brand} accent={accent} className="size-full transition duration-500 group-hover:scale-[1.03]" label={`Illustration of ${unit.property.name}`} />
        <span className="absolute left-3 top-3 rounded-full bg-surface/90 px-2.5 py-1 text-xs font-medium backdrop-blur">
          {unit.status === "PENDING" ? "Application pending" : soon ? "Available now" : `From ${dayLabel(unit.availableOn)}`}
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="display text-2xl font-semibold tabular">{usd(unit.rentCents)}<span className="text-sm font-normal text-muted">/mo</span></p>
          <p className="text-sm text-muted">{unit.label}</p>
        </div>
        <p className="mt-1 text-sm text-ink-2">
          {bedsLabel(unit.beds)} · {bathsLabel(unit.baths)} · {unit.sqft.toLocaleString()} sq ft
        </p>
        <p className="mt-2 text-sm font-medium">{unit.property.name}</p>
        <p className="text-xs text-muted">{unit.property.neighborhood ?? unit.property.city}</p>
      </div>
    </Link>
  );
}
