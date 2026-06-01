import { tenantDb, type TenantDb } from "@/server/tenant";
import { decryptLead } from "@/server/domain/leads/service";
import { ThemeSchema, ContactSchema } from "@/server/domain/agency";
import { showingToken } from "@/server/domain/showings/booking";
import { buildIcs } from "@/server/domain/showings/ics";
import { fields } from "@/server/crypto/fieldEncryption";
import { deriveToken } from "@/server/crypto/tokens";
import { decryptApplication } from "@/server/domain/applications/service";

import { dateLabel, timeLabel, usd } from "@/lib/format";
import type { EmailPayload, Recipient } from "@/server/outbox/outbox";
import { render } from "./templates";
import type { OutgoingEmail } from "./transport";

export const appUrl = () =>
  (process.env.APP_URL ?? "http://localhost:3041").replace(/\/$/, "");

interface Ctx {
  t: TenantDb;
  agency: {
    id: string;
    slug: string;
    name: string;
    timezone: string;
    brand: string;
    email: string;
    phone: string;
  };
}

type Composer = (
  ctx: Ctx,
  to: string,
  params: Record<string, unknown>,
  key: string,
) => Promise<OutgoingEmail | null>;

async function resolveRecipient(ctx: Ctx, r: Recipient): Promise<string[]> {
  switch (r.kind) {
    case "lead": {
      const l = await ctx.t.lead.findUnique({ where: { id: r.id } });
      const email = l ? decryptLead(l).email : null;
      return email ? [email] : [];
    }
    case "user": {
      // Better Auth users are global; the tenant client allows plain reads of them.
      const u = await ctx.t.user.findUnique({ where: { id: r.id } });
      return u ? [u.email] : [];
    }
    case "reference": {
      const req = await ctx.t.referenceRequest.findUnique({
        where: { id: r.id },
      });
      if (!req) return [];
      const res = await ctx.t.residenceHistory.findUnique({
        where: { id: req.residenceId },
      });
      if (!res?.landlordEmailEnc) return [];
      return [
        fields({
          agencyId: ctx.agency.id,
          model: "ResidenceHistory",
          id: res.id,
        }).dec("landlordEmailEnc", res.landlordEmailEnc),
      ];
    }
    case "agency-staff": {
      const members = await ctx.t.member.findMany({
        where: { organizationId: ctx.agency.id, role: { in: r.roles } },
        include: { user: true },
      });
      return members.map((m) => m.user.email);
    }
  }
}

const brand = (ctx: Ctx) => ({
  name: ctx.agency.name,
  color: ctx.agency.brand,
});
const footer = (ctx: Ctx) =>
  `${ctx.agency.name} · ${ctx.agency.phone} · ${ctx.agency.email}`;

async function showingParts(ctx: Ctx, params: Record<string, unknown>) {
  const row = await ctx.t.showing.findUnique({
    where: { id: String(params.showingId) },
    include: { unit: { include: { property: true } } },
  });
  if (!row) return null;
  // Render the invite as it was when this email was queued (see queueShowingMail).
  const s = {
    ...row,
    icsSequence: Number(params.sequence ?? row.icsSequence),
    startsAt: params.startsAt ? new Date(String(params.startsAt)) : row.startsAt,
    endsAt: params.endsAt ? new Date(String(params.endsAt)) : row.endsAt,
    agentUserId: String(params.agentUserId ?? row.agentUserId),
    changedAt: params.changedAt ? new Date(String(params.changedAt)) : row.changedAt,
    currentSequence: row.icsSequence,
  };
  const agent = await ctx.t.user.findUnique({ where: { id: s.agentUserId } });
  const where = `${s.unit.property.street}, ${s.unit.property.city}`;
  const when = `${dateLabel(s.startsAt, ctx.agency.timezone, { weekday: "long", month: "long", day: "numeric" })} at ${timeLabel(s.startsAt, ctx.agency.timezone)}`;
  const manage = `${appUrl()}/${ctx.agency.slug}/showings/${showingToken(s)}`;
  return {
    s,
    agent,
    where,
    when,
    manage,
    title: `Showing: ${s.unit.property.name} ${s.unit.label}`,
  };
}

