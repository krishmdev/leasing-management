"use client";

import { ActionForm } from "@/components/forms/ActionForm";
import { Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { applyEmailAction } from "../actions";

export function ApplyStart({ slug, unitSlug }: { slug: string; unitSlug: string }) {
  return (
    <ActionForm action={applyEmailAction.bind(null, slug, unitSlug)} className="space-y-4">
      {(s) => (
        <>
          <p className="text-ink-2">We&apos;ll email you a one-time link to open your application. No password to remember.</p>
          <Field label="Your name" htmlFor="name"><Input id="name" name="name" autoComplete="name" defaultValue={s?.values?.name} /></Field>
          <Field label="Email" htmlFor="email" error={s?.errors?.email}><Input id="email" name="email" type="email" autoComplete="email" defaultValue={s?.values?.email} aria-invalid={!!s?.errors?.email} /></Field>
          <SubmitButton variant="brand" size="lg" className="w-full rounded-xl" pendingLabel="Sending…">Email me a link</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
