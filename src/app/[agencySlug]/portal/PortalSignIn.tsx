"use client";

import { ActionForm } from "@/components/forms/ActionForm";
import { Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { sendMagicLink } from "@/app/(auth)/login/actions";

export function PortalSignIn({ slug }: { slug: string }) {
  return (
    <ActionForm action={sendMagicLink} className="mt-6 space-y-4 rounded-3xl bg-surface p-6 ring-1 ring-black/5">
      {(s) => (
        <>
          <input type="hidden" name="next" value={`/${slug}/portal`} />
          <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" defaultValue={s?.values?.email} /></Field>
          <SubmitButton variant="brand" size="lg" className="w-full rounded-xl" pendingLabel="Sending…">Email me a sign-in link</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
