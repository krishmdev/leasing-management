"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { requireStaff } from "@/server/session";
import { assertCan } from "@/server/access";
import { audit } from "@/server/audit/audit";
import { executeDecision } from "@/server/domain/decisions/decide";
import { AutomationConfig } from "@/server/domain/agent/policy";
import { revealApplicantPII } from "@/server/domain/desk/applications";
import { setUnitListed } from "@/server/domain/leases/sign";
import { markShowing } from "@/server/domain/showings/booking";
import { assignTicket, commentOnTicket, transitionTicket } from "@/server/domain/maintenance/tickets";
import { withdrawApplication } from "@/server/domain/decisions/withdraw";
import type { ReasonCode } from "@/server/domain/screening/rubric";
import type { TicketStatus } from "@/server/domain/maintenance/stateMachine";
import type { FormState } from "@/lib/forms";

const base = (slug: string) => `/dashboard/${slug}`;

export async function decideAction(slug: string, applicationId: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireStaff(slug, "applications.decide");
  const outcome = z.enum(["APPROVE", "CONDITIONAL", "DECLINE"]).safeParse(fd.get("outcome"));
  if (!outcome.success) return { message: "Pick an outcome." };
  const overrideReason = String(fd.get("overrideReason") ?? "").trim() || null;
  const settings = await ctx.tdb.agencySettings.findFirstOrThrow({});
  const level = AutomationConfig.parse(settings.automation).level;
  const app = await ctx.tdb.application.findUniqueOrThrow({ where: { id: applicationId } });
  const rec = app.criteriaVersionId ? await ctx.tdb.recommendation.findFirst({ where: { applicationId, criteriaVersionId: app.criteriaVersionId } }) : null;
  const reasons = ((rec?.breakdown as { reasonCodes?: ReasonCode[] } | null)?.reasonCodes ?? []) as ReasonCode[];
  try {
    const r = await executeDecision(ctx.agencyId, applicationId, {
      outcome: outcome.data, mode: level === "MANUAL" ? "MANUAL" : "ASSISTED", decidedByType: "USER", decidedById: ctx.userId,
      reasonCodes: outcome.data === "APPROVE" ? [] : reasons, conditions: outcome.data === "CONDITIONAL" ? rec?.conditions ?? [] : [], overrideReason,
    });
    revalidatePath(`${base(slug)}/applications/${applicationId}`);
    revalidatePath(`${base(slug)}/approvals`);
    if (r.status === "noop") return { message: `Nothing to do: ${r.reason}.` };
    return { ok: true, message: r.status === "executed" ? `Decision recorded${r.hold ? ` (hold ${r.hold.toLowerCase()})` : ""}.` : `Escalated: ${r.reason}.` };
  } catch (e) {
    return { message: e instanceof Error ? e.message : "Couldn't record the decision." };
  }
}

export async function revealAction(slug: string, applicationId: string, _: FormState, fd: FormData): Promise<FormState & { pii?: Awaited<ReturnType<typeof revealApplicantPII>> }> {
  const ctx = await requireStaff(slug, "pii.reveal");
  try {
    const pii = await revealApplicantPII(ctx, applicationId, String(fd.get("purpose") ?? ""));
    return { ok: true, pii };
  } catch (e) {
    return { message: e instanceof Error ? e.message : "Not allowed." };
  }
}

export async function withdrawAction(slug: string, applicationId: string) {
  const ctx = await requireStaff(slug, "applications.decide");
  await withdrawApplication(ctx.agencyId, applicationId, { type: "USER", id: ctx.userId });
  revalidatePath(`${base(slug)}/applications/${applicationId}`);
}

export async function dismissTaskAction(slug: string, taskId: string) {
  const ctx = await requireStaff(slug, "applications.decide");
  await ctx.tdb.$transaction(async (tx) => {
    await tx.approvalTask.updateMany({ where: { id: taskId, status: "OPEN" }, data: { status: "DISMISSED", resolvedById: ctx.userId, resolvedAt: new Date() } });
    await audit({ agencyId: ctx.agencyId, actorType: "USER", actorId: ctx.userId, action: "task.dismissed", entity: "ApprovalTask", entityId: taskId }, tx);
  });
  revalidatePath(`${base(slug)}/approvals`);
}

export async function toggleListedAction(slug: string, unitId: string, listed: boolean) {
  const ctx = await requireStaff(slug, "listings.write");
  await setUnitListed(ctx.agencyId, ctx.userId, unitId, listed);
  revalidatePath(`${base(slug)}/listings`);
}

