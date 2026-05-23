import * as cra from "@/mock-cra/service";
import type { ScreeningProvider } from "./types";

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3041").replace(/\/$/, "");
const hosted = (ref: string) => `${appUrl()}/mock-provider/${ref}`;

export const mockProvider: ScreeningProvider = {
  id: "mock",
  async createInvitation(i) {
    const inv = await cra.createInvitation({ clientReference: i.idempotencyKey, idempotencyKey: i.idempotencyKey, applicantEmail: i.applicantEmail, rentCents: i.rentCents, callbackUrl: i.callbackUrl });
    return { providerApplicantRef: inv.ref, hostedUrl: hosted(inv.ref) };
  },
  async findExisting(key) {
    const byKey = await cra.findByIdempotencyKey(key);
    const inv = byKey ?? (await cra.findByClientReference(key))[0];
    return inv ? { providerApplicantRef: inv.ref, hostedUrl: hosted(inv.ref) } : null;
  },
  async getStatus(ref) {
    const inv = await cra.getInvitation(ref);
    return (inv?.status as "INVITED" | "COMPLETE") ?? "ERROR";
  },
  async getReportSummary(ref) {
    return cra.reportSummary(ref);
  },
  async verifyWebhook(req) {
    const body = await req.text();
    if (!cra.verifyWebhookSignature(body, req.headers.get("x-mockcra-signature"))) return null;
    const e = JSON.parse(body) as { id: string; type: string; ref: string };
    return { eventId: e.id, ref: e.ref, event: e.type === "screening.completed" ? "COMPLETE" : "ERROR" };
  },
  craDisclosure: () => cra.DISCLOSURE,
};
