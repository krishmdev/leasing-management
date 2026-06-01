import { Check, Pause } from "lucide-react";
import type { TicketStatus } from "@/server/domain/maintenance/stateMachine";

const STEPS = [
  { label: "Received", desc: "Request submitted" },
  { label: "Triaged", desc: "Reviewed" },
  { label: "Assigned", desc: "Technician assigned" },
  { label: "In progress", desc: "Work underway" },
  { label: "Resolved", desc: "Repair done" },
] as const;

const INDEX: Record<string, number> = { NEW: 0, TRIAGED: 1, ASSIGNED: 2, IN_PROGRESS: 3, ON_HOLD: 3, RESOLVED: 4, CLOSED: 4 };
export const STATUS_LABEL: Record<string, string> = {
  NEW: "Received", TRIAGED: "Reviewed", ASSIGNED: "Assigned", IN_PROGRESS: "In progress", ON_HOLD: "On hold", RESOLVED: "Resolved", CLOSED: "Closed", CANCELED: "Canceled",
};

export function TicketStatusStepper({ status, technicianName }: { status: TicketStatus | string; technicianName?: string | null }) {
  const s = status.toUpperCase();
  if (s === "CANCELED") {
    return (
      <div data-testid="ticket-status" className="mt-4 rounded-2xl border border-line bg-surface p-4 text-sm text-ink-2">
        This request was canceled.
      </div>
    );
  }
  const active = INDEX[s] ?? 0;
  const done = s === "RESOLVED" || s === "CLOSED";
  const onHold = s === "ON_HOLD";
  return (
    <div data-testid="ticket-status" className="mt-4 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3 text-sm">
        <p>
          <span className="text-muted">Status </span>
          <span className="font-semibold">{STATUS_LABEL[s] ?? s.toLowerCase()}</span>
        </p>
        {technicianName && <p className="text-ink-2">Technician: <span className="font-medium text-ink">{technicianName}</span></p>}
      </div>
      <ol className="mt-4 grid grid-cols-5 gap-1 text-center">
        {STEPS.map((step, i) => {
          const complete = done || i < active;
          const current = !done && i === active;
          const paused = current && onHold;
          return (
            <li key={step.label} className="flex flex-col items-center" aria-current={current ? "step" : undefined}>
              <span
                className={`grid size-8 place-items-center rounded-full text-xs font-semibold ${
                  complete ? "bg-brand text-brand-ink" : current ? "border-2 border-brand bg-surface text-ink" : "border border-line bg-surface text-muted"
                }`}
              >
                {complete ? <Check aria-hidden className="size-4" /> : paused ? <Pause aria-hidden className="size-3.5" /> : i + 1}
              </span>
              <span className={`mt-1.5 text-[11px] leading-tight sm:text-xs ${current ? "font-semibold text-ink" : "text-ink-2"}`}>{paused ? "On hold" : step.label}</span>
              <span className="mt-0.5 hidden text-2xs text-muted sm:block">{paused ? "Work paused" : step.desc}</span>
            </li>
          );
        })}
      </ol>
      {onHold && <p className="mt-4 rounded-xl bg-warn-bg p-3 text-xs text-warn">Work is paused for now. We&apos;ll update you here and by email when it resumes.</p>}
    </div>
  );
}
