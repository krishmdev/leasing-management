"use client";

import { ActionForm } from "@/components/forms/ActionForm";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { referenceAction } from "./actions";

function Choice({ name, options, legend, err }: { name: string; options: [string, string][]; legend: string; err?: string }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <label key={v} className="cursor-pointer rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white">
            <input type="radio" name={name} value={v} className="sr-only" /> {l}
          </label>
        ))}
      </div>
      {err && <p role="alert" className="mt-1 text-xs text-bad">{err}</p>}
    </fieldset>
  );
}

export function ReferenceForm({ token }: { token: string }) {
  return (
    <ActionForm action={referenceAction.bind(null, token)} successBanner={false} className="mt-8 space-y-5 rounded-xl bg-surface p-6 ring-1 ring-line">
      {(s) =>
        s?.ok ? (
          <p role="status" className="text-center">{s.message}</p>
        ) : (
          <>
            <Choice name="paidOnTime" legend="Did they pay rent on time?" options={[["ALWAYS", "Always"], ["MOSTLY", "Mostly"], ["RARELY", "Rarely"]]} err={s?.errors?.paidOnTime} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Roughly how many late payments?" htmlFor="lateCount"><Input id="lateCount" name="lateCount" type="number" min={0} defaultValue={0} /></Field>
              <Field label="Condition at move-out (1–5)" htmlFor="propertyCondition" error={s?.errors?.propertyCondition}>
                <Select id="propertyCondition" name="propertyCondition" defaultValue="">
                  <option value="" disabled>Choose</option>
                  <option value="5">5 · Excellent</option><option value="4">4 · Good</option><option value="3">3 · Normal wear</option><option value="2">2 · Some damage</option><option value="1">1 · Significant damage</option>
                </Select>
              </Field>
            </div>
            <Choice name="wouldRentAgain" legend="Would you rent to them again?" options={[["YES", "Yes"], ["MAYBE", "Maybe"], ["NO", "No"]]} err={s?.errors?.wouldRentAgain} />
            <div className="flex flex-wrap gap-5">
              <Checkbox id="noticeGiven" name="noticeGiven" defaultChecked label="Gave proper notice before moving out" />
              <Checkbox id="leaseViolations" name="leaseViolations" label="Had lease violations" />
            </div>
            <Field label="Anything else about their tenancy? (optional)" htmlFor="freeText" hint="Personal details are removed automatically before this is read.">
              <Textarea id="freeText" name="freeText" />
            </Field>
            <Field label="You are the" htmlFor="respondentRole">
              <Select id="respondentRole" name="respondentRole" defaultValue="OWNER"><option value="OWNER">Owner</option><option value="PROPERTY_MANAGER">Property manager</option><option value="OTHER">Other</option></Select>
            </Field>
            <Checkbox id="attestation" name="attestation" label="The information above is accurate to the best of my knowledge." />
            {s?.errors?.attestation && <p role="alert" className="text-xs text-bad">{s.errors.attestation}</p>}
            <SubmitButton className="w-full" pendingLabel="Sending…">Send reference</SubmitButton>
          </>
        )
      }
    </ActionForm>
  );
}
