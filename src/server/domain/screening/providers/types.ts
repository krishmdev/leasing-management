export type ProviderStatus = "INVITED" | "CONSENTED" | "IN_PROGRESS" | "COMPLETE" | "ERROR";

export interface DerivedScreeningSummary {
  reportId: string;
  creditBand: "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "THIN_FILE";
  creditScore: number | null;
  scoreModel: string | null;
  scoreRange: [number, number] | null;
  keyFactors: string[];
  scoreDate: string | null;
  evictionJudgmentsInLookback: number;
  collectionsNonMedicalCount: number;
  collectionsNonMedicalCents: number;
  identityVerified: boolean;
  incomeVerified: boolean;
}

export interface CraDisclosure {
  name: string;
  address: string;
  phone: string;
  website: string;
}

/**
 * A screening company. The applicant gives their SSN and date of birth to the provider on the
 * provider's own page (hostedUrl); we only ever get back a derived summary and a report id.
 */
export interface ScreeningProvider {
  id: "mock" | "smartmove";
  createInvitation(i: { idempotencyKey: string; applicantEmail: string; rentCents: number; callbackUrl: string; signal?: AbortSignal }): Promise<{ providerApplicantRef: string; hostedUrl: string }>;
  /**
   * Look up an invitation we may already have created, for reconciling after a crash between
   * the provider call and our commit. Tries the idempotency key, then our client reference.
   */
  findExisting(idempotencyKey: string): Promise<{ providerApplicantRef: string; hostedUrl: string } | null>;
  getStatus(ref: string): Promise<ProviderStatus>;
  getReportSummary(ref: string, signal?: AbortSignal): Promise<DerivedScreeningSummary>;
  verifyWebhook(req: Request): Promise<{ eventId: string; ref: string; event: "COMPLETE" | "ERROR" } | null>;
  craDisclosure(): CraDisclosure;
}
