import Link from "next/link";
import { requireStaff } from "@/server/session";
import { Badge, Card, PageHeader } from "@/components/ui";
import { human } from "@/components/desk/bits";
import { bedsLabel, dayLabel, usd } from "@/lib/format";
import { toggleListedAction } from "../actions";

export const metadata = { title: "Listings" };

export default async function Listings({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const ctx = await requireStaff(agencySlug, "listings.write");
  const props = await ctx.tdb.property.findMany({ include: { units: { orderBy: { label: "asc" } } }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="Listings" sub="Pending and leased are set by holds and signed leases. You can list or unlist available units." actions={<Link href={`/${agencySlug}/listings`} className="text-[13px] underline" target="_blank">View public listings ↗</Link>} />
      <div className="space-y-4">
        {props.map((p) => (
          <Card key={p.id}>
            <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">{p.name} <span className="font-normal text-muted">· {p.street}, {p.city}</span></h2>
              <span className="font-mono text-2xs text-muted">{p.units.filter((u) => u.status === "AVAILABLE").length}/{p.units.length} available</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-[13px]">
                <tbody className="divide-y divide-line">
                  {p.units.map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-2 font-medium">{u.label}</td>
                      <td className="px-4 py-2">{bedsLabel(u.beds)} · {u.baths} ba · {u.sqft} sq ft</td>
                      <td className="px-4 py-2 text-right font-mono">{usd(u.rentCents)}</td>
                      <td className="px-4 py-2 text-muted">avail. {dayLabel(u.availableOn)}</td>
                      <td className="px-4 py-2"><Badge tone={u.status === "AVAILABLE" ? "ok" : u.status === "LEASED" ? "neutral" : u.status === "PENDING" ? "warn" : "neutral"}>{human(u.status)}</Badge></td>
                      <td className="px-4 py-2 text-right">
                        {(u.status === "AVAILABLE" || u.status === "OFF_MARKET") && (
                          <form action={toggleListedAction.bind(null, agencySlug, u.id, u.status === "OFF_MARKET")}>
                            <button className="min-h-7 rounded border border-line-strong px-2.5 text-2xs hover:bg-paper">{u.status === "OFF_MARKET" ? "List" : "Unlist"}</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
