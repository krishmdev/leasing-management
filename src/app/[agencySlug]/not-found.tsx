import Link from "next/link";
import { headers } from "next/headers";
import { publicAgency } from "@/server/domain/agency";

// Rendered inside the agency's own layout, so it keeps the agency's look.
export default async function AgencyNotFound() {
  const path = (await headers()).get("x-pathname") ?? "";
  const slug = path.split("/")[1] ?? "";
  const agency = slug ? await publicAgency(slug) : null;
  return (
    <div className="mx-auto max-w-xl px-5 py-20 text-center">
      <h1 className="display text-4xl font-semibold">This link has expired or was already used</h1>
      <p className="mt-3 text-ink-2">
        Links in our emails for showings, references and leases work for a limited time. If you still need something, get in touch and we&apos;ll send a new one.
      </p>
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
