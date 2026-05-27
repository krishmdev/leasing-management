"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/server/auth";
import { publicAgency } from "@/server/domain/agency";
import { publicUnit } from "@/server/domain/listings/queries";
import { submitInterest } from "@/server/domain/leads/service";
import { bookShowing, cancelShowing, rescheduleShowing, SlotTakenError } from "@/server/domain/showings/booking";
import { ApplicationError, saveStep, startApplication, submitApplication } from "@/server/domain/applications/service";
import { withdrawApplication } from "@/server/domain/decisions/withdraw";
import { signLease, type SignResult } from "@/server/domain/leases/sign";
import { commentOnTicket } from "@/server/domain/maintenance/tickets";
import { tenantDb } from "@/server/tenant";
import { checked, fieldErrors, formValues, type FormState } from "@/lib/forms";

async function agencyAndUnit(slug: string, unitSlug: string) {
  const agency = await publicAgency(slug);
  if (!agency) throw new Error("not found");
  const unit = await publicUnit(agency.id, unitSlug);
  if (!unit) throw new Error("not found");
  return { agency, unit };
}

const clientMeta = async () => {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1", ua: h.get("user-agent") };
};

export async function interestAction(slug: string, unitSlug: string, _: FormState, fd: FormData): Promise<FormState> {
  const { agency, unit } = await agencyAndUnit(slug, unitSlug);
  try {
    await submitInterest(agency.id, unit.id, { name: fd.get("name") as string, email: fd.get("email") as string, phone: (fd.get("phone") as string) ?? "", desiredMoveIn: fd.get("desiredMoveIn") as string, message: (fd.get("message") as string) ?? "" });
  } catch (e) {
    const errors = fieldErrors(e);
    if (errors) return { errors, values: formValues(fd), message: "Check the highlighted fields." };
    throw e;
  }
  return { ok: true, message: "Thanks. We emailed you a confirmation with a link to start your application." };
}

export async function bookAction(slug: string, unitSlug: string, _: FormState, fd: FormData): Promise<FormState> {
  const { agency, unit } = await agencyAndUnit(slug, unitSlug);
  try {
    await bookShowing(agency.id, unit.id, { name: fd.get("name") as string, email: fd.get("email") as string, phone: (fd.get("phone") as string) ?? "", start: fd.get("start") as string });
  } catch (e) {
    if (e instanceof SlotTakenError) return { message: "Someone just booked that time. Please pick another.", values: formValues(fd) };
    const errors = fieldErrors(e);
    if (errors) return { errors, values: formValues(fd), message: errors.start ? "Pick a time." : "Check the highlighted fields." };
    throw e;
  }
  return { ok: true, message: "Booked. Check your email for the confirmation and calendar invite." };
}

export async function rescheduleAction(token: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    await rescheduleShowing(token, new Date(String(fd.get("start"))));
  } catch (e) {
    if (e instanceof SlotTakenError) return { message: "That time was just taken. Pick another." };
    return { message: (e as Error).message };
  }
  revalidatePath("/");
  return { ok: true, message: "Moved. We emailed an updated invite." };
}

export async function cancelShowingAction(token: string): Promise<FormState> {
  await cancelShowing(token);
  revalidatePath("/");
  return { ok: true, message: "Canceled. We emailed a cancellation for your calendar." };
}

/** Apply entry: signed in -> start or resume the application; otherwise send a sign-in link. */
export async function applyEmailAction(slug: string, unitSlug: string, _: FormState, fd: FormData): Promise<FormState> {
  const email = z.email().safeParse(String(fd.get("email") ?? "").trim());
  if (!email.success) return { errors: { email: "Enter a valid email" }, values: formValues(fd) };
  await auth().api.signInMagicLink({ body: { email: email.data, name: String(fd.get("name") ?? "").trim() || undefined, callbackURL: `/${slug}/apply?unit=${unitSlug}` }, headers: await headers() });
  redirect(`/check-email?to=${encodeURIComponent(email.data)}`);
}

async function applicant() {
  const s = await auth().api.getSession({ headers: await headers() });
  if (!s) throw new ApplicationError("Please sign in again", 401);
  return s.user;
}

