import { db } from "@/server/db";
import { strandedSteps } from "@/server/agent/durable";
import { Q } from "./queues";

type Send = (name: typeof Q.submitted | typeof Q.evaluate, data: object, key: string) => Promise<unknown>;

/**
 * Re-enqueue work whose runner vanished. Each step goes back to the job that owns it, and an
 * evaluation is only queued once the application is actually ready for one (report in, refs
 * done); queuing it earlier would record a bogus input snapshot for fetchSummary.
 */
export async function reapStranded(send: Send) {
  let sent = 0;
  for (const s of await strandedSteps()) {
    const key = { agencyId: s.agencyId, applicationId: s.applicationId };
    if (s.stepName === "screening.invite") {
      await send(Q.submitted, key, `submitted:${s.applicationId}`);
      sent++;
      continue;
    }
    const app = await db().application.findUnique({ where: { id: s.applicationId }, select: { status: true } });
    if (app && (app.status === "SCREENED" || app.status === "DECISION_PENDING")) {
      await send(Q.evaluate, { ...key, criteriaVersionId: s.criteriaVersionId }, `evaluate:${s.applicationId}:${s.criteriaVersionId}`);
      sent++;
    }
  }
  return sent;
}
