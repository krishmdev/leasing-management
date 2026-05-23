import { tenantDb, type TenantDb } from "@/server/tenant";
import { decryptLead } from "@/server/domain/leads/service";
import { ThemeSchema, ContactSchema } from "@/server/domain/agency";
import { showingToken } from "@/server/domain/showings/booking";
import { buildIcs } from "@/server/domain/showings/ics";
import { fields } from "@/server/crypto/fieldEncryption";

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
      return l ? [decryptLead(l).email] : [];
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
  const s = await ctx.t.showing.findUnique({
    where: { id: String(params.showingId) },
    include: { unit: { include: { property: true } } },
  });
  if (!s) return null;
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
    if (!p || p.s.icsSequence !== Number(params.sequence)) return null;
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
      p.s.icsSequence !== Number(params.sequence)
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
};

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
