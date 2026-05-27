"use server";

import { submitReference, ReferenceClosed } from "@/server/domain/references/service";
import { checked, fieldErrors, formValues, type FormState } from "@/lib/forms";

export async function referenceAction(token: string, _: FormState, fd: FormData): Promise<FormState> {
  try {
    await submitReference(token, {
      paidOnTime: fd.get("paidOnTime") as "ALWAYS", lateCount: Number(fd.get("lateCount") ?? 0), leaseViolations: checked(fd, "leaseViolations"), noticeGiven: checked(fd, "noticeGiven"),
      propertyCondition: Number(fd.get("propertyCondition")), wouldRentAgain: fd.get("wouldRentAgain") as "YES", freeText: String(fd.get("freeText") ?? ""),
      respondentRole: (fd.get("respondentRole") as "OWNER") ?? "OWNER", attestation: checked(fd, "attestation") as true,
    });
  } catch (e) {
    if (e instanceof ReferenceClosed) return { message: e.message };
    const errors = fieldErrors(e);
    if (errors) return { errors, values: formValues(fd), message: "Please answer each question." };
    throw e;
  }
  return { ok: true, message: "Thank you. Your reference was sent to the leasing office." };
}