function icsAttachment(
  ctx: Ctx,
  p: NonNullable<Awaited<ReturnType<typeof showingParts>>>,
  method: "REQUEST" | "CANCEL",
) {
  const ics = buildIcs({
    uid: p.s.icsUid,
    sequence: p.s.icsSequence,
    method,
    start: p.s.startsAt,
    end: p.s.endsAt,
    title: p.title,
    location: p.where,
    description: `${p.agent?.name ?? "A leasing agent"} will meet you there. Reschedule or cancel: ${p.manage}`,
    organizer: { name: ctx.agency.name, email: ctx.agency.email },
    url: p.manage,
    stamp: p.s.changedAt,
  });
  return {
    filename: "showing.ics",
    content: ics,
    contentType: `text/calendar; charset=utf-8; method=${method}`,
  };
}

const COMPOSERS: Record<string, Composer> = {
  "ioi.received": async (ctx, to, params) => {
    const unit = await ctx.t.unit.findUnique({
      where: { id: String(params.unitId) },
      include: { property: true },
    });
    if (!unit) return null;
    const url = `${appUrl()}/${ctx.agency.slug}/apply?unit=${unit.slug}`;
    return render(
      to,
      `We got your note about ${unit.property.name} ${unit.label}`,
      {
        brand: brand(ctx),
        heading: "Thanks for reaching out",
        paragraphs: [
          `We received your interest in ${unit.property.name} ${unit.label} (${usd(unit.rentCents)}/month). A leasing agent will follow up within one business day.`,
          "If you already know you want to apply, you can start now. It takes about fifteen minutes and saves as you go.",
        ],
        cta: { label: "Start my application", url },
        footer: footer(ctx),
      },
    );
  },

  "showing.confirmed": async (ctx, to, params) => {
    const p = await showingParts(ctx, params);
    if (!p) return null;
    return render(
      to,
      `Showing confirmed: ${p.when}`,
      {
        brand: brand(ctx),
        heading: "Your showing is booked",
        paragraphs: [
          `${p.title}`,
          `${p.when}`,
          `${p.where}`,
          `${p.agent?.name ?? "A leasing agent"} will meet you at the front entrance. The calendar invite is attached.`,
        ],
        cta: { label: "Reschedule or cancel", url: p.manage },
        footer: footer(ctx),
      },
      {
        attachments: [icsAttachment(ctx, p, "REQUEST")],
        messageId: `<${p.s.icsUid.replace("@", `.${p.s.icsSequence}@`)}>`,
      },
    );
  },

  "showing.rescheduled": async (ctx, to, params) => {
    const p = await showingParts(ctx, params);
    if (!p) return null;
    return render(
      to,
      `Showing moved to ${p.when}`,
      {
        brand: brand(ctx),
        heading: "Your showing has a new time",
        paragraphs: [
          `${p.title}`,
          `New time: ${p.when}`,
          `${p.where}`,
          "The attached invite replaces the old one in your calendar.",
        ],
        cta: { label: "Manage showing", url: p.manage },
        footer: footer(ctx),
      },
      { attachments: [icsAttachment(ctx, p, "REQUEST")] },
    );
  },

  "showing.canceled": async (ctx, to, params) => {
    const p = await showingParts(ctx, params);
    if (!p) return null;
    return render(
      to,
      "Showing canceled",
      {
        brand: brand(ctx),
        heading: "Your showing is canceled",
        paragraphs: [
          `${p.title} on ${p.when} is canceled. The attached update removes it from your calendar.`,
          "You can book another time from the listing page whenever you like.",
        ],
        footer: footer(ctx),
      },
      { attachments: [icsAttachment(ctx, p, "CANCEL")] },
    );
  },

  "showing.reminder": async (ctx, to, params) => {
    const p = await showingParts(ctx, params);
    // Stale reminder: the showing was canceled, completed, or moved (new sequence, new reminders).
    if (
      !p ||
      p.s.status !== "SCHEDULED" ||
      p.s.currentSequence !== p.s.icsSequence
    )
      return null;
    return render(to, `Reminder: showing ${p.when}`, {
      brand: brand(ctx),
      heading: "See you soon",
      paragraphs: [`${p.title}`, `${p.when}`, `${p.where}`],
      cta: { label: "Reschedule or cancel", url: p.manage },
      footer: footer(ctx),
    });
  },

  "application.submitted": async (ctx, to, params) => {
    const app = await ctx.t.application.findUnique({ where: { id: String(params.applicationId) }, include: { unit: { include: { property: true } } } });
    if (!app) return null;
    return render(to, `Application received: ${app.unit.property.name} ${app.unit.label}`, {
      brand: brand(ctx),
      heading: "We have your application",
      paragraphs: [
        "Next, our screening company will email you a link to its own secure page, where you'll verify your identity. That's the only place your Social Security number goes; we never see it.",
        "We've also asked the landlords you listed for a short reference. You can check progress any time.",
      ],
      cta: { label: "Check application status", url: `${appUrl()}/${ctx.agency.slug}/apply/${app.id}/status` },
      footer: footer(ctx),
    });
  },

  "screening.invite": async (ctx, to, params) => {
    const sr = await ctx.t.screeningRequest.findUnique({ where: { id: String(params.screeningRequestId) } });
    if (!sr?.hostedUrl) return null;
    return render(to, "Complete your screening", {
      brand: brand(ctx),
      heading: "One more step: screening",
      paragraphs: [
        `${ctx.agency.name} uses an independent screening company. Follow the link to its secure page to verify your identity and authorize a credit and rental history check.`,
        "You'll enter your SSN and date of birth there, not with us.",
      ],
      cta: { label: "Go to the screening page", url: sr.hostedUrl },
      footer: footer(ctx),
    });
  },

  "reference.request": async (ctx, to, params) => referenceMail(ctx, to, String(params.referenceRequestId), false),
  "reference.reminder": async (ctx, to, params) => referenceMail(ctx, to, String(params.referenceRequestId), true),

  "application.approved": async (ctx, to, params) => {
    const app = await ctx.t.application.findUnique({ where: { id: String(params.applicationId) }, include: { unit: { include: { property: true } }, hold: true } });
    if (!app) return null;
    const conditions = (params.conditions as string[] | undefined) ?? [];
    return render(to, `Approved: ${app.unit.property.name} ${app.unit.label}`, {
      brand: brand(ctx),
      heading: params.outcome === "CONDITIONAL" ? "You're conditionally approved" : "You're approved",
      paragraphs: [
        `We're holding ${app.unit.property.name} ${app.unit.label} for you${app.hold?.expiresAt ? ` until ${dateLabel(app.hold.expiresAt, ctx.agency.timezone, { month: "long", day: "numeric" })} at ${timeLabel(app.hold.expiresAt, ctx.agency.timezone)}` : ""}.`,
        ...(conditions.length ? [`Conditions: ${conditions.join("; ")}.`] : []),
        "Your lease will arrive in a separate email with a link to review and sign it online.",
      ],
      footer: footer(ctx),
    });
  },

  "application.waitlisted": async (ctx, to, params) => {
    const app = await ctx.t.application.findUnique({ where: { id: String(params.applicationId) }, include: { unit: { include: { property: true } } } });
    if (!app) return null;
    return render(to, `Approved, on the waitlist for ${app.unit.property.name} ${app.unit.label}`, {
      brand: brand(ctx),
      heading: "You're approved, and next in line",
      paragraphs: ["Another approved applicant currently has a hold on this home. If their hold expires or they pass, it's offered to you automatically and you'll get a lease by email."],
      footer: footer(ctx),
    });
  },

  "application.adverse_action": async (ctx, to, params) => {
    const app = await ctx.t.application.findUnique({ where: { id: String(params.applicationId) } });
    if (!app) return null;
    return render(to, "About your rental application", {
      brand: brand(ctx),
      heading: params.kind === "CONDITIONAL" ? "About the conditions on your approval" : "We couldn't approve your application",
      paragraphs: [
        "A written notice with the main reasons, the screening company's contact details, and your rights to a free copy of your report and to dispute it is available on your application page.",
        "If you think something in the report is wrong, contact the screening company directly; they, not we, can correct it.",
      ],
      cta: { label: "View the notice", url: `${appUrl()}/${ctx.agency.slug}/apply/${app.id}/status` },
      footer: footer(ctx),
    });
  },

  "lease.sent": async (ctx, to, params) => {
    const lease = await ctx.t.lease.findUnique({ where: { id: String(params.leaseId) }, include: { unit: { include: { property: true } } } });
    if (!lease || lease.status !== "SENT") return null;
    const url = `${appUrl()}/${ctx.agency.slug}/lease/${deriveToken("lease", lease.id, lease.tokenVersion).token}`;
    return render(to, `Your lease for ${lease.unit.property.name} ${lease.unit.label}`, {
      brand: brand(ctx),
      heading: "Review and sign your lease",
      paragraphs: [
        `Rent ${usd(lease.rentCents)}/month, deposit ${usd(lease.depositCents)}, starting ${dateLabel(lease.startDate, "UTC", { month: "long", day: "numeric", year: "numeric" })}.`,
        `Please sign before ${dateLabel(lease.signTokenExpiresAt, ctx.agency.timezone, { month: "long", day: "numeric" })} at ${timeLabel(lease.signTokenExpiresAt, ctx.agency.timezone)}, when your hold ends.`,
      ],
      cta: { label: "Review lease", url },
      footer: footer(ctx),
    });
  },

  "lease.signed": async (ctx, to, params) => {
    const lease = await ctx.t.lease.findUnique({ where: { id: String(params.leaseId) }, include: { unit: { include: { property: true } } } });
    if (!lease) return null;
    return render(to, "Lease signed. Welcome home.", {
      brand: brand(ctx),
      heading: "You're all set",
      paragraphs: [`Your lease for ${lease.unit.property.name} ${lease.unit.label} is signed. A countersigned copy with a signature certificate is on your resident portal.`, "For repairs after move-in, use the resident portal; emergencies get a same-hour response."],
      cta: { label: "Open resident portal", url: `${appUrl()}/${ctx.agency.slug}/portal` },
      footer: footer(ctx),
    });
  },

  "hold.expired": async (ctx, to) =>
    render(to, "Your hold has expired", { brand: brand(ctx), heading: "Your hold ended", paragraphs: ["The lease wasn't signed before the hold expired, so the home has been offered to the next applicant. Contact us if this was a mistake."], footer: footer(ctx) }),

  "hold.unit_leased": async (ctx, to) =>
    render(to, "The home you were waiting on has been leased", { brand: brand(ctx), heading: "This one's taken", paragraphs: ["The applicant ahead of you signed the lease. Your approval still counts: reply and we'll match you with a similar home."], footer: footer(ctx) }),

  "ticket.created": async (ctx, to, params) => {
    const t = await ctx.t.maintenanceTicket.findUnique({ where: { id: String(params.ticketId) } });
    if (!t) return null;
    return render(to, `Request received: ${t.title}`, {
      brand: brand(ctx),
      heading: t.urgency === "EMERGENCY" ? "Emergency request received" : "We got your maintenance request",
      paragraphs: [
        `Priority: ${t.urgency.toLowerCase()}. We'll respond by ${dateLabel(t.slaRespondBy ?? t.createdAt, ctx.agency.timezone, { weekday: "short", month: "short", day: "numeric" })} at ${timeLabel(t.slaRespondBy ?? t.createdAt, ctx.agency.timezone)}.`,
        ...(t.urgency === "EMERGENCY" ? [`If anyone is in danger, call 911. For after-hours emergencies call ${ctx.agency.phone}.`] : []),
      ],
      cta: { label: "Track this request", url: `${appUrl()}/${ctx.agency.slug}/portal/tickets/${t.id}` },
      footer: footer(ctx),
    });
  },
  "ticket.status": async (ctx, to, params) => {
    const t = await ctx.t.maintenanceTicket.findUnique({ where: { id: String(params.ticketId) } });
    if (!t) return null;
    const label: Record<string, string> = { ASSIGNED: "assigned to a technician", IN_PROGRESS: "in progress", ON_HOLD: "on hold (waiting on parts or access)", RESOLVED: "resolved", CLOSED: "closed", TRIAGED: "reviewed", CANCELED: "canceled" };
    return render(to, `Update: ${t.title}`, {
      brand: brand(ctx),
      heading: `Your request is ${label[String(params.to)] ?? String(params.to).toLowerCase()}`,
      paragraphs: [t.title],
      cta: { label: "View request", url: `${appUrl()}/${ctx.agency.slug}/portal/tickets/${t.id}` },
      footer: footer(ctx),
    });
  },
  "ticket.comment": async (ctx, to, params) => {
    const c = await ctx.t.ticketComment.findUnique({ where: { id: String(params.commentId) } });
    if (!c || c.internal) return null;
    return render(to, "New message about your maintenance request", {
      brand: brand(ctx),
      heading: "Message from maintenance",
      paragraphs: [c.body],
      cta: { label: "Reply", url: `${appUrl()}/${ctx.agency.slug}/portal/tickets/${c.ticketId}` },
      footer: footer(ctx),
    });
  },
  "ticket.staff_alert": async (ctx, to, params) => {
    const t = await ctx.t.maintenanceTicket.findUnique({ where: { id: String(params.ticketId) }, include: { unit: { include: { property: true } } } });
    if (!t) return null;
    return render(to, `${t.urgency === "EMERGENCY" ? "EMERGENCY" : "Needs a person"}: ${t.title} (${t.unit.property.name} ${t.unit.label})`, {
      brand: brand(ctx),
      heading: t.urgency === "EMERGENCY" ? `Emergency ticket${t.safetyRule ? ` (${t.safetyRule} rule)` : ""}` : "Possible accommodation request",
      paragraphs: [t.description.slice(0, 500)],
      cta: { label: "Open ticket", url: `${appUrl()}/dashboard/${ctx.agency.slug}/maintenance/${t.id}` },
      footer: footer(ctx),
    });
  },
  "ticket.escalation": async (ctx, to, params) => {
    const t = await ctx.t.maintenanceTicket.findUnique({ where: { id: String(params.ticketId) }, include: { unit: { include: { property: true } } } });
    if (!t) return null;
    return render(to, `SLA breached: ${t.title}`, {
      brand: brand(ctx),
      heading: `The ${params.kind === "respond" ? "response" : "resolution"} deadline passed`,
      paragraphs: [`${t.unit.property.name} ${t.unit.label} · ${t.urgency.toLowerCase()} · ${t.status.toLowerCase().replace("_", " ")}`],
      cta: { label: "Open ticket", url: `${appUrl()}/dashboard/${ctx.agency.slug}/maintenance/${t.id}` },
      footer: footer(ctx),
    });
  },
};

