import Link from "next/link";
import { Menu } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { PublicAgency } from "@/server/domain/agency";

const FONTS = {
  fraunces: { display: '"Fraunces Variable", Georgia, serif', body: '"Figtree Variable", ui-sans-serif, system-ui, sans-serif' },
  bricolage: { display: '"Bricolage Grotesque Variable", ui-sans-serif, sans-serif', body: '"Public Sans Variable", ui-sans-serif, system-ui, sans-serif' },
} as const;

export function agencyStyle(a: PublicAgency): CSSProperties {
  const f = FONTS[a.theme.font];
  return {
    "--brand": a.theme.brand,
    "--brand-ink": a.theme.brandInk,
    "--accent": a.theme.accent,
    "--paper": a.theme.paper,
    "--ink": a.theme.ink,
    "--focus": a.theme.brand,
    "--font-display": f.display,
    "--font-body": f.body,
  } as CSSProperties;
}

export function AgencyShell({ agency, children }: { agency: PublicAgency; children: ReactNode }) {
  const base = `/${agency.slug}`;
  return (
    <div style={agencyStyle(agency)} className="flex min-h-dvh flex-col bg-paper font-sans text-ink" data-agency={agency.slug}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-black/5 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <Link href={base} className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-brand font-display text-sm font-semibold text-brand-ink">
              {agency.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </span>
            <span className="display truncate text-lg font-semibold">{agency.name}</span>
          </Link>
          <nav aria-label="Main" className="flex shrink-0 items-center gap-1 text-sm">
            <Link className="hidden rounded-full px-3 py-1.5 hover:bg-black/5 sm:block" href={`${base}/listings`}>Available homes</Link>
            <Link className="hidden rounded-full px-3 py-1.5 hover:bg-black/5 sm:block" href={`${base}/how-to-apply`}>How to apply</Link>
            <Link className="hidden rounded-full px-3 py-1.5 hover:bg-black/5 md:block" href={`${base}/portal`}>Residents</Link>
            <Link className="whitespace-nowrap rounded-full bg-brand px-4 py-2 font-medium text-brand-ink hover:opacity-90" href={`${base}/listings`}>
              Find a home
            </Link>
            <details className="relative sm:hidden">
              <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-full hover:bg-black/5" aria-label="Menu">
                <Menu aria-hidden className="size-5" />
              </summary>
              <div className="absolute right-0 mt-2 w-52 rounded-2xl bg-surface p-2 shadow-xl ring-1 ring-black/10">
                {[["Available homes", `${base}/listings`], ["How to apply", `${base}/how-to-apply`], ["Resident portal", `${base}/portal`]].map(([l, h]) => (
                  <Link key={h} href={h} className="flex min-h-11 items-center rounded-xl px-3 hover:bg-paper">{l}</Link>
                ))}
              </div>
            </details>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <footer className="mt-20 border-t border-black/10 bg-ink text-white/80">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 text-sm md:grid-cols-4">
          <div className="md:col-span-2">
            <p className="display text-xl text-white">{agency.name}</p>
            <p className="mt-2 max-w-md text-white/60">{agency.theme.about}</p>
          </div>
          <div>
            <p className="font-semibold text-white">Office</p>
            <p className="mt-2">{agency.contact.office}</p>
            <p>{agency.contact.hours}</p>
          </div>
          <div>
            <p className="font-semibold text-white">Contact</p>
            <p className="mt-2">{agency.contact.phone}</p>
            <p>{agency.contact.email}</p>
            <Link href={`${base}/portal`} className="mt-2 inline-block underline underline-offset-4">Resident portal</Link>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-5 text-xs text-white/50">
            <p>
              <span aria-hidden>⌂ </span>Equal Housing Opportunity. We don&apos;t discriminate on the basis of race, color, religion, sex, gender identity,
              sexual orientation, national origin, familial status, disability, source of income, or any other protected class.
            </p>
            <p>{agency.contact.license}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
