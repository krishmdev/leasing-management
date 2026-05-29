"use client";

import { useActionState } from "react";
import { Button, Card, CardHeader, Select } from "@/components/ui";
import { revealAction } from "../../actions";

export function RevealPanel({ slug, applicationId }: { slug: string; applicationId: string }) {
  const [state, action, pending] = useActionState(revealAction.bind(null, slug, applicationId), undefined);
  const pii = state?.pii;
  return (
    <Card>
      <CardHeader title="Applicant details" sub="Encrypted at rest. Revealing is logged with your reason." />
      <div className="p-4 text-[13px]">
        {pii ? (
          <dl className="space-y-1">
            <div className="flex justify-between gap-4"><dt className="text-muted">Legal name</dt><dd>{pii.legalName}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Email</dt><dd className="break-all">{pii.email}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Phone</dt><dd>{pii.phone}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Occupants</dt><dd>{pii.totalOccupants} <span className="text-2xs text-muted">(occupancy limits only, never scored)</span></dd></div>
            {pii.residences.map((r) => (
              <div key={r.id} className="mt-2 rounded border border-line p-2 text-2xs">
                <p>{r.address}</p>
                <p className="text-muted">Landlord {r.landlordName ?? "—"} · {r.landlordEmail ?? "—"}</p>
              </div>
            ))}
          </dl>
        ) : (
          <form action={action} className="flex gap-2">
            <label htmlFor="purpose" className="sr-only">Reason</label>
            <Select id="purpose" name="purpose" defaultValue="" className="h-9" required>
              <option value="" disabled>Why do you need this?</option>
              <option value="CONTACT_APPLICANT">Contact the applicant</option>
              <option value="VERIFY_IDENTITY">Verify identity</option>
              <option value="PREPARE_LEASE">Prepare the lease</option>
              <option value="RESPOND_TO_DISPUTE">Respond to a dispute</option>
              <option value="LEGAL_REQUEST">Legal request</option>
            </Select>
            <Button disabled={pending} variant="secondary" size="md">Reveal</Button>
          </form>
        )}
        {state?.message && !state.ok && <p role="alert" className="mt-2 text-2xs text-bad">{state.message}</p>}
      </div>
    </Card>
  );
}
