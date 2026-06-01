import { notFound } from "next/navigation";
import { publicAgency } from "@/server/domain/agency";

export const metadata = { title: "How we handle your information" };

export default async function Privacy({ params }: { params: Promise<{ agencySlug: string }> }) {
  const agency = await publicAgency((await params).agencySlug);
  if (!agency) notFound();
  return (
    <div className="mx-auto max-w-3xl px-5 pt-12">
      <h1 className="display text-4xl font-semibold">How we handle your information</h1>
      <div className="mt-6 space-y-4 leading-relaxed text-ink-2">
        <p>
          <strong className="text-ink">What we never collect.</strong> Your Social Security number and date of birth go to the screening company on its own secure page. {agency.name} never receives either.
        </p>
        <p>
          <strong className="text-ink">What we keep, and how.</strong> Your name, phone, past addresses, landlord contacts and reference comments are encrypted in our database. Staff see a shortened name by default; seeing the full details needs a stated reason and is logged.
        </p>
        <p>
          <strong className="text-ink">What the screening company sends us.</strong> A summary: a credit band, counts of evictions and collections, and whether your identity and income were verified. The score and its factors are kept encrypted, only so we can tell you about them if we decline or condition your application, and deleted after 120 days.
        </p>
        <p>
          <strong className="text-ink">If you&apos;re not approved or you withdraw.</strong> Your personal details, reference text and documents are deleted after two years. We keep the decision and its reasons as a record.
        </p>
        <p className="text-sm">Questions: {agency.contact.email} or {agency.contact.phone}.</p>
      </div>
    </div>
  );
}
