"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { FormState } from "@/lib/forms";

type Act = (s: FormState, fd: FormData) => Promise<FormState>;

function Done({ message, next }: { message: string; next?: { href: string; label: string } }) {
  return (
    <div role="status" className="rounded-3xl bg-surface p-8 text-center ring-1 ring-black/5">
      <p className="display text-3xl font-semibold">All set</p>
      <p className="mt-2 text-ink-2">{message}</p>
      {next && <a href={next.href} className="mt-6 inline-block rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-ink">{next.label}</a>}
    </div>
  );
}

function Contact({ s }: { s: FormState }) {
  const err = (k: string) => s?.errors?.[k];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" htmlFor="name" error={err("name")} className="sm:col-span-2">
        <Input id="name" name="name" autoComplete="name" defaultValue={s?.values?.name} aria-invalid={!!err("name")} required />
      </Field>
      <Field label="Email" htmlFor="email" error={err("email")}>
        <Input id="email" name="email" type="email" autoComplete="email" defaultValue={s?.values?.email} aria-invalid={!!err("email")} required />
      </Field>
      <Field label="Phone (optional)" htmlFor="phone">
        <Input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={s?.values?.phone} />
      </Field>
    </div>
  );
}

export function InterestForm({ action, minDate, applyHref }: { action: Act; minDate: string; applyHref: string }) {
  return (
    <ActionForm action={action} className="space-y-5 rounded-3xl bg-surface p-6 ring-1 ring-black/5 md:p-8">
      {(s) =>
        s?.ok ? (
          <Done message={s.message!} next={{ href: applyHref, label: "Start my application" }} />
        ) : (
          <>
            <Contact s={s} />
            <Field label="Ideal move-in date" htmlFor="desiredMoveIn" error={s?.errors?.desiredMoveIn}>
              <Input id="desiredMoveIn" name="desiredMoveIn" type="date" min={minDate} defaultValue={s?.values?.desiredMoveIn} required />
            </Field>
            <Field label="Anything we should know? (optional)" htmlFor="message" hint="Please don't include your SSN, date of birth or anything about your household. We don't need it.">
              <Textarea id="message" name="message" defaultValue={s?.values?.message} />
            </Field>
            <SubmitButton variant="brand" size="lg" className="w-full rounded-xl" pendingLabel="Sending…">Send</SubmitButton>
          </>
        )
      }
    </ActionForm>
  );
}

export function SlotPicker({ slots, tz, name = "start", initial }: { slots: string[]; tz: string; name?: string; initial?: string }) {
  const days = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots) {
      const k = new Date(s).toLocaleDateString("en-CA", { timeZone: tz });
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [slots, tz]);
  const [day, setDay] = useState(days[0]?.[0] ?? "");
  const [pick, setPick] = useState(initial ?? "");
  if (!days.length) return <p className="rounded-xl bg-paper p-4 text-sm text-ink-2">No open times in the next three weeks. Send us a note instead and we&apos;ll find a time.</p>;
  const dayLabel = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <div>
      <input type="hidden" name={name} value={pick} />
      <div role="tablist" aria-label="Day" className="flex gap-2 overflow-x-auto pb-2">
        {days.map(([k, list]) => (
          <button type="button" key={k} role="tab" aria-selected={day === k} onClick={() => setDay(k)} className={`shrink-0 rounded-xl px-3 py-2 text-left text-sm ring-1 ${day === k ? "bg-ink text-white ring-ink" : "bg-surface ring-black/10"}`}>
            <span className="block font-medium">{dayLabel(k)}</span>
            <span className="text-xs opacity-70">{list.length} times</span>
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="Time" className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {(days.find(([k]) => k === day)?.[1] ?? []).map((s) => (
          <button type="button" role="radio" aria-checked={pick === s} key={s} onClick={() => setPick(s)} className={`rounded-lg py-2 text-sm font-medium ring-1 ${pick === s ? "bg-brand text-brand-ink ring-brand" : "bg-surface ring-black/10 hover:ring-black/30"}`}>
            {new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ScheduleForm({ action, slots, tz, applyHref }: { action: Act; slots: string[]; tz: string; applyHref: string }) {
  return (
    <ActionForm action={action} className="space-y-6 rounded-3xl bg-surface p-6 ring-1 ring-black/5 md:p-8">
      {(s) =>
        s?.ok ? (
          <Done message={s.message!} next={{ href: applyHref, label: "Apply now" }} />
        ) : (
          <>
            <div>
              <p className="mb-3 font-semibold">Pick a time <span className="text-sm font-normal text-muted">(Pacific time, 30 minutes)</span></p>
              <SlotPicker slots={slots} tz={tz} initial={s?.values?.start} />
            </div>
            <Contact s={s} />
            <SubmitButton variant="brand" size="lg" className="w-full rounded-xl" pendingLabel="Booking…">Book showing</SubmitButton>
          </>
        )
      }
    </ActionForm>
  );
}
