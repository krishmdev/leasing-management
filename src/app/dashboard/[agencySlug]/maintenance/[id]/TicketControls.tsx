"use client";

import { ActionForm } from "@/components/forms/ActionForm";
import { Card, CardHeader, Checkbox, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { assignTicketAction, ticketCommentAction, ticketStatusAction } from "../../actions";
import type { TicketStatus } from "@/server/domain/maintenance/stateMachine";

const LABEL: Record<string, string> = { TRIAGED: "Mark triaged", ASSIGNED: "Assign", IN_PROGRESS: "Start work", ON_HOLD: "Put on hold", RESOLVED: "Resolve", CLOSED: "Close", CANCELED: "Cancel" };

export function TicketControls({ slug, ticketId, next, assignee, staff }: { slug: string; ticketId: string; next: TicketStatus[]; assignee: string | null; staff: { id: string; name: string }[] }) {
  return (
    <>
      <Card>
        <CardHeader title="Work" />
        <div className="space-y-4 p-4">
          <ActionForm action={assignTicketAction.bind(null, slug, ticketId)} className="flex gap-2">
            {() => (
              <>
                <label htmlFor="assignee" className="sr-only">Assignee</label>
                <Select id="assignee" name="assignee" defaultValue={assignee ?? ""} className="h-9">
                  <option value="" disabled>Choose someone</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
                <SubmitButton variant="secondary">Assign</SubmitButton>
              </>
            )}
          </ActionForm>
          <div className="flex flex-wrap gap-2">
            {next.filter((s) => s !== "ASSIGNED").map((s) => (
              <ActionForm key={s} action={ticketStatusAction.bind(null, slug, ticketId, s)}>
                {() => <SubmitButton variant={s === "RESOLVED" ? "primary" : "secondary"} size="sm">{LABEL[s] ?? s}</SubmitButton>}
              </ActionForm>
            ))}
            {next.length === 0 && <p className="text-[13px] text-muted">No further steps.</p>}
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Message" />
        <ActionForm action={ticketCommentAction.bind(null, slug, ticketId)} className="space-y-2 p-4">
          {() => (
            <>
              <label htmlFor="body" className="sr-only">Message</label>
              <Textarea id="body" name="body" placeholder="Update for the resident, or an internal note" className="min-h-20" />
              <div className="flex items-center justify-between">
                <Checkbox id="internal" name="internal" label="Internal note" />
                <SubmitButton size="sm">Post</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Card>
    </>
  );
}
