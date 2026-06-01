import { human } from "@/components/desk/bits";

const STAGE_LABEL: Record<string, string> = { INTEREST: "Interest", SHOWING: "Showing", APPLIED: "Applied", SCREENED: "Screened", DECISION: "Decision made", LEASE_SIGNED: "Lease signed" };
const label = (s: string) => STAGE_LABEL[s] ?? human(s);
const describe = (r: Row) =>
  [`${label(r.stage)}: ${r.count}`, r.conversion != null ? `${Math.round(r.conversion * 100)}% of the stage above` : null, r.medianDays != null ? `median ${r.medianDays.toFixed(1)} days here` : null].filter(Boolean).join(", ");

interface Row {
  stage: string;
  count: number;
  conversion: number | null;
  medianDays: number | null;
}

/**
 * Single-series magnitude, so one hue. Bars grow from one baseline, <=20px thick with a 4px
 * rounded data end. Values are labelled at the bar end; the hover title gives the rest, and
 * the same numbers are in the table under "Show as table".
 */
export function FunnelBars({ rows }: { rows: Row[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <figure className="viz" aria-label="Leasing funnel, last 90 days">
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.stage}
            tabIndex={0}
            aria-label={describe(r)}
            className="group relative grid grid-cols-[92px_1fr_120px] items-center gap-3 rounded outline-offset-2"
          >
            <span className="text-[12px] text-ink-2">{label(r.stage)}</span>
            <span role="tooltip" className="pointer-events-none absolute -top-7 left-24 z-10 hidden whitespace-nowrap rounded bg-ink px-2 py-1 text-2xs text-white group-hover:block group-focus:block">{describe(r)}</span>
            <div className="flex h-5 items-center">
              <div className="h-[18px] rounded-r-[4px] bg-[var(--series-1)] transition-opacity group-hover:opacity-80" style={{ width: `${(r.count / max) * 100}%`, minWidth: r.count ? 3 : 0 }} />
              <span className="ml-2 font-mono text-[12px] tabular text-ink">{r.count}</span>
            </div>
            <span className="text-right font-mono text-2xs text-muted">
              {[r.conversion != null ? `${Math.round(r.conversion * 100)}% conv.` : null, r.medianDays != null ? `${r.medianDays.toFixed(1)}d` : null].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      <details className="mt-3 text-[12px]">
        <summary className="cursor-pointer text-muted">Show as table</summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-2xs uppercase text-muted"><tr><th>Stage</th><th className="text-right">Reached</th><th className="text-right">Conversion</th><th className="text-right">Median days in stage</th></tr></thead>
          <tbody className="font-mono">
            {rows.map((r) => (
              <tr key={r.stage}><td className="font-sans">{label(r.stage)}</td><td className="text-right">{r.count}</td><td className="text-right">{r.conversion != null ? `${(r.conversion * 100).toFixed(0)}%` : "—"}</td><td className="text-right">{r.medianDays?.toFixed(1) ?? "—"}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
