import Link from "next/link";
import { notFound } from "next/navigation";
import { publicAgency } from "@/server/domain/agency";
import { publicUnit } from "@/server/domain/listings/queries";
import { BuildingArt } from "@/components/site/BuildingArt";
import { bathsLabel, bedsLabel, dayLabel, usd } from "@/lib/format";

type P = { params: Promise<{ agencySlug: string; unitSlug: string }> };

export async function generateMetadata({ params }: P) {
  const { agencySlug, unitSlug } = await params;
  const agency = await publicAgency(agencySlug);
  const unit = agency && (await publicUnit(agency.id, unitSlug));
  return unit ? { title: `${unit.property.name} ${unit.label}` } : {};
}

export default async function UnitPage({ params }: P) {
  const { agencySlug, unitSlug } = await params;
  const agency = await publicAgency(agencySlug);
  if (!agency) notFound();
  const unit = await publicUnit(agency.id, unitSlug);
  if (!unit) notFound();
  const t = agency.theme;
  const base = `/${agency.slug}/listings/${unit.slug}`;
  const leased = unit.status === "LEASED";

  return (
    <div className="mx-auto max-w-6xl px-5 pt-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href={`/${agency.slug}/listings`} className="hover:text-ink">Available homes</Link> <span aria-hidden>/</span> {unit.property.name}
      </nav>
      <div className="mt-4 grid gap-3 md:grid-cols-4 md:grid-rows-2">
        <div className="overflow-hidden rounded-3xl md:col-span-2 md:row-span-2">
          <BuildingArt seed={unit.photoSeed} brand={t.brand} accent={t.accent} variant="tall" className="aspect-[4/3] size-full md:aspect-auto" label={`Illustration of ${unit.property.name}`} />
        </div>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="hidden overflow-hidden rounded-2xl md:block">
            <BuildingArt seed={unit.photoSeed * 7 + i} brand={t.brand} accent={t.accent} className="aspect-[4/3] size-full" label="" />
          </div>
        ))}
      </div>

      <div className="mt-10 grid gap-10 md:grid-cols-[1fr_360px]">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-brand">{unit.property.neighborhood} · {unit.property.city}</p>
          <h1 className="display mt-2 text-4xl font-semibold">{unit.property.name}, {unit.label}</h1>
          <p className="mt-1 text-ink-2">{unit.property.street}, {unit.property.city}, CA {unit.property.zip}</p>
          <dl className="mt-6 grid grid-cols-2 gap-4 rounded-2xl bg-surface p-5 ring-1 ring-black/5 sm:grid-cols-4">
            {[
              ["Bedrooms", bedsLabel(unit.beds)],
              ["Bathrooms", bathsLabel(unit.baths)],
              ["Size", `${unit.sqft.toLocaleString()} sq ft`],
              ["Built", unit.property.yearBuilt ?? "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="display mt-0.5 text-xl font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <h2 className="display mt-10 text-2xl font-semibold">About this home</h2>
          <p className="mt-3 max-w-prose leading-relaxed text-ink-2">{unit.description}</p>
          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            <div>
              <h3 className="font-semibold">In the unit</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
                {unit.features.map((f) => <li key={f}>— {f}</li>)}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold">In the building</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
                {unit.property.amenities.map((f) => <li key={f}>— {f}</li>)}
              </ul>
            </div>
          </div>
          <h3 className="mt-8 font-semibold">Pets</h3>
          <p className="mt-1 text-sm text-ink-2">{unit.petPolicy}</p>
        </div>

        <aside className="md:sticky md:top-24 md:self-start">
          <div className="rounded-3xl bg-surface p-6 shadow-xl ring-1 ring-black/5">
            <p className="display text-4xl font-semibold tabular">{usd(unit.rentCents)}<span className="text-base font-normal text-muted"> / month</span></p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Security deposit</dt><dd>{usd(unit.depositCents)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Available</dt><dd>{dayLabel(unit.availableOn, { month: "long", day: "numeric", year: "numeric" })}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Lease</dt><dd>12 months</dd></div>
            </dl>
            {leased ? (
              <p className="mt-6 rounded-xl bg-paper p-4 text-sm">This home has been leased. <Link className="underline" href={`/${agency.slug}/listings`}>See what&apos;s available</Link>.</p>
            ) : (
              <div className="mt-6 space-y-2">
                <Link href={`${base}/schedule`} className="flex h-12 items-center justify-center rounded-xl bg-brand font-semibold text-brand-ink hover:opacity-90">
                  Schedule a showing
                </Link>
                <Link href={`${base}/interest`} className="flex h-12 items-center justify-center rounded-xl font-semibold ring-1 ring-black/15 hover:bg-paper">
                  I&apos;m interested
                </Link>
              </div>
            )}
            <p className="mt-4 text-xs text-muted">
              No application fee to tour. Applying takes about fifteen minutes; you&apos;ll get a link after you send interest or book a showing.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
