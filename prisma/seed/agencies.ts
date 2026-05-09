import { uuidv7 } from "@/lib/ids";
import { db } from "@/server/db";
import { auth } from "@/server/auth";
import type { AgencyContact, AgencyTheme } from "@/server/domain/agency";

export const DEMO_PASSWORD = "demo-password-2026";

export const AGENCIES = [
  {
    slug: "bayview",
    name: "Bayview Property Group",
    city: "Oakland",
    automation: { level: "ASSISTED", autoApproveMinScore: 85, dailyCap: 5, allowedCreditBands: ["EXCELLENT", "GOOD"] },
    theme: {
      brand: "#9a3412",
      brandInk: "#fff7ed",
      accent: "#f59e0b",
      paper: "#faf6ef",
      ink: "#1c1917",
      font: "fraunces",
      tagline: "Homes around Lake Merritt, Temescal and Rockridge",
      heroLine: "Oakland apartments, managed by people who live here.",
      about:
        "Bayview is a family-run property manager with buildings in Temescal, Grand Lake and Rockridge. We answer maintenance calls ourselves, and most of our residents renew.",
    } satisfies AgencyTheme,
    contact: {
      phone: "(510) 555-0142",
      email: "leasing@bayview.test",
      office: "4120 Broadway, Oakland, CA 94611",
      hours: "Mon–Sat, 9am–6pm",
      license: "CA DRE #02099999 (demo)",
    } satisfies AgencyContact,
    staff: [
      { email: "owner@bayview.test", name: "Dana Whitaker", role: "owner" },
      { email: "agent@bayview.test", name: "Luis Ortega", role: "agent" },
      { email: "agent2@bayview.test", name: "Grace Kim", role: "agent" },
      { email: "maintenance@bayview.test", name: "Ray Mendes", role: "maintenance" },
    ],
  },
  {
    slug: "peninsula",
    name: "Peninsula Homes",
    city: "San Mateo",
    automation: { level: "AUTONOMOUS", autoApproveMinScore: 85, dailyCap: 3, allowedCreditBands: ["EXCELLENT", "GOOD"] },
    theme: {
      brand: "#1f4d45",
      brandInk: "#f2f7f5",
      accent: "#c9a227",
      paper: "#f4f6f3",
      ink: "#111a18",
      font: "bricolage",
      tagline: "San Mateo · Burlingame · Foster City",
      heroLine: "Quiet Peninsula rentals near Caltrain.",
      about:
        "Peninsula Homes manages garden apartments and townhomes between Burlingame and Foster City. Applications are reviewed within a day.",
    } satisfies AgencyTheme,
    contact: {
      phone: "(650) 555-0188",
      email: "hello@peninsula.test",
      office: "220 S B St, San Mateo, CA 94401",
      hours: "Mon–Fri, 9am–5pm",
      license: "CA DRE #02088888 (demo)",
    } satisfies AgencyContact,
    staff: [
      { email: "owner@peninsula.test", name: "Priya Raman", role: "owner" },
      { email: "agent@peninsula.test", name: "Tom Becker", role: "agent" },
      { email: "maintenance@peninsula.test", name: "Ana Souza", role: "maintenance" },
    ],
  },
] as const;

export const SLA_DEFAULTS = [
  { urgency: "EMERGENCY", respondMins: 60, resolveMins: 24 * 60 },
  { urgency: "HIGH", respondMins: 4 * 60, resolveMins: 72 * 60 },
  { urgency: "NORMAL", respondMins: 24 * 60, resolveMins: 7 * 24 * 60 },
  { urgency: "LOW", respondMins: 72 * 60, resolveMins: 14 * 24 * 60 },
] as const;

async function ensureUser(email: string, name: string) {
  const existing = await db().user.findUnique({ where: { email } });
  if (existing) return existing;
  const res = await auth().api.signUpEmail({ body: { email, name, password: DEMO_PASSWORD } });
  await db().user.update({ where: { id: res.user.id }, data: { emailVerified: true } });
  return db().user.findUniqueOrThrow({ where: { id: res.user.id } });
}

export async function seedAgencies() {
  const out: Record<string, { id: string; staff: Record<string, string> }> = {};
  for (const a of AGENCIES) {
    const org = await db().organization.create({ data: { id: uuidv7(), name: a.name, slug: a.slug, createdAt: new Date() } });
    await db().agencySettings.create({
      data: {
        agencyId: org.id,
        jurisdictionState: "CA",
        jurisdictionCity: a.city,
        theme: a.theme,
        contact: a.contact,
        automation: a.automation,
        retention: { creditDataDays: 120, declinedPiiDays: 730 },
      },
    });
    await db().slaPolicy.createMany({ data: SLA_DEFAULTS.map((s) => ({ agencyId: org.id, ...s })) });
    const staff: Record<string, string> = {};
    for (const s of a.staff) {
      const u = await ensureUser(s.email, s.name);
      await db().member.create({ data: { id: uuidv7(), organizationId: org.id, userId: u.id, role: s.role, createdAt: new Date() } });
      staff[s.email] = u.id;
    }
    out[a.slug] = { id: org.id, staff };
  }
  return out;
}
