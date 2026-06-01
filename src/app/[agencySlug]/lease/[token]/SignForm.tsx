"use client";

import { useActionState } from "react";
import { Checkbox, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { signAction } from "../../actions";

export function SignForm({
  token,
  docSha256,
  signed,
  deadline,
  statusHref,
  signedCopyHref,
  tz,
}: {
  token: string;
  docSha256: string | null;
  signed: { signatureId: string; signedAt: string } | null;
  deadline: string;
  statusHref: string;
  signedCopyHref: string | null;
  tz: string;
}) {
  const [state, action] = useActionState(signAction.bind(null, token), undefined);
  const done = signed ?? (state?.result?.http === 200 ? (state.result.body as { signatureId: string; signedAt: string }) : null);
  if (done) {
    return (
      <div role="status" className="rounded-2xl bg-brand p-6 text-brand-ink" data-testid="signed">
        <p className="display text-2xl font-semibold">Signed</p>
        <p className="mt-1 text-sm opacity-85">Signed {signedLabel(done.signedAt, tz)}.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {signedCopyHref ? (
            <a href={signedCopyHref} className="inline-flex min-h-10 items-center rounded-full bg-brand-ink px-4 text-sm font-semibold text-brand">Download signed copy</a>
          ) : (
            <p className="text-sm opacity-85">The signed copy with its certificate page will be ready in a minute.</p>
          )}
          <a href={statusHref} className="inline-flex min-h-10 items-center rounded-full px-4 text-sm font-medium ring-1 ring-current">Your application</a>
        </div>
        <p className="mt-3 font-mono text-2xs opacity-70">signature {done.signatureId}</p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4 rounded-2xl bg-surface p-6 ring-1 ring-black/5">
      <p className="text-sm text-ink-2">Sign by {deadline}, when your hold ends.</p>
      {docSha256 && <input type="hidden" name="docSha256" value={docSha256} />}
      <Field label="Type your full legal name" htmlFor="typedName"><Input id="typedName" name="typedName" autoComplete="name" /></Field>
      <Checkbox id="consent" name="consent" label="I've read the lease and agree to sign it electronically." />
      {state?.message && <p role="alert" className="text-sm text-bad">{state.message}</p>}
      <SubmitButton variant="brand" size="lg" className="w-full rounded-xl" disabled={!docSha256} pendingLabel="Signing…">Sign lease</SubmitButton>
      {docSha256 && <p className="break-all font-mono text-2xs text-muted">Document SHA-256 {docSha256}</p>}
    </form>
  );
}

/** "September 25 at 5:47 PM" in the agency's time zone. */
function signedLabel(iso: string, tz: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { timeZone: tz, month: "long", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}
