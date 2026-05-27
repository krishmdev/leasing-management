import { notFound, redirect } from "next/navigation";
import { publicAgency } from "@/server/domain/agency";
import { getSession } from "@/server/session";
import { NewTicketForm } from "./NewTicketForm";

export const metadata = { title: "Request a repair" };

export default async function NewTicket({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const agency = await publicAgency(agencySlug);
  if (!agency) notFound();
  if (!(await getSession())) redirect(`/${agencySlug}/portal`);
  return (
    <div className="mx-auto max-w-2xl px-5 pt-12">
      <h1 className="display text-4xl font-semibold">Request a repair</h1>
      <p className="mt-2 text-ink-2">Tell us what&apos;s wrong. Emergencies are flagged automatically and go to someone right away.</p>
      <NewTicketForm slug={agencySlug} />
    </div>
  );
}
