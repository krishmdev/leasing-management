import { notFound } from "next/navigation";
import { publicAgency } from "@/server/domain/agency";
import { publicUnit } from "@/server/domain/listings/queries";
import { availableSlots } from "@/server/domain/showings/booking";
import { UnitAside } from "@/components/site/UnitAside";
import { ScheduleForm } from "@/components/site/PublicForms";
import { bookAction } from "../../../actions";
import { requestTime } from "@/lib/time";

export const metadata = { title: "Schedule a showing" };

export default async function Schedule({ params }: { params: Promise<{ agencySlug: string; unitSlug: string }> }) {
  const { agencySlug, unitSlug } = await params;
  const agency = await publicAgency(agencySlug);
  const unit = agency && (await publicUnit(agency.id, unitSlug));
  if (!agency || !unit) notFound();
  const slots = await availableSlots(agency.id, 21, new Date(await requestTime()));
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-5 pt-10 md:grid-cols-[1fr_340px]">
      <div>
        <h1 className="display text-4xl font-semibold">Schedule a showing</h1>
        <p className="mb-6 mt-2 text-ink-2">An agent meets you at the building. You&apos;ll get a calendar invite and a link to reschedule.</p>
        <ScheduleForm action={bookAction.bind(null, agencySlug, unitSlug)} slots={slots.map((s) => s.start.toISOString())} tz={agency.timezone} applyHref={`/${agencySlug}/apply?unit=${unitSlug}`} />
      </div>
      <UnitAside agencySlug={agencySlug} unit={unit} brand={agency.theme.brand} accent={agency.theme.accent} />
    </div>
  );
}
