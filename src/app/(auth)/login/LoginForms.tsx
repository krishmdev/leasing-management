"use client";

import { useState } from "react";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { sendMagicLink, staffSignIn } from "./actions";

export function LoginForms({ next }: { next: string }) {
  const [tab, setTab] = useState<"staff" | "link">("staff");
  return (
    <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
      <div role="tablist" aria-label="Sign-in method" className="mb-5 grid grid-cols-2 rounded-lg bg-paper p-1 text-sm">
        {(["staff", "link"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md py-1.5 font-medium ${tab === t ? "bg-surface shadow-sm" : "text-muted"}`}>
            {t === "staff" ? "Agency staff" : "Applicant or resident"}
          </button>
        ))}
      </div>
      {tab === "staff" ? (
        <ActionForm action={staffSignIn} className="space-y-4">
          {(s) => (
            <>
              <input type="hidden" name="next" value={next} />
              <Field label="Email" htmlFor="email">
                <Input id="email" name="email" type="email" autoComplete="username" defaultValue={s?.values?.email} required />
              </Field>
              <Field label="Password" htmlFor="password">
                <Input id="password" name="password" type="password" autoComplete="current-password" required />
              </Field>
              <SubmitButton className="w-full" pendingLabel="Signing in…">Sign in</SubmitButton>
            </>
          )}
        </ActionForm>
      ) : (
        <ActionForm action={sendMagicLink} className="space-y-4">
          {(s) => (
            <>
              <input type="hidden" name="next" value={next} />
              <p className="text-sm text-ink-2">We&apos;ll email you a one-time sign-in link. No password needed.</p>
              <Field label="Email" htmlFor="ml-email">
                <Input id="ml-email" name="email" type="email" autoComplete="email" defaultValue={s?.values?.email} required />
              </Field>
              <SubmitButton className="w-full" pendingLabel="Sending…">Email me a link</SubmitButton>
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}
