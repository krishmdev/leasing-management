import type { Metadata } from "next";
import { requireStaff, staffMemberships } from "@/server/session";
import { DeskNav } from "@/components/desk/DeskNav";
import { signOut } from "@/app/(auth)/login/actions";
import { can } from "@/server/access";

export const metadata: Metadata = { title: { default: "Desk", template: "%s · Desk" } };

export default async function DeskLayout({ children, params }: { children: React.ReactNode; params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const ctx = await requireStaff(agencySlug);
  const [memberships, approvals, emergencies] = await Promise.all([
    staffMemberships(ctx.userId),
    ctx.tdb.approvalTask.count({ where: { status: "OPEN" } }),
    ctx.tdb.maintenanceTicket.count({ where: { urgency: "EMERGENCY", status: { notIn: ["RESOLVED", "CLOSED", "CANCELED"] } } }),
  ]);
  const base = `/dashboard/${agencySlug}`;
  const items = [
    { href: base, label: "Overview", show: can(ctx.role, "metrics.read") },
    { href: `${base}/pipeline`, label: "Pipeline", show: can(ctx.role, "applications.read") },
    { href: `${base}/applications`, label: "Applications", show: can(ctx.role, "applications.read") },
    { href: `${base}/approvals`, label: "Approvals", badge: approvals, show: can(ctx.role, "applications.decide") },
    { href: `${base}/showings`, label: "Showings", show: can(ctx.role, "showings.manage") },
    { href: `${base}/listings`, label: "Listings", show: can(ctx.role, "listings.write") },
    { href: `${base}/maintenance`, label: "Maintenance", badge: emergencies, badgeTone: "bad" as const, show: can(ctx.role, "maintenance.read") },
    { href: `${base}/residents`, label: "Residents", show: can(ctx.role, "residents.read") },
    { href: `${base}/audit`, label: "Audit log", show: can(ctx.role, "audit.read") },
    { href: `${base}/settings`, label: "Settings", show: can(ctx.role, "settings.write") },
  ].filter((i) => i.show);
  return (
    <div className="min-h-dvh bg-paper text-[14px] text-ink">
      <DeskNav
        items={items}
        agencies={memberships.map((m) => ({ slug: m.organization.slug, name: m.organization.name }))}
        current={{ slug: ctx.agencySlug, name: ctx.agencyName }}
        user={{ name: ctx.userName, role: ctx.role }}
        signOut={signOut}
      />
      <div className="md:pl-60">
        <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
