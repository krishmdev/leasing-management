import { Badge, type Tone } from "@/components/ui";
import { cx } from "@/lib/cx";

const APP_TONE: Record<string, Tone> = {
  DRAFT: "neutral", SUBMITTED: "info", REFERENCES_PENDING: "info", SCREENING: "info", SCREENED: "info",
  DECISION_PENDING: "warn", APPROVED: "ok", CONDITIONAL: "ok", DECLINED: "bad", WITHDRAWN: "neutral", LEASE_SENT: "brand", LEASE_SIGNED: "ok",
};
export const human = (s: string) => s.toLowerCase().replaceAll("_", " ").replace(/^locks security$/, "locks and security");

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

export const FLAG_TEXT: Record<string, string> = {
  THIN_FILE: "No credit score on file (thin file), so credit was scored neutral",
  SUBSIDY_ALT_EVIDENCE: "Uses rental assistance and offered other proof of ability to pay; review that evidence",
  EVICTION_RECORD: "Eviction judgment within the criteria's lookback period",
  IDENTITY_UNVERIFIED: "The screening company couldn't verify identity",
  DATA_CONFLICT: "The screening company couldn't verify the stated income",
  REFERENCE_CONCERN: "A landlord reported lease violations or wouldn't rent again",
  LLM_GUARD_TRIPPED: "The written explanation mentioned something it shouldn't; a template was used",
  INCOME_BELOW_MIN: "Income is below the lowest income band in the criteria",
  NO_REFERENCES: "No landlord references were received",
  REFERENCES_INCOMPLETE: "Not every reference came back",
  AUTOMATION_PAUSED: "Automation was paused when it tried to approve",
  AUTOMATION_LEVEL_CHANGED: "The automation level changed before it could approve",
  DAILY_CAP_REACHED: "Today's automatic approval limit was reached",
  UNIT_NO_LONGER_AVAILABLE: "Another applicant signed for this home first",
  BELOW_AUTO_APPROVE_SCORE: "Score is below the automatic approval threshold",
  CREDIT_BAND_NOT_ALLOWED: "Credit band isn't one this agency approves automatically",
  NEEDS_REVIEW: "Needs a person to review",
};
/**
 * Plain text for a flag. With the application's criteria config, the income and eviction lines
 * name the agency's own numbers instead of the defaults.
 */
export function flagText(f: string, criteria?: unknown) {
  const key = f.replace(/^FLAG_/, "");
  const c = criteria as { incomeBands?: { minRatio: number }[]; evictionLookbackYears?: number } | null | undefined;
  const minRatio = c?.incomeBands?.length ? Math.min(...c.incomeBands.map((b) => b.minRatio)) : null;
  if (key === "INCOME_BELOW_MIN" && minRatio) return `Income is below ${minRatio}x the tenant's share of rent`;
  if (key === "EVICTION_RECORD" && c?.evictionLookbackYears) return `Eviction judgment within the last ${c.evictionLookbackYears} years`;
  return FLAG_TEXT[key] ?? human(key);
}

/** Score out of 100 on a neutral bar with the approve/conditional thresholds marked; the chip next to it carries the status color. */
export function ScoreBar({ score, approve = 75, conditional = 60 }: { score: number; approve?: number; conditional?: number }) {
  const tone = "bg-ink";
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

export const STEP_TITLES: Record<string, string> = {
  "screening.invite": "Sent the screening invitation",
  "screening.fetchSummary": "Got the screening report",
  "references.analyze": "Read the landlord references",
  "rubric.evaluate": "Scored against the criteria",
  "rationale.generate": "Wrote the explanation",
  "policy.apply": "Applied the agency's automation setting",
};

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
              <p className="text-[13px] font-medium">{STEP_TITLES[s.stepName] ?? s.stepName}</p>
              <p className="font-mono text-2xs text-muted">
                {human(s.status)}
                {s.attempt > 1 && ` · attempt ${s.attempt}`}
                {s.durationMs != null && ` · ${s.durationMs} ms`}
              </p>
            </div>
            {Object.keys(sum).length > 0 && (
              <details className="mt-0.5">
              <summary className="cursor-pointer text-2xs text-muted">Technical details</summary>
              <p className="mt-1 font-mono text-2xs text-muted">{s.stepName}</p>
              <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-ink-2">
                {Object.entries(sum).map(([k, v]) => (
                  <div key={k} className="flex gap-1">
                    <dt className="text-muted">{k}</dt>
                    <dd className="font-mono">{Array.isArray(v) ? (v.length ? v.join(", ") : "none") : String(v)}</dd>
                  </div>
                ))}
              </dl>
              </details>
            )}
            {s.error && <p className="mt-1 font-mono text-2xs text-bad">{s.error}</p>}
          </li>
        );
      })}
    </ol>
  );
}
