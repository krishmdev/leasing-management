import { requireStaff } from "@/server/session";
import { pipelineCards } from "@/server/domain/desk/pipeline";
import { PageHeader } from "@/components/ui";
import { requestTime } from "@/lib/time";
import { Kanban } from "./Kanban";

export const metadata = { title: "Pipeline" };

export default async function Pipeline({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  const ctx = await requireStaff(agencySlug, "applications.read");
  const now = await requestTime();
  const cards = await pipelineCards(ctx.tdb, now);
  return (
    <>
      <PageHeader title="Pipeline" sub="Cards move on their own as prospects book, apply, get screened and sign. You can drag between Interest and Showing, or to Lost." />
      <Kanban slug={agencySlug} cards={cards} />
    </>
  );
}
