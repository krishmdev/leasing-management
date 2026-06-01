import Link from "next/link";
import { requireStaff } from "@/server/session";
import { can, DESK_SECTIONS } from "@/server/access";
import { Card } from "@/components/ui";

export const metadata = { title: "No access" };

export default async function NoAccess({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const ctx = await requireStaff(agencySlug);
  const allowed = DESK_SECTIONS.filter((s) => can(ctx.role, s.perm));
  return (
    <Card className="mx-auto mt-10 max-w-lg p-6">
      <h1 className="text-lg font-semibold">You don&apos;t have access to that page</h1>
      <p className="mt-1 text-sm text-ink-2">
        Your role at {ctx.agencyName} is <span className="font-medium">{ctx.role}</span>. Ask an owner or admin if you need more.
      </p>
      {allowed.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2 text-sm">
          {allowed.map((s) => (
            <li key={s.path}><Link href={`/dashboard/${agencySlug}${s.path}`} className="inline-flex min-h-8 items-center rounded-md border border-line-strong px-3">{s.label}</Link></li>
          ))}
        </ul>
      )}
    </Card>
  );
}
