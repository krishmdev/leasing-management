"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm } from "@/components/forms/ActionForm";
import { Checkbox, Field, Input, Select } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { saveStepAction } from "../../../actions";
import type { FormState } from "@/lib/forms";

interface Residence { address: string; landlordName: string; landlordEmail: string; landlordPhone: string; startDate: string; endDate: string; monthlyRent: string; consentToContact: boolean }
interface Values { legalName: string; phone: string; desiredMoveIn: string; totalOccupants: string; incomeType: string; monthlyIncome: string; hasRentSubsidy: boolean; subsidyMonthly: string; altEvidenceProvided: boolean; residences: Residence[] }

const blank: Residence = { address: "", landlordName: "", landlordEmail: "", landlordPhone: "", startDate: "", endDate: "", monthlyRent: "", consentToContact: true };

export function StepForm({ slug, applicationId, step, values, fcraText, agencyName }: { slug: string; applicationId: string; step: number; values: Values; fcraText: string; agencyName: string }) {
  const [residences, setResidences] = useState<Residence[]>(values.residences.length ? values.residences : [blank]);
  const [subsidy, setSubsidy] = useState(values.hasRentSubsidy);
  const back = step > 1 ? `/${slug}/apply/${applicationId}/${step - 1}` : null;
  const v = (s: FormState, k: string, fallback: string) => s?.values?.[k] ?? fallback;

  return (
    <ActionForm action={saveStepAction.bind(null, slug, applicationId, step)} className="mt-6 space-y-5 rounded-3xl bg-surface p-6 ring-1 ring-black/5 md:p-8">
      {(s) => {
        const err = (k: string) => s?.errors?.[k];
        return (
          <>
            {step === 1 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full legal name" htmlFor="legalName" error={err("legalName")} className="sm:col-span-2" hint="As it appears on your ID; the screening company matches on it.">
                  <Input id="legalName" name="legalName" autoComplete="name" defaultValue={v(s, "legalName", values.legalName)} aria-invalid={!!err("legalName")} />
                </Field>
                <Field label="Phone" htmlFor="phone" error={err("phone")}><Input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={v(s, "phone", values.phone)} /></Field>
                <Field label="Move-in date" htmlFor="desiredMoveIn" error={err("desiredMoveIn")}><Input id="desiredMoveIn" name="desiredMoveIn" type="date" defaultValue={v(s, "desiredMoveIn", values.desiredMoveIn)} /></Field>
                <Field label="How many people will live here?" htmlFor="totalOccupants" error={err("totalOccupants")} hint="Only used to check occupancy limits. It's never part of the screening score.">
                  <Input id="totalOccupants" name="totalOccupants" type="number" min={1} max={12} defaultValue={v(s, "totalOccupants", values.totalOccupants)} />
                </Field>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <p className="text-sm text-ink-2">List where you&apos;ve lived in the last few years, most recent first. If you rented, we&apos;ll ask the landlord for a short reference.</p>
                {err("residences") && <p role="alert" className="text-sm text-bad">{err("residences")}</p>}
                {residences.map((r, i) => (
                  <fieldset key={i} className="space-y-3 rounded-2xl border border-black/10 p-4">
                    <legend className="px-1 text-sm font-semibold">{i === 0 ? "Current or most recent home" : `Previous home ${i}`}</legend>
                    <Field label="Address" htmlFor={`r${i}.address`} error={err(`residences.${i}.address`)}><Input id={`r${i}.address`} name={`r${i}.address`} defaultValue={r.address} /></Field>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Moved in" htmlFor={`r${i}.startDate`} error={err(`residences.${i}.startDate`)}><Input id={`r${i}.startDate`} name={`r${i}.startDate`} type="date" defaultValue={r.startDate} /></Field>
                      <Field label="Moved out" htmlFor={`r${i}.endDate`} hint="Blank if you live there now"><Input id={`r${i}.endDate`} name={`r${i}.endDate`} type="date" defaultValue={r.endDate} /></Field>
                      <Field label="Monthly rent ($)" htmlFor={`r${i}.monthlyRent`} error={err(`residences.${i}.monthlyRent`)}><Input id={`r${i}.monthlyRent`} name={`r${i}.monthlyRent`} inputMode="decimal" defaultValue={r.monthlyRent} /></Field>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Landlord or manager" htmlFor={`r${i}.landlordName`}><Input id={`r${i}.landlordName`} name={`r${i}.landlordName`} defaultValue={r.landlordName} /></Field>
                      <Field label="Their email" htmlFor={`r${i}.landlordEmail`} error={err(`residences.${i}.landlordEmail`)}><Input id={`r${i}.landlordEmail`} name={`r${i}.landlordEmail`} type="email" defaultValue={r.landlordEmail} /></Field>
                      <Field label="Their phone" htmlFor={`r${i}.landlordPhone`}><Input id={`r${i}.landlordPhone`} name={`r${i}.landlordPhone`} type="tel" defaultValue={r.landlordPhone} /></Field>
                    </div>
                    <Checkbox id={`r${i}.consentToContact`} name={`r${i}.consentToContact`} defaultChecked={r.consentToContact} label="You may contact this landlord for a reference." />
                  </fieldset>
                ))}
                {residences.length < 3 && <button type="button" onClick={() => setResidences([...residences, blank])} className="text-sm font-medium text-brand">+ Add a previous home</button>}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Main income source" htmlFor="incomeType">
                    <Select id="incomeType" name="incomeType" defaultValue={v(s, "incomeType", values.incomeType)}>
                      <option value="EMPLOYMENT">Employment</option>
                      <option value="SELF_EMPLOYMENT">Self-employment</option>
                      <option value="BENEFITS">Benefits or pension</option>
                      <option value="OTHER">Other</option>
                    </Select>
                  </Field>
                  <Field label="Total monthly income before tax ($)" htmlFor="monthlyIncome" error={err("monthlyIncome")}><Input id="monthlyIncome" name="monthlyIncome" inputMode="decimal" defaultValue={v(s, "monthlyIncome", values.monthlyIncome)} /></Field>
                </div>
                <div className="rounded-2xl bg-paper p-4">
                  <Checkbox id="hasRentSubsidy" name="hasRentSubsidy" checked={subsidy} onChange={(e) => setSubsidy(e.target.checked)} label="Part of my rent is paid by a voucher or other rental assistance" />
                  {subsidy && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Monthly amount the program pays ($)" htmlFor="subsidyMonthly" error={err("subsidyMonthly")} hint="We compare your income to your share of the rent only.">
                        <Input id="subsidyMonthly" name="subsidyMonthly" inputMode="decimal" defaultValue={v(s, "subsidyMonthly", values.subsidyMonthly)} />
                      </Field>
                      <div className="pt-7"><Checkbox id="altEvidenceProvided" name="altEvidenceProvided" defaultChecked={values.altEvidenceProvided} label="I'd like to show proof of ability to pay (like bank statements or rent receipts) instead of a credit check (California SB 267)." /></div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <div className="rounded-2xl bg-paper p-4 text-sm leading-relaxed text-ink-2">
                  <p className="font-semibold text-ink">Disclosure: consumer report</p>
                  <p className="mt-2">{agencyName} will get a consumer report (credit, eviction and collection history) about you from an independent screening company to evaluate this application. You have the right to know if information in it leads to a decision against you, and to get a free copy of the report within 60 days.</p>
                  <p className="mt-2">The screening company will email you a link to its own secure site, where you&apos;ll enter your Social Security number and date of birth. {agencyName} never receives either.</p>
                </div>
                <Checkbox id="fcra" name="fcra" label={fcraText} />
                {err("fcra") && <p role="alert" className="text-sm text-bad">{err("fcra")}</p>}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-3">
                <p className="text-sm text-ink-2">Once you submit, your answers are locked and we start the screening and reference checks. You can still withdraw at any time.</p>
                <Checkbox id="referenceContact" name="referenceContact" defaultChecked label="Contact the landlords I listed for references." />
                <Checkbox id="esign" name="esign" label="I agree to use electronic records and signatures." />
                <Checkbox id="privacy" name="privacy" label="I've read how my information is used, encrypted and deleted." />
                <Checkbox id="accurate" name="accurate" label="My answers are true and complete." />
                {["esign", "privacy", "accurate"].map((k) => err(k) && <p key={k} role="alert" className="text-sm text-bad">{err(k)}</p>)}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              {back ? <Link href={back} className="text-sm text-ink-2 underline-offset-4 hover:underline">← Back</Link> : <span />}
              <SubmitButton variant="brand" size="lg" className="rounded-xl" pendingLabel="Saving…">{step === 5 ? "Submit application" : "Save and continue"}</SubmitButton>
            </div>
          </>
        );
      }}
    </ActionForm>
  );
}
