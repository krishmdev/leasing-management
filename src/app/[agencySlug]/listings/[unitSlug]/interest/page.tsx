import { notFound } from "next/navigation";
import { publicAgency } from "@/server/domain/agency";
import { publicUnit } from "@/server/domain/listings/queries";
import { UnitAside } from "@/components/site/UnitAside";
import { InterestForm } from "@/components/site/PublicForms";
import { interestAction } from "../../../actions";
import { requestTime } from "@/lib/time";

export const metadata = { title: "I'm interested" };

export default async function Interest({ params }: { params: Promise<{ agencySlug: string; unitSlug: string }> }) {
  const { agencySlug, unitSlug } = await params;
  const agency = await publicAgency(agencySlug);
  const unit = agency && (await publicUnit(agency.id, unitSlug));
  if (!agency || !unit) notFound();
  const today = new Date(await requestTime()).toISOString().slice(0, 10);
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-5 pt-10 md:grid-cols-[1fr_340px]">
      <div>
        <h1 className="display text-4xl font-semibold">Tell us you&apos;re interested</h1>
        <p className="mb-6 mt-2 text-ink-2">No account needed. A leasing agent follows up within a business day.</p>
        <InterestForm action={interestAction.bind(null, agencySlug, unitSlug)} minDate={today} applyHref={`/${agencySlug}/apply?unit=${unitSlug}`} />
      </div>
      <UnitAside agencySlug={agencySlug} unit={unit} brand={agency.theme.brand} accent={agency.theme.accent} />
    </div>
  );
}
