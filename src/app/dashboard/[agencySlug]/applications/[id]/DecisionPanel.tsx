"use client";

import { useState } from "react";
import { ActionForm } from "@/components/forms/ActionForm";
import { Card, CardHeader, Field, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { decideAction } from "../../actions";

const OPTIONS = [
  { v: "APPROVE", label: "Approve", hint: "Places a 72-hour hold and sends the lease." },
  { v: "CONDITIONAL", label: "Conditional", hint: "Approve with the listed conditions (guarantor)." },
  { v: "DECLINE", label: "Decline", hint: "Sends an FCRA adverse-action notice." },
] as const;

export function DecisionPanel({
  slug,
  applicationId,
  status,
  recommended,
  decided,
  reasons,
  suggested,
}: {
  slug: string;
  applicationId: string;
  status: string;
  recommended: string | null;
  decided: { outcome: string; by: string; mode: string; overrode: boolean; reason: string | null; at: string } | null;
  reasons: { code: string; text: string; basis: string }[];
  suggested: string[];
}) {
  const initial = recommended && recommended !== "NEEDS_REVIEW" ? recommended : "";
  const [choice, setChoice] = useState(initial);
  if (decided) {
    return (
      <Card>
        <CardHeader title="Decision" />
        <div className="space-y-1 p-4 text-[13px]">
          <p className="font-medium">{decided.outcome.toLowerCase()} by {decided.by === "AGENT" ? "the agent (autonomous)" : "staff"} · {decided.mode.toLowerCase()}</p>
          {decided.overrode && <p className="text-warn">Overrode the recommendation: {decided.reason}</p>}
          <p className="text-muted">{new Date(decided.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}</p>
        </div>
      </Card>
    );
  }
  if (status !== "DECISION_PENDING") {
    return (
      <Card>
        <CardHeader title="Decision" />
        <p className="p-4 text-[13px] text-muted">Available once the agent has a recommendation.</p>
      </Card>
    );
  }
  const overriding = !!choice && !!recommended && recommended !== "NEEDS_REVIEW" && choice !== recommended;
  return (
    <Card>
      <CardHeader title="Decide" sub="Declines are never automatic; they always come through here." />
      <ActionForm action={decideAction.bind(null, slug, applicationId)} className="space-y-3 p-4">
        {(s) =>
          s?.ok ? null : (
            <>
              <fieldset className="space-y-1.5">
                <legend className="sr-only">Outcome</legend>
                {OPTIONS.map((o) => (
                  <label key={o.v} className={`flex cursor-pointer gap-2.5 rounded-md border p-2.5 ${choice === o.v ? "border-ink bg-paper" : "border-line"}`}>
                    <input type="radio" name="outcome" value={o.v} checked={choice === o.v} onChange={() => setChoice(o.v)} className="mt-0.5 accent-[color:var(--ink)]" />
                    <span>
                      <span className="text-[13px] font-medium">{o.label}{recommended === o.v && <span className="ml-1.5 text-2xs text-muted">recommended</span>}</span>
                      <span className="block text-2xs text-muted">{o.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {(choice === "DECLINE" || choice === "CONDITIONAL") && (
                <fieldset className="rounded-md border border-line p-2.5">
                  <legend className="px-1 text-2xs font-semibold uppercase tracking-wide text-muted">Reasons for the applicant&apos;s notice</legend>
                  <div className="space-y-1">
                    {reasons.map((r) => (
                      <label key={r.code} className="flex gap-2 text-[13px]">
                        <input type="checkbox" name="reason" value={r.code} defaultChecked={suggested.includes(r.code)} className="mt-0.5" />
                        <span>{r.text} <span className="text-2xs text-muted">({r.basis.toLowerCase().replace("_", " ")})</span></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {(overriding || recommended === "NEEDS_REVIEW") && (
                <Field label={overriding ? "Why are you overriding the recommendation?" : "Review note"} htmlFor="overrideReason" hint="Stored with the decision and shown in the audit log.">
                  <Textarea id="overrideReason" name="overrideReason" required={overriding} className="min-h-16" />
                </Field>
              )}
              <SubmitButton className="w-full" disabled={!choice} pendingLabel="Recording…">Record decision</SubmitButton>
            </>
          )
        }
      </ActionForm>
    </Card>
  );
}
