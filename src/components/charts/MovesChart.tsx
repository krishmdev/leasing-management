"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Move-ins vs move-outs per month. Two series, one axis, 2px lines, >=8px active markers with a
 * surface ring, a legend plus direct labels at the line ends, crosshair tooltip on hover.
 */
export function MovesChart({ data }: { data: { month: string; moveIns: number; moveOuts: number }[] }) {
  const last = data.at(-1);
  const fmt = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  // When both series end on the same value, nudge the labels apart instead of overprinting.
  const tie = last && last.moveIns === last.moveOuts;
  const endLabel = (text: string, dy: number) =>
    function EndLabel({ index, x, y }: { index?: number; x?: number | string; y?: number | string }) {
      return index === data.length - 1 ? <text x={Number(x) + 8} y={Number(y) + 4 + (tie ? dy : 0)} fontSize={11} fill="var(--ink-2)">{text}</text> : <g />;
    };
  return (
    <figure className="viz" aria-label="Move-ins and move-outs by month, last 18 months">
      <div className="mb-2 flex gap-4 text-[12px] text-ink-2" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--series-1)]" /> Move-ins</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--series-2)]" /> Move-outs</span>
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 80, bottom: 0, left: -20 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
            <XAxis dataKey="month" tickFormatter={fmt} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={{ stroke: "var(--grid)" }} tickLine={false} interval={2} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
              contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid var(--line)", boxShadow: "0 2px 8px rgba(0,0,0,.06)" }}
              labelFormatter={(m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}
            />
            <Line type="linear" dataKey="moveIns" name="Move-ins" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} label={endLabel(`Move-ins ${last?.moveIns ?? 0}`, -7)} />
            <Line type="linear" dataKey="moveOuts" name="Move-outs" stroke="var(--series-2)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} label={endLabel(`Move-outs ${last?.moveOuts ?? 0}`, 7)} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-[12px]">
        <summary className="cursor-pointer text-muted">Show as table</summary>
        <table className="mt-2 w-full text-left font-mono">
          <thead className="font-sans text-2xs uppercase text-muted"><tr><th>Month</th><th className="text-right">Move-ins</th><th className="text-right">Move-outs</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.month}><td>{d.month}</td><td className="text-right">{d.moveIns}</td><td className="text-right">{d.moveOuts}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}
