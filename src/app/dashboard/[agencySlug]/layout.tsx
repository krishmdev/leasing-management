import type { Metadata } from "next";
import { requireStaff, staffMemberships } from "@/server/session";
import { DeskNav } from "@/components/desk/DeskNav";
import { signOut } from "@/app/(auth)/login/actions";
import { can, DESK_SECTIONS } from "@/server/access";

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
  const badges: Record<string, { badge: number; badgeTone?: "bad" }> = { "/approvals": { badge: approvals }, "/maintenance": { badge: emergencies, badgeTone: "bad" } };
  const items = DESK_SECTIONS.filter((x) => can(ctx.role, x.perm)).map((x) => ({ href: `${base}${x.path}`, label: x.label, ...badges[x.path] }));
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
