import { slaState, type SlaClock } from "@/server/domain/maintenance/sla";
import { cx } from "@/lib/cx";

const fmt = (ms: number) => {
  const m = Math.round(Math.abs(ms) / 60000);
  return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

/** Resolve-clock chip: green with time left, amber in the last quarter, red when breached, grey when paused. */
export function SlaChip({ t, now }: { t: SlaClock; now: Date }) {
  const s = slaState(t, now);
  const style = {
    ok: "bg-ok-bg text-ok",
    warn: "bg-warn-bg text-warn",
    breached: "bg-bad text-white",
    paused: "bg-black/10 text-ink-2",
    met: "bg-ok-bg text-ok",
    "n/a": "bg-black/5 text-muted",
  }[s.resolve];
  if (s.respond === "breached" && !t.firstRespondedAt) {
    return <span className="inline-flex whitespace-nowrap rounded bg-bad px-1.5 py-0.5 font-mono text-2xs text-white" title="No response yet and the response deadline has passed">response late</span>;
  }
  const label =
    s.resolve === "breached" ? `${fmt(s.resolveMsLeft ?? 0)} over` : s.resolve === "paused" ? "paused" : s.resolve === "met" ? "met" : s.resolveMsLeft != null ? `${fmt(s.resolveMsLeft)} left` : "—";
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-2xs", style)} title={`Respond: ${s.respond}. Resolve: ${s.resolve}.`}>
      {label}
    </span>
  );
}
