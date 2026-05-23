import { z } from "zod";

/**
 * The five application steps. Deliberately absent: SSN, date of birth, sex, marital status,
 * children, national origin, citizenship, disability, criminal history. The screening
 * provider collects identity data on its own page.
 */
export const STEP_TITLES = ["About you", "Where you've lived", "Income", "Screening authorization", "Review and submit"] as const;

const money = z.coerce.number().min(0).max(1_000_000).transform((d) => Math.round(d * 100));

export const Step1 = z.object({
  legalName: z.string().trim().min(2, "Enter your full legal name").max(120),
  phone: z.string().trim().min(7, "Enter a phone number").max(40),
  desiredMoveIn: z.coerce.date({ error: "Pick a move-in date" }),
  totalOccupants: z.coerce.number().int().min(1).max(12),
});

export const Residence = z.object({
  address: z.string().trim().min(5, "Enter the address").max(200),
  landlordName: z.string().trim().max(120).optional().or(z.literal("")),
  landlordEmail: z.email("Enter the landlord's email").optional().or(z.literal("")),
  landlordPhone: z.string().trim().max(40).optional().or(z.literal("")),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  monthlyRent: money,
  consentToContact: z.coerce.boolean(),
});
export const Step2 = z.object({ residences: z.array(Residence).min(1, "Add at least one place you've lived").max(3) });

export const Step3 = z
  .object({
    incomeType: z.enum(["EMPLOYMENT", "SELF_EMPLOYMENT", "BENEFITS", "OTHER"]),
    monthlyIncome: money,
    hasRentSubsidy: z.coerce.boolean(),
    subsidyMonthly: money.optional(),
    altEvidenceProvided: z.coerce.boolean(),
  })
  .refine((s) => !s.hasRentSubsidy || (s.subsidyMonthly ?? 0) > 0, { message: "Enter the monthly subsidy amount", path: ["subsidyMonthly"] });

export const CONSENT_TEXT = {
  FCRA_AUTHORIZATION: {
    version: "fcra-auth.v1",
    text:
      "I authorize the agency to obtain a consumer report and rental history about me from its screening company for the purpose of evaluating this rental application. " +
      "I understand the screening company, not the agency, will collect my Social Security number and date of birth on its own secure page.",
  },
  REFERENCE_CONTACT: { version: "ref-contact.v1", text: "I authorize the agency to contact the landlords I listed for a rental reference." },
  ESIGN: { version: "esign.v1", text: "I agree to use electronic records and signatures for this application and any resulting lease." },
  PRIVACY: { version: "privacy.v1", text: "I have read how my information is used, stored and deleted." },
} as const;

export const Step4 = z.object({ fcra: z.literal(true, { error: "Authorization is required to screen your application" }) });
export const Step5 = z.object({
  esign: z.literal(true, { error: "Please agree to electronic records" }),
  privacy: z.literal(true, { error: "Please confirm you've read the privacy notice" }),
  accurate: z.literal(true, { error: "Please confirm your answers are accurate" }),
});
