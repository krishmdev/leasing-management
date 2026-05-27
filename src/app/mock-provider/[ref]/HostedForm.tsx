"use client";

import { useActionState, useState } from "react";
import { completeScreeningAction } from "./actions";

/**
 * SSN and DOB inputs have no `name`, so they aren't part of the submitted form data. They exist
 * to show where a real provider would take them; the e2e suite types a value and asserts it
 * never appears in any request body.
 */
export function HostedForm({ ref_, personas }: { ref_: string; personas: { key: string; label: string }[] }) {
  const [state, action, pending] = useActionState(completeScreeningAction.bind(null, ref_), undefined);
  const [ssn, setSsn] = useState("");
  const [dob, setDob] = useState("");
  const ssnOk = /^\d{3}-?\d{2}-?\d{4}$/.test(ssn);
  if (state?.ok) return <p role="status" className="mt-8 rounded-lg bg-white p-5 shadow-sm">{state.message}</p>;
  return (
    <form action={action} className="mt-8 space-y-6 rounded-lg bg-white p-6 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Social Security number
          <input value={ssn} onChange={(e) => setSsn(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="123-45-6789" data-testid="ssn" aria-describedby="ssn-note" className="mt-1 h-10 w-full rounded border border-[#b9c6d4] px-3 font-mono" />
        </label>
        <label className="block text-sm font-medium">
          Date of birth
          <input value={dob} onChange={(e) => setDob(e.target.value)} type="date" data-testid="dob" className="mt-1 h-10 w-full rounded border border-[#b9c6d4] px-3" />
        </label>
      </div>
      <p id="ssn-note" className="text-xs text-[#3b5068]">In this demo these two fields stay in your browser and are never sent anywhere, including to us.</p>
      <fieldset>
        <legend className="text-sm font-medium">Demo scenario (what the simulated bureau returns)</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {personas.map((p, i) => (
            <label key={p.key} className="flex cursor-pointer items-center gap-2 rounded border border-[#d5dee8] px-3 py-2 text-sm has-[:checked]:border-[#0b2239] has-[:checked]:bg-[#eef3f8]">
              <input type="radio" name="persona" value={p.key} defaultChecked={i === 0} /> {p.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" className="mt-1" /> I authorize MockCRA to prepare a tenant screening report and share a summary with the requesting property manager.
      </label>
      {state && !state.ok && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
      <button disabled={pending || !ssnOk || !dob} className="h-11 w-full rounded bg-[#0b2239] font-semibold text-white disabled:opacity-40">{pending ? "Verifying…" : "Verify and authorize"}</button>
    </form>
  );
}
