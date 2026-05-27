import { notFound } from "next/navigation";
import { availableSlots, showingByToken } from "@/server/domain/showings/booking";
import { publicAgency } from "@/server/domain/agency";
import { dateLabel, timeLabel } from "@/lib/format";
import { requestTime } from "@/lib/time";
import { ManageShowing } from "./ManageShowing";

export const metadata = { title: "Your showing" };

export default async function ShowingPage({ params }: { params: Promise<{ agencySlug: string; token: string }> }) {
  const { agencySlug, token } = await params;
  const [agency, s] = await Promise.all([publicAgency(agencySlug), showingByToken(token)]);
  if (!agency || !s || s.agencyId !== agency.id) notFound();
  const slots = s.status === "SCHEDULED" ? await availableSlots(agency.id, 21, new Date(await requestTime())) : [];
  return (
    <div className="mx-auto max-w-2xl px-5 pt-12">
      <p className="text-sm font-medium uppercase tracking-widest text-brand">Showing</p>
      <h1 className="display mt-2 text-4xl font-semibold">{s.unit.property.name}, {s.unit.label}</h1>
      <p className="mt-2 text-lg text-ink-2">
        {s.status === "CANCELED" ? "Canceled. " : ""}
        {dateLabel(s.startsAt, agency.timezone, { weekday: "long", month: "long", day: "numeric" })} at {timeLabel(s.startsAt, agency.timezone)} · {s.unit.property.street}
      </p>
      {s.status === "SCHEDULED" ? (
        <ManageShowing token={token} slots={slots.map((x) => x.start.toISOString())} tz={agency.timezone} />
      ) : (
        <p className="mt-8 rounded-2xl bg-surface p-6 ring-1 ring-black/5">This showing is {s.status.toLowerCase().replace("_", " ")}. <a className="underline" href={`/${agencySlug}/listings/${s.unit.slug}/schedule`}>Book another time</a>.</p>
      )}
    </div>
  );
}
