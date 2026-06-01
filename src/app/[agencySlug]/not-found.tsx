import Link from "next/link";
import { headers } from "next/headers";
import { publicAgency } from "@/server/domain/agency";

// Rendered inside the agency's own layout, so it keeps the agency's look.
export default async function AgencyNotFound() {
  const path = (await headers()).get("x-pathname") ?? "";
  const slug = path.split("/")[1] ?? "";
  const agency = slug ? await publicAgency(slug) : null;
  const section = path.split("/")[2] ?? "";
  // Only emailed links expire; anything else is simply not there.
  const copy =
    section === "showings" || section === "lease"
      ? {
          title: "This link has expired or was already used",
          body: "Links in our emails for showings and leases work for a limited time. If you still need something, get in touch and we'll send a new one.",
        }
      : section === "listings" || section === "units"
        ? { title: "We couldn't find that home", body: "It may have been rented or taken off the market. The homes available now are on our listings page." }
        : { title: "We couldn't find that page", body: "The address may be mistyped, or the page may have moved." };
  return (
    <div className="mx-auto max-w-xl px-5 py-20 text-center">
      <h1 className="display text-4xl font-semibold">{copy.title}</h1>
      <p className="mt-3 text-ink-2">{copy.body}</p>
      {agency && (
        <p className="mt-2 text-sm text-ink-2">
          {agency.name} · {agency.contact.phone} · {agency.contact.email}
        </p>
      )}
      <Link href={agency ? `/${agency.slug}/listings` : "/"} className="mt-8 inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-semibold text-brand-ink">
        See available homes
      </Link>
    </div>
  );
}
