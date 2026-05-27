"use client";

import { useActionState } from "react";
import { ActionForm } from "@/components/forms/ActionForm";
import { SlotPicker } from "@/components/site/PublicForms";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { cancelShowingAction, rescheduleAction } from "../../actions";

export function ManageShowing({ token, slots, tz }: { token: string; slots: string[]; tz: string }) {
  const [canceled, cancel, pending] = useActionState(cancelShowingAction.bind(null, token), undefined);
  if (canceled?.ok) return <p role="status" className="mt-8 rounded-2xl bg-surface p-6 ring-1 ring-black/5">{canceled.message}</p>;
  return (
    <div className="mt-8 space-y-6">
      <ActionForm action={rescheduleAction.bind(null, token)} className="space-y-4 rounded-3xl bg-surface p-6 ring-1 ring-black/5">
        {() => (
          <>
            <p className="font-semibold">Pick a new time</p>
            <SlotPicker slots={slots} tz={tz} />
            <SubmitButton variant="brand" className="rounded-xl">Reschedule</SubmitButton>
          </>
        )}
      </ActionForm>
      <form action={cancel}>
        <button disabled={pending} className="text-sm text-bad underline underline-offset-4">Cancel this showing</button>
      </form>
    </div>
  );
}
