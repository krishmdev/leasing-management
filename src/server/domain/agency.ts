import { z } from "zod";
import { db } from "@/server/db";

export const ThemeSchema = z.object({
  brand: z.string(), // primary brand color
  brandInk: z.string(), // text on brand
  accent: z.string(),
  paper: z.string(), // page background
  ink: z.string(), // body text
  font: z.enum(["fraunces", "bricolage"]),
  tagline: z.string(),
  heroLine: z.string(),
  about: z.string(),
});
export type AgencyTheme = z.infer<typeof ThemeSchema>;

export const ContactSchema = z.object({
  phone: z.string(),
  email: z.string(),
  office: z.string(),
  hours: z.string(),
  license: z.string(),
});
export type AgencyContact = z.infer<typeof ContactSchema>;

export async function publicAgency(slug: string) {
  const org = await db().organization.findUnique({ where: { slug }, include: { settings: true } });
  if (!org?.settings) return null;
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    timezone: org.settings.timezone,
    city: org.settings.jurisdictionCity,
    theme: ThemeSchema.parse(org.settings.theme),
    contact: ContactSchema.parse(org.settings.contact),
  };
}
export type PublicAgency = NonNullable<Awaited<ReturnType<typeof publicAgency>>>;
