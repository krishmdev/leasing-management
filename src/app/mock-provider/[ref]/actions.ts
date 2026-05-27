"use server";

import { completeHostedFlow, deliverWebhook, getInvitation, PERSONAS, type Persona } from "@/mock-cra/service";

/**
 * The "provider's" own endpoint. Note what it receives: a persona choice and a consent flag.
 * The SSN and date of birth typed on the page are never part of this request.
 */
export async function completeScreeningAction(ref: string, _: unknown, fd: FormData) {
  const persona = String(fd.get("persona")) as Persona;
  if (!(persona in PERSONAS) || fd.get("consent") !== "on") return { ok: false, message: "Choose a scenario and authorize the check." };
  const inv = await getInvitation(ref);
  if (!inv) return { ok: false, message: "Unknown invitation." };
  const { inv: done, eventId } = await completeHostedFlow(ref, persona);
  let status = 0;
  for (let i = 0; i < 3 && status !== 200; i++) {
    status = await deliverWebhook(done, eventId).catch(() => 0);
    if (status !== 200) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
  }
  return { ok: true, message: status === 200 ? "Done. The leasing office has been notified that your screening is complete." : "Done. We'll notify the leasing office shortly." };
}
