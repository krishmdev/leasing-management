import Link from "next/link";
import { db } from "@/server/db";
import { ThemeSchema } from "@/server/domain/agency";
import { BuildingArt } from "@/components/site/BuildingArt";

export const dynamic = "force-dynamic";

export default async function Home() {
  const orgs = await db().organization.findMany({ include: { settings: true }, orderBy: { name: "asc" } });
  return (
    <main className="min-h-dvh bg-paper">
      <div className="mx-auto max-w-5xl px-5 py-16">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Leasing Desk · demo</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
          Listing sites, showings, applications, screening and maintenance for small leasing agencies.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-2">
          Each agency gets its own site. Behind it, an agent screens applications against written criteria, drafts the paperwork, and does as much or as
          little as the agency allows. The platform never sees an applicant&apos;s SSN or date of birth.
        </p>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {orgs.map((o, i) => {
            const theme = o.settings ? ThemeSchema.parse(o.settings.theme) : null;
            const level = (o.settings?.automation as { level?: string } | null)?.level?.toLowerCase();
            return (
              <Link key={o.id} href={`/${o.slug}`} className="group overflow-hidden rounded-xl border border-line bg-surface transition hover:shadow-lg">
                {theme && <BuildingArt seed={5 + i * 9} brand={theme.brand} accent={theme.accent} className="aspect-[16/7] w-full" label="" />}
                <div className="p-5">
                  <p className="text-lg font-semibold">{o.name}</p>
                  <p className="text-sm text-muted">{theme?.tagline}</p>
                  <p className="mt-3 text-xs text-ink-2">Automation: <span className="font-mono">{level}</span> · public site → /{o.slug}</p>
                </div>
              </Link>
            );
          })}
        </div>
        <div className="mt-8 flex flex-wrap gap-3 text-sm">
          <Link href="/login" className="rounded-md bg-ink px-4 py-2 font-medium text-white">Staff sign-in</Link>
          <a href={process.env.MAILPIT_URL ?? "http://localhost:8041"} className="rounded-md border border-line-strong px-4 py-2">Mailpit (dev email)</a>
        </div>
      </div>
    </main>
  );
}
