import { Badge, type Tone } from "@/components/ui";
import { cx } from "@/lib/cx";

const APP_TONE: Record<string, Tone> = {
  DRAFT: "neutral", SUBMITTED: "info", REFERENCES_PENDING: "info", SCREENING: "info", SCREENED: "info",
  DECISION_PENDING: "warn", APPROVED: "ok", CONDITIONAL: "ok", DECLINED: "bad", WITHDRAWN: "neutral", LEASE_SENT: "brand", LEASE_SIGNED: "ok",
};
export const human = (s: string) => s.toLowerCase().replaceAll("_", " ");

export function AppStatus({ status }: { status: string }) {
  return <Badge tone={APP_TONE[status] ?? "neutral"}>{human(status)}</Badge>;
}

const OUTCOME_TONE: Record<string, Tone> = { APPROVE: "ok", CONDITIONAL: "warn", DECLINE: "bad", NEEDS_REVIEW: "warn" };
export function OutcomeBadge({ outcome }: { outcome: string }) {
  return <Badge tone={OUTCOME_TONE[outcome] ?? "neutral"}>{human(outcome)}</Badge>;
}

const URG: Record<string, Tone> = { EMERGENCY: "bad", HIGH: "warn", NORMAL: "neutral", LOW: "neutral" };
export function UrgencyBadge({ urgency }: { urgency: string }) {
  return <Badge tone={URG[urgency]} dot={urgency === "EMERGENCY"}>{human(urgency)}</Badge>;
}

/** Score out of 100 as a horizontal bar with the approve/conditional thresholds marked. */
export function ScoreBar({ score, approve = 75, conditional = 60 }: { score: number; approve?: number; conditional?: number }) {
  const tone = score >= approve ? "bg-ok" : score >= conditional ? "bg-warn" : "bg-bad";
  return (
    <div className="w-full">
      <div className="relative h-2 rounded-full bg-black/10" role="img" aria-label={`Score ${score} of 100`}>
        <div className={cx("h-2 rounded-full", tone)} style={{ width: `${Math.min(100, score)}%` }} />
        {[conditional, approve].map((t) => (
          <span key={t} className="absolute -top-1 h-4 w-px bg-ink/50" style={{ left: `${t}%` }} aria-hidden />
        ))}
      </div>
    </div>
  );
}

export function FactorRow({ factor, points, max, detail }: { factor: string; points: number; max: number; detail: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr_64px] items-center gap-3 py-1.5">
      <span className="text-[13px] capitalize text-ink-2">{factor}</span>
      <div>
        <div className="h-1.5 rounded-full bg-black/10">
          <div className="h-1.5 rounded-full bg-ink" style={{ width: `${(points / max) * 100}%` }} />
        </div>
        <p className="mt-0.5 text-2xs text-muted">{detail}</p>
      </div>
      <span className="text-right font-mono text-[13px] tabular">
        {Number.isInteger(points) ? points : points.toFixed(1)}
        <span className="text-muted">/{max}</span>
      </span>
    </div>
  );
}

const STEP_TONE: Record<string, string> = { SUCCEEDED: "bg-ok", RUNNING: "bg-info animate-pulse", PENDING: "bg-line-strong", FAILED: "bg-warn", DEAD: "bg-bad" };

export function Timeline({ steps }: { steps: { id: string; stepName: string; status: string; attempt: number; durationMs: number | null; outputSummary: unknown; error: string | null; finishedAt: Date | null }[] }) {
  if (!steps.length) return <p className="text-[13px] text-muted">The agent hasn&apos;t started on this application yet.</p>;
  return (
    <ol className="relative space-y-3 border-l border-line pl-4">
      {steps.map((s) => {
        const sum = (s.outputSummary ?? {}) as Record<string, unknown>;
        return (
          <li key={s.id} className="relative">
            <span className={cx("absolute -left-[21px] top-1 size-2.5 rounded-full ring-2 ring-surface", STEP_TONE[s.status])} aria-hidden />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-mono text-[12px] font-medium">{s.stepName}</p>
              <p className="font-mono text-2xs text-muted">
                {human(s.status)}
                {s.attempt > 1 && ` · attempt ${s.attempt}`}
                {s.durationMs != null && ` · ${s.durationMs} ms`}
              </p>
            </div>
            {Object.keys(sum).length > 0 && (
              <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-ink-2">
                {Object.entries(sum).map(([k, v]) => (
                  <div key={k} className="flex gap-1">
                    <dt className="text-muted">{k}</dt>
                    <dd className="font-mono">{Array.isArray(v) ? (v.length ? v.join(", ") : "none") : String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {s.error && <p className="mt-1 font-mono text-2xs text-bad">{s.error}</p>}
          </li>
        );
      })}
    </ol>
  );
}