export async function markShowingAction(slug: string, showingId: string, status: "COMPLETED" | "NO_SHOW") {
  const ctx = await requireStaff(slug, "showings.manage");
  await markShowing(ctx.agencyId, ctx.userId, showingId, status);
  revalidatePath(`${base(slug)}/showings`);
}

export async function ticketStatusAction(slug: string, ticketId: string, to: TicketStatus, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireStaff(slug, "maintenance.work");
  try {
    await transitionTicket(ctx.agencyId, { type: "USER", id: ctx.userId }, ticketId, to, String(fd.get("note") ?? "") || undefined);
  } catch (e) {
    return { message: (e as Error).message };
  }
  revalidatePath(`${base(slug)}/maintenance/${ticketId}`);
  return { ok: true, message: `Moved to ${to.toLowerCase().replace("_", " ")}.` };
}

export async function assignTicketAction(slug: string, ticketId: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireStaff(slug, "maintenance.work");
  try {
    await assignTicket(ctx.agencyId, ctx.userId, ticketId, String(fd.get("assignee")));
  } catch (e) {
    return { message: (e as Error).message };
  }
  revalidatePath(`${base(slug)}/maintenance/${ticketId}`);
  return { ok: true, message: "Assigned." };
}

export async function ticketCommentAction(slug: string, ticketId: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireStaff(slug, "maintenance.work");
  try {
    await commentOnTicket(ctx.agencyId, { type: "STAFF", id: ctx.userId }, ticketId, String(fd.get("body") ?? ""), fd.get("internal") === "on");
  } catch {
    return { message: "Write a message first." };
  }
  revalidatePath(`${base(slug)}/maintenance/${ticketId}`);
  return { ok: true, message: "Posted." };
}

const DRAGGABLE: Record<string, string[]> = { INTEREST: ["SHOWING", "LOST"], SHOWING: ["INTEREST", "LOST"] };

/** Staff may only move INTEREST <-> SHOWING by hand, or anything to LOST. Everything else follows domain events. */
export async function moveOpportunityAction(slug: string, opportunityId: string, to: string): Promise<{ ok: boolean; message?: string }> {
  const ctx = await requireStaff(slug, "applications.read");
  const opp = await ctx.tdb.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opp) return { ok: false, message: "Not found" };
  const allowed = to === "LOST" || (DRAGGABLE[opp.stage] ?? []).includes(to);
  if (!allowed) return { ok: false, message: `${opp.stage.toLowerCase()} → ${to.toLowerCase()} happens automatically when the applicant acts.` };
  await ctx.tdb.$transaction(async (tx) => {
    await tx.opportunity.update({ where: { id: opp.id }, data: { stage: to as never, stageChangedAt: new Date(), lostReason: to === "LOST" ? "marked lost by staff" : null } });
    await tx.stageEvent.create({ data: { agencyId: ctx.agencyId, opportunityId: opp.id, from: opp.stage, to: to as never } });
    await audit({ agencyId: ctx.agencyId, actorType: "USER", actorId: ctx.userId, action: "opportunity.moved", entity: "Opportunity", entityId: opp.id, metadata: { from: opp.stage, to } }, tx);
  });
  revalidatePath(`${base(slug)}/pipeline`);
  return { ok: true };
}

export async function automationAction(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireStaff(slug, "automation.write");
  assertCan(ctx.role, "automation.write");
  const parsed = AutomationConfig.safeParse({
    level: fd.get("level"),
    autoApproveMinScore: Number(fd.get("autoApproveMinScore")),
    dailyCap: Number(fd.get("dailyCap")),
    allowedCreditBands: fd.getAll("allowedCreditBands"),
  });
  if (!parsed.success) return { message: "Check the values: auto-approve score is 75 to 100, the daily cap 0 to 100." };
  const paused = fd.get("paused") === "on";
  await ctx.tdb.$transaction(async (tx) => {
    await tx.agencySettings.updateMany({ data: { automation: parsed.data as unknown as Prisma.InputJsonObject, automationPaused: paused } });
    await audit({ agencyId: ctx.agencyId, actorType: "USER", actorId: ctx.userId, action: "settings.automation_changed", entity: "AgencySettings", entityId: ctx.agencyId, metadata: { level: parsed.data.level, dailyCap: parsed.data.dailyCap, paused } }, tx);
  });
  revalidatePath(`${base(slug)}/settings`);
  return { ok: true, message: "Saved. Changes apply to the next decision, including ones already recommended." };
}
