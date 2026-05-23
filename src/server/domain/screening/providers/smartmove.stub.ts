import type { ScreeningProvider } from "./types";

/**
 * TransUnion SmartMove, documented but not wired: it needs a partner agreement and API
 * credentials we don't have. In their flow the landlord (us) creates an application for a
 * renter's email; the renter verifies identity and enters their SSN on TransUnion's site; we
 * receive the recommendation and report summary. The mapping to this interface:
 *
 *   createInvitation  -> create application + invite renter (send our idempotency key as the
 *                        client reference field; SmartMove has no Idempotency-Key header)
 *   findExisting      -> list applications filtered by that client reference
 *   getReportSummary  -> fetch report summary, map score band / public records / collections
 *   verifyWebhook     -> SmartMove notifies by polling rather than webhooks; a poll job would
 *                        call getStatus instead
 */
const notWired = () => {
  throw new Error("SmartMove is not configured in this build (partner agreement required)");
};

export const smartMoveProvider: ScreeningProvider = {
  id: "smartmove",
  createInvitation: notWired,
  findExisting: notWired,
  getStatus: notWired,
  getReportSummary: notWired,
  verifyWebhook: notWired,
  craDisclosure: () => ({ name: "TransUnion Rental Screening Solutions, Inc.", address: "P.O. Box 800, Woodlyn, PA 19094", phone: "(866) 775-0961", website: "https://www.transunion.com/rental-screening" }),
};