async function referenceMail(ctx: Ctx, to: string, requestId: string, reminder: boolean) {
  const req = await ctx.t.referenceRequest.findUnique({ where: { id: requestId }, include: { application: true } });
  if (!req || (reminder && !["SENT", "OPENED"].includes(req.status)) || req.expiresAt.getTime() < Date.now()) return null;
  const url = `${appUrl()}/r/${deriveToken("reference", req.id, req.tokenVersion).token}`;
  const first = (decryptApplication(req.application).legalName ?? "A former tenant").split(/\s+/)[0];
  return render(to, `${reminder ? "Reminder: " : ""}Rental reference for ${first}`, {
    brand: brand(ctx),
    heading: "Could you give a quick rental reference?",
    paragraphs: [
      `${first} applied to rent a home with ${ctx.agency.name} and listed you as a past landlord. The form takes about two minutes: a few multiple-choice questions and an optional comment.`,
      `The link works once and expires on ${dateLabel(req.expiresAt, ctx.agency.timezone, { month: "long", day: "numeric" })}.`,
    ],
    cta: { label: "Give a reference", url },
    footer: `${ctx.agency.name} · ${ctx.agency.phone}`,
  });
}

export function registerComposer(template: string, fn: Composer) {
  COMPOSERS[template] = fn;
}

export async function composeEmail(
  agencyId: string,
  payload: EmailPayload,
  key: string,
): Promise<OutgoingEmail | null> {
  const t = tenantDb(agencyId);
  const org = await t.organization.findUniqueOrThrow({
    where: { id: agencyId },
  });
  const settings = await t.agencySettings.findFirstOrThrow({});
  const theme = ThemeSchema.parse(settings.theme);
  const contact = ContactSchema.parse(settings.contact);
  const ctx: Ctx = {
    t,
    agency: {
      id: org.id,
      slug: org.slug,
      name: org.name,
      timezone: settings.timezone,
      brand: theme.brand,
      email: contact.email,
      phone: contact.phone,
    },
  };
  const fn = COMPOSERS[payload.template];
  if (!fn) throw new Error(`no email template ${payload.template}`);
  const recipients = await resolveRecipient(ctx, payload.to);
  if (recipients.length === 0) return null;
  // One row, one message. Staff notifications go to everyone with the role in a single email.
  return fn(ctx, recipients.join(", "), payload.params, key);
}
