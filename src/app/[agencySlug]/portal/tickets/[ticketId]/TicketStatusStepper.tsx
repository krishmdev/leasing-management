import type { TicketStatus } from "@/server/domain/maintenance/stateMachine";

interface Step {
  key: string;
  label: string;
  desc: string;
}

const STEPS: Step[] = [
  { key: "NEW", label: "Received", desc: "Request submitted" },
  { key: "TRIAGED", label: "Triaged", desc: "Reviewed & categorized" },
  { key: "ASSIGNED", label: "Assigned", desc: "Technician dispatched" },
  { key: "IN_PROGRESS", label: "In Progress", desc: "Work underway" },
  { key: "RESOLVED", label: "Resolved", desc: "Repairs completed" },
];

export function TicketStatusStepper({
  status,
  technicianName,
}: {
  status: TicketStatus | string;
  technicianName?: string | null;
}) {
  const normStatus = status.toUpperCase();

  // Determine stage progression
  let activeIndex = 0;
  if (normStatus === "NEW") {
    activeIndex = 0;
  } else if (normStatus === "TRIAGED") {
    activeIndex = 1;
  } else if (normStatus === "ASSIGNED") {
    activeIndex = 2;
  } else if (normStatus === "IN_PROGRESS" || normStatus === "ON_HOLD") {
    activeIndex = 3;
  } else if (normStatus === "RESOLVED" || normStatus === "CLOSED") {
    activeIndex = 4;
  }

  const isResolved = normStatus === "RESOLVED" || normStatus === "CLOSED";
  const isOnHold = normStatus === "ON_HOLD";
  const isCanceled = normStatus === "CANCELED";

  return (
    <div
      data-testid="ticket-status"
      className="mt-4 rounded-2xl border border-line bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Status</span>
          <span
            className={`inline-flex items-center rounded-full px-3 py-0.5 text-xs font-semibold ${
              isOnHold
                ? "border border-amber-300 bg-amber-100 text-amber-900"
                : isCanceled
                ? "border border-neutral-300 bg-neutral-100 text-neutral-600"
                : isResolved
                ? "bg-ok-bg text-ok"
                : "bg-brand text-brand-ink"
            }`}
          >
            {status.toLowerCase().replace("_", " ")}
          </span>
        </div>
        {technicianName && (
          <span className="text-xs text-ink-2">
            Technician: <strong className="font-medium text-ink">{technicianName}</strong>
          </span>
        )}
      </div>

      {/* Stepper milestones */}
      <div className="relative mt-5 px-2">
        <div
          className="absolute left-6 right-6 top-3.5 h-0.5 -translate-y-1/2 bg-line"
          aria-hidden="true"
        >
          <div
            className={`h-full transition-all duration-300 ${
              isOnHold ? "bg-amber-500" : "bg-brand"
            }`}
            style={{
              width: `${(Math.min(activeIndex, 4) / 4) * 100}%`,
            }}
          />
        </div>

        <ol className="relative flex justify-between">
          {STEPS.map((step, idx) => {
            const isCompleted = isResolved || idx < activeIndex;
            const isCurrent = !isResolved && idx === activeIndex;
            const isHoldStep = isCurrent && isOnHold;

            return (
              <li key={step.key} className="flex flex-col items-center">
                <span
                  className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    isCompleted
                      ? "bg-brand text-brand-ink ring-2 ring-brand/30"
                      : isHoldStep
                      ? "border-2 border-amber-500 bg-surface text-amber-700 ring-4 ring-amber-500/20"
                      : isCurrent
                      ? "border-2 border-brand bg-surface font-bold text-brand-ink ring-4 ring-brand/20"
                      : "border border-line bg-surface text-muted"
                  }`}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isCompleted ? (
                    <svg
                      className="size-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : isHoldStep ? (
                    <span>⏸</span>
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </span>
                <span
                  className={`mt-2 text-center text-[11px] leading-tight sm:text-xs ${
                    isHoldStep
                      ? "font-semibold text-amber-800"
                      : isCurrent
                      ? "font-semibold text-ink"
                      : isCompleted
                      ? "font-medium text-ink-2"
                      : "text-muted"
                  }`}
                >
                  {isHoldStep ? "On Hold" : step.label}
                </span>
                <span className="mt-0.5 hidden text-center text-2xs text-muted sm:block">
                  {isHoldStep ? "Work paused" : step.desc}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* On-Hold Alert Notice */}
      {isOnHold && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900">
          <span className="text-sm">⏸️</span>
          <div>
            <p className="font-semibold">Work is temporarily on hold</p>
            <p className="mt-0.5 text-amber-800">
              Repairs are currently paused while waiting for required parts or access coordination. We will resume as soon as possible.
            </p>
          </div>
        </div>
      )}

      {/* Canceled Alert Notice */}
      {isCanceled && (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-muted">
          This repair request has been canceled.
        </div>
      )}
    </div>
  );
}
