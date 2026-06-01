import Link from "next/link";
import { notFound } from "next/navigation";
import { requestTime } from "@/lib/time";
import { publicAgency } from "@/server/domain/agency";
import { listPublicUnits, publicProperties } from "@/server/domain/listings/queries";
import { UnitCard } from "@/components/site/UnitCard";
import { BuildingArt, seedOf } from "@/components/site/BuildingArt";
import { SearchBar } from "@/components/site/SearchBar";
import { usd } from "@/lib/format";

export default async function AgencyHome({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const agency = await publicAgency(agencySlug);
  if (!agency) notFound();
  const [units, properties] = await Promise.all([listPublicUnits(agency.id, { sort: "available" }), publicProperties(agency.id)]);
  const minRent = units.length ? Math.min(...units.map((u) => u.rentCents)) : 0;
  const t = agency.theme;
  const now = await requestTime();

  return (
    <>
      <section className="grain overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-12 md:grid-cols-[1.1fr_1fr] md:pt-20">
          <div>
            <p className="rise text-sm font-medium uppercase tracking-[0.18em] text-brand">{t.tagline}</p>
            <h1 className="rise rise-1 display mt-4 text-5xl font-semibold leading-[1.02] md:text-6xl">{t.heroLine}</h1>
            <p className="rise rise-2 mt-5 max-w-lg text-lg text-ink-2">
              {units.length} homes available now{minRent ? `, from ${usd(minRent)} a month` : ""}. Book a showing online, apply in about fifteen
              minutes, and hear back within two business days.
            </p>
            <div className="rise rise-3 mt-8">
              <SearchBar agencySlug={agency.slug} />
            </div>
          </div>
          <div className="rise rise-2 relative hidden md:block">
            <div className="absolute -right-10 -top-6 size-72 rounded-full bg-accent/20 blur-3xl" aria-hidden />
            <div className="relative grid h-[520px] grid-cols-5 grid-rows-6 gap-3">
              <div className="col-span-3 row-span-6 overflow-hidden rounded-[28px] shadow-xl">
                <BuildingArt seed={seedOf(properties[0]?.id ?? agency.slug)} brand={t.brand} accent={t.accent} variant="tall" className="size-full" label="Illustration of one of our buildings" />
              </div>
              <div className="col-span-2 row-span-3 overflow-hidden rounded-[22px] shadow-lg">
                <BuildingArt seed={seedOf(properties[1]?.id ?? `${agency.slug}-2`)} brand={t.brand} accent={t.accent} className="size-full" label="" />
              </div>
              <div className="col-span-2 row-span-3 grid place-items-center rounded-[22px] bg-brand p-4 text-center text-brand-ink">
                <div>
                  <p className="display text-4xl font-semibold">{properties.length}</p>
                  <p className="text-sm opacity-80">buildings we manage and maintain ourselves</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5" aria-labelledby="featured">
        <div className="mb-6 flex items-end justify-between">
          <h2 id="featured" className="display text-3xl font-semibold">Available homes</h2>
          <Link href={`/${agency.slug}/listings`} className="text-sm font-medium text-brand underline-offset-4 hover:underline">
            See all {units.length} homes →
          </Link>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {units.slice(0, 6).map((u) => (
            <UnitCard key={u.id} unit={u} agencySlug={agency.slug} brand={t.brand} accent={t.accent} now={now} />
          ))}
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-6xl px-5" aria-labelledby="buildings">
        <h2 id="buildings" className="display text-3xl font-semibold">Our buildings</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {properties.map((p, i) => (
            <article key={p.id} className="overflow-hidden rounded-2xl bg-surface ring-1 ring-black/5">
              <BuildingArt seed={seedOf(p.id)} brand={t.brand} accent={t.accent} className="aspect-[16/10] w-full" label={`Illustration of ${p.name}`} />
              <div className="p-5">
                <p className="text-xs font-medium uppercase tracking-widest text-muted">{p.neighborhood}</p>
                <h3 className="display mt-1 text-xl font-semibold">{p.name}</h3>
                <p className="mt-2 text-sm text-ink-2">{p.description}</p>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {p.amenities.map((a) => (
                    <li key={a} className="rounded-full bg-paper px-2.5 py-1 text-xs text-ink-2">{a}</li>
                  ))}
                </ul>
                <Link href={`/${agency.slug}/listings?property=${p.id}`} className="mt-4 inline-block text-sm font-medium text-brand">
                  {p._count.units} available →
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-6xl px-5" aria-labelledby="process">
        <div className="rounded-3xl bg-brand px-6 py-10 text-brand-ink md:px-12">
          <h2 id="process" className="display text-3xl font-semibold">From first look to keys</h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-4">
            {[
              ["Tell us you're interested", "Pick a home and send a short note. No account needed."],
              ["Tour it", "Choose a showing time that works. You'll get a calendar invite."],
              ["Apply online", "About fifteen minutes. The screening company collects your SSN on its own secure page; we never see it."],
              ["Sign and move in", "Approved applicants get a 72-hour hold and an e-signable lease."],
            ].map(([h, b], i) => (
              <li key={h}>
                <p className="display text-4xl font-semibold opacity-60">0{i + 1}</p>
                <p className="mt-2 font-semibold">{h}</p>
                <p className="mt-1 text-sm opacity-80">{b}</p>
              </li>
            ))}
          </ol>
          <Link href={`/${agency.slug}/how-to-apply`} className="mt-8 inline-block rounded-full bg-brand-ink px-5 py-2.5 text-sm font-medium text-brand">
            Read our screening criteria
          </Link>
        </div>
      </section>
    </>
  );
}
