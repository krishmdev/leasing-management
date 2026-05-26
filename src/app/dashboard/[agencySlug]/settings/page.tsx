import { requireStaff } from "@/server/session";
import { AutomationConfig } from "@/server/domain/agent/policy";
import { localDay } from "@/server/domain/decisions/decide";
import { PageHeader } from "@/components/ui";
import { requestTime } from "@/lib/time";
import { AutomationForm } from "./AutomationForm";

export const metadata = { title: "Settings" };

export default async function Settings({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const ctx = await requireStaff(agencySlug, "settings.write");
  const s = await ctx.tdb.agencySettings.findFirstOrThrow({});
  const cfg = AutomationConfig.parse(s.automation);
  const quota = await ctx.tdb.automationQuota.findFirst({ where: { day: localDay(s.timezone, new Date(await requestTime())) } });
  return (
    <>
      <PageHeader title="Settings" sub="Automation, holds and retention for this agency." />
      <AutomationForm slug={agencySlug} cfg={cfg} paused={s.automationPaused} usedToday={quota?.used ?? 0} holdHours={s.holdHours} retention={s.retention as { creditDataDays?: number; declinedPiiDays?: number }} />
    </>
  );
}
