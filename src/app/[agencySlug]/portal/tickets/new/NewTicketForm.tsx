"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Checkbox, Field, Input, Textarea, buttonClass } from "@/components/ui";

export function NewTicketForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ id: string; urgency: string; instructions: string | null } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("agency", slug);
    const res = await fetch("/api/portal/tickets", { method: "POST", body: fd });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error);
      setErrors(body.errors ?? {});
      return;
    }
    setDone(body);
  }

  if (done) {
    return (
      <div className="mt-8 space-y-4">
        {done.urgency === "EMERGENCY" ? (
          <Alert tone="bad" title="Marked as an emergency">{done.instructions}</Alert>
        ) : (
          <Alert tone="ok" title="Request received">We&apos;ll be in touch. You can follow it from the portal.</Alert>
        )}
        <button onClick={() => router.push(`/${slug}/portal/tickets/${done.id}`)} className={buttonClass("brand", "lg", "rounded-xl")}>View request</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5 rounded-3xl bg-surface p-6 ring-1 ring-black/5" noValidate>
      {error && <Alert tone="bad">{error}</Alert>}
      <Field label="What needs fixing?" htmlFor="title" error={errors.title}><Input id="title" name="title" placeholder="e.g. Kitchen sink is leaking" /></Field>
      <Field label="Details" htmlFor="description" error={errors.description} hint="Where is it, when did it start, is it getting worse?"><Textarea id="description" name="description" /></Field>
      <Field label="Photos (optional, up to 5)" htmlFor="photos" hint="JPEG, PNG or WebP, 10 MB each. Location data is removed.">
        <input id="photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple className="block w-full text-sm" />
      </Field>
      <Checkbox id="permissionToEnter" name="permissionToEnter" label="Maintenance may enter if I'm not home" />
      <button disabled={busy} className={buttonClass("brand", "lg", "w-full rounded-xl")}>{busy ? "Sending…" : "Send request"}</button>
    </form>
  );
}
