import { redirect } from "next/navigation";
import { getSession, staffMemberships } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function DashboardIndex() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard");
  const m = await staffMemberships(session.user.id);
  if (!m[0]) redirect("/");
  redirect(`/dashboard/${m[0].organization.slug}`);
}