export async function beginApplication(slug: string, unitSlug: string) {
  const { agency, unit } = await agencyAndUnit(slug, unitSlug);
  const user = await applicant();
  const app = await startApplication(agency.id, unit.id, { id: user.id, email: user.email, name: user.name });
  redirect(`/${slug}/apply/${app.id}/${app.status === "DRAFT" ? app.currentStep : "status"}`);
}

function stepInput(step: number, fd: FormData) {
  if (step === 2) {
    const residences = [];
    for (let i = 0; i < 3; i++) {
      if (!fd.get(`r${i}.address`)) continue;
      residences.push({
        address: fd.get(`r${i}.address`), landlordName: fd.get(`r${i}.landlordName`) ?? "", landlordEmail: fd.get(`r${i}.landlordEmail`) ?? "",
        landlordPhone: fd.get(`r${i}.landlordPhone`) ?? "", startDate: fd.get(`r${i}.startDate`), endDate: fd.get(`r${i}.endDate`) || undefined,
        monthlyRent: fd.get(`r${i}.monthlyRent`), consentToContact: checked(fd, `r${i}.consentToContact`),
      });
    }
    return { residences };
  }
  if (step === 3) return { ...Object.fromEntries(fd), hasRentSubsidy: checked(fd, "hasRentSubsidy"), altEvidenceProvided: checked(fd, "altEvidenceProvided"), subsidyMonthly: fd.get("subsidyMonthly") || undefined };
  if (step === 4) return { fcra: checked(fd, "fcra") };
  return Object.fromEntries(fd);
}

export async function saveStepAction(slug: string, applicationId: string, step: number, _: FormState, fd: FormData): Promise<FormState> {
  const agency = await publicAgency(slug);
  if (!agency) throw new Error("not found");
  const user = await applicant();
  try {
    if (step === 5) {
      await submitApplication(agency.id, applicationId, user.id, { fcra: true, referenceContact: checked(fd, "referenceContact"), esign: checked(fd, "esign") as true, privacy: checked(fd, "privacy") as true, accurate: checked(fd, "accurate") as true }, await clientMeta());
    } else {
      await saveStep(agency.id, applicationId, user.id, step, stepInput(step, fd));
    }
  } catch (e) {
    const errors = fieldErrors(e);
    if (errors) return { errors, values: formValues(fd), message: "A few answers need attention." };
    if (e instanceof ApplicationError) return { message: e.message, values: formValues(fd) };
    throw e;
  }
  redirect(step === 5 ? `/${slug}/apply/${applicationId}/status` : `/${slug}/apply/${applicationId}/${step + 1}`);
}

export async function withdrawMine(slug: string, applicationId: string) {
  const agency = await publicAgency(slug);
  if (!agency) return;
  const user = await applicant();
  const app = await tenantDb(agency.id).application.findUnique({ where: { id: applicationId } });
  if (app?.userId !== user.id) return;
  await withdrawApplication(agency.id, applicationId, { type: "APPLICANT", id: user.id });
  revalidatePath(`/${slug}/apply/${applicationId}/status`);
}

export async function signAction(token: string, _: (FormState & { result?: SignResult }) | undefined, fd: FormData): Promise<FormState & { result?: SignResult }> {
  const result = await signLease(token, { typedName: String(fd.get("typedName") ?? ""), docSha256: String(fd.get("docSha256") ?? ""), consent: checked(fd, "consent") as true }, await clientMeta());
  return { ok: result.http === 200, message: result.http === 200 ? undefined : (result.body as { error: string }).error, result };
}

export async function residentCommentAction(slug: string, ticketId: string, _: FormState, fd: FormData): Promise<FormState> {
  const agency = await publicAgency(slug);
  if (!agency) throw new Error("not found");
  const user = await applicant();
  const t = await tenantDb(agency.id).maintenanceTicket.findUnique({ where: { id: ticketId } });
  if (!t || t.reporterUserId !== user.id) return { message: "Not your ticket." };
  try {
    await commentOnTicket(agency.id, { type: "RESIDENT", id: user.id }, ticketId, String(fd.get("body") ?? ""), false);
  } catch {
    return { message: "Write a message first." };
  }
  revalidatePath(`/${slug}/portal/tickets/${ticketId}`);
  return { ok: true, message: "Sent." };
}
