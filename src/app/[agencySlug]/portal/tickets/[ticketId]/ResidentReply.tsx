"use client";

import { ActionForm } from "@/components/forms/ActionForm";
import { Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { residentCommentAction } from "../../../actions";

export function ResidentReply({ slug, ticketId }: { slug: string; ticketId: string }) {
  return (
    <ActionForm action={residentCommentAction.bind(null, slug, ticketId)} className="mt-6 space-y-2">
      {() => (
        <>
          <label htmlFor="body" className="sr-only">Message</label>
          <Textarea id="body" name="body" placeholder="Add a note for maintenance" />
          <SubmitButton variant="brand" className="rounded-xl">Send</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
