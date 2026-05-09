import Link from "next/link";
import { notFound } from "next/navigation";
import { requestTime } from "@/lib/time";
import { publicAgency } from "@/server/domain/agency";
import { ListingFilter, listPublicUnits, publicProperties } from "@/server/domain/listings/queries";
import { UnitCard } from "@/components/site/UnitCard";
import { SearchBar } from "@/components/site/SearchBar";

export const metadata = { title: "Available homes" };

export default async function Listings({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ agencySlug }, sp] = await Promise.all([params, searchParams]);
  const agency = await publicAgency(agencySlug);
  if (!agency) notFound();
  const parsed = ListingFilter.safeParse(Object.fromEntries(Object.entries(sp).filter(([, v]) => v !== "" && v !== undefined)));
  const filter = parsed.success ? parsed.data : ListingFilter.parse({});
  const [units, properties] = await Promise.all([listPublicUnits(agency.id, filter), publicProperties(agency.id)]);
  const now = await requestTime();
  const qs = (patch: Record<string, string | undefined>) => {
    const merged = { ...sp, ...patch };
    const s = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]).toString();
    return `/${agency.slug}/listings${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-6xl px-5 pt-10">
      <h1 className="display text-4xl font-semibold">Available homes</h1>
      <p className="mt-2 text-ink-2">
        {units.length} {units.length === 1 ? "home matches" : "homes match"} your search.
      </p>
      <div className="mt-6">
        <SearchBar agencySlug={agency.slug} beds={filter.beds} maxRent={filter.maxRent} />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 text-sm" aria-label="Filter by building">
        <Link href={qs({ property: undefined })} className={`rounded-full px-3 py-1.5 ring-1 ring-black/10 ${!filter.property ? "bg-ink text-white" : "bg-surface"}`}>
          All buildings
        </Link>
        {properties.map((p) => (
          <Link key={p.id} href={qs({ property: p.id })} className={`rounded-full px-3 py-1.5 ring-1 ring-black/10 ${filter.property === p.id ? "bg-ink text-white" : "bg-surface"}`}>
            {p.name}
          </Link>
        ))}
        <span className="ml-auto flex items-center gap-2 text-muted">
          Sort
          {(["available", "rent-asc", "rent-desc"] as const).map((s) => (
            <Link key={s} href={qs({ sort: s })} className={filter.sort === s ? "font-semibold text-ink underline underline-offset-4" : "hover:text-ink"}>
              {{ available: "Soonest", "rent-asc": "Price ↑", "rent-desc": "Price ↓" }[s]}
            </Link>
          ))}
        </span>
      </div>
      {units.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-black/15 p-12 text-center">
          <p className="display text-2xl font-semibold">Nothing matches that yet</p>
          <p className="mt-2 text-ink-2">Try a higher max rent or fewer bedrooms. New homes are listed every week.</p>
          <Link href={`/${agency.slug}/listings`} className="mt-5 inline-block rounded-full bg-brand px-5 py-2 text-sm font-medium text-brand-ink">
            Clear filters
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {units.map((u) => (
            <UnitCard key={u.id} unit={u} agencySlug={agency.slug} brand={agency.theme.brand} accent={agency.theme.accent} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
