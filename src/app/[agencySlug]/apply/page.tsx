import { notFound } from "next/navigation";
import { publicAgency } from "@/server/domain/agency";
import { publicUnit } from "@/server/domain/listings/queries";
import { getSession } from "@/server/session";
import { UnitAside } from "@/components/site/UnitAside";
import { ApplyStart } from "./ApplyStart";
import { beginApplication } from "../actions";

export const metadata = { title: "Apply" };

export default async function Apply({ params, searchParams }: { params: Promise<{ agencySlug: string }>; searchParams: Promise<{ unit?: string }> }) {
  const [{ agencySlug }, { unit: unitSlug }] = await Promise.all([params, searchParams]);
  const agency = await publicAgency(agencySlug);
  const unit = agency && unitSlug ? await publicUnit(agency.id, unitSlug) : null;
  if (!agency || !unit) notFound();
  const session = await getSession();
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-5 pt-10 md:grid-cols-[1fr_340px]">
      <div>
        <h1 className="display text-4xl font-semibold">Apply for this home</h1>
        <ol className="mt-4 space-y-1 text-ink-2">
          <li>1. About you, where you&apos;ve lived, and your income: about ten minutes. Answers save as you go.</li>
          <li>2. The screening company emails you to verify identity on its own site. That&apos;s where your SSN goes, not to us.</li>
          <li>3. We ask your past landlords for a short reference.</li>
        </ol>
        <div className="mt-8 rounded-3xl bg-surface p-6 ring-1 ring-black/5 md:p-8">
          {session ? (
            <form action={beginApplication.bind(null, agencySlug, unit.slug)} className="space-y-3">
              <p>Signed in as <span className="font-semibold">{session.user.email}</span>.</p>
              <button className="h-12 w-full rounded-xl bg-brand font-semibold text-brand-ink">Start or continue my application</button>
            </form>
          ) : (
            <ApplyStart slug={agencySlug} unitSlug={unit.slug} />
          )}
        </div>
      </div>
      <UnitAside agencySlug={agencySlug} unit={unit} brand={agency.theme.brand} accent={agency.theme.accent} />
    </div>
  );
}
