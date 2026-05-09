import { notFound } from "next/navigation";
import "@fontsource-variable/fraunces/index.css";
import "@fontsource-variable/figtree/index.css";
import "@fontsource-variable/bricolage-grotesque/index.css";
import "@fontsource-variable/public-sans/index.css";
import { publicAgency } from "@/server/domain/agency";
import { RESERVED_SLUGS } from "@/server/tenant";
import { AgencyShell } from "@/components/site/AgencyShell";

export default async function AgencyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  if (RESERVED_SLUGS.has(agencySlug)) notFound();
  const agency = await publicAgency(agencySlug);
  if (!agency) notFound();
  return <AgencyShell agency={agency}>{children}</AgencyShell>;
}

export async function generateMetadata({ params }: { params: Promise<{ agencySlug: string }> }) {
  const agency = await publicAgency((await params).agencySlug);
  return agency ? { title: { default: agency.name, template: `%s · ${agency.name}` }, description: agency.theme.tagline } : {};
}
