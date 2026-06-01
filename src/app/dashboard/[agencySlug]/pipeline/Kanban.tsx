"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { cx } from "@/lib/cx";
import { moveOpportunityAction } from "../actions";

const STAGES = [
  ["INTEREST", "Interest"],
  ["SHOWING", "Showing"],
  ["APPLIED", "Applied"],
  ["SCREENED", "Screened"],
  ["DECISION", "Decision made"],
  ["LEASE_SIGNED", "Lease signed"],
  ["LOST", "Lost"],
] as const;
const MANUAL: Record<string, string[]> = { INTEREST: ["SHOWING", "LOST"], SHOWING: ["INTEREST", "LOST"] };
const canMove = (from: string, to: string) => from !== to && (to === "LOST" || (MANUAL[from] ?? []).includes(to));

interface CardT {
  id: string;
  stage: string;
  name: string;
  unit: string;
  days: number;
  applicationId: string | null;
}

export function Kanban({ slug, cards }: { slug: string; cards: CardT[] }) {
  const [optimistic, move] = useOptimistic(cards, (state, m: { id: string; to: string }) => state.map((c) => (c.id === m.id ? { ...c, stage: m.to } : c)));
  const [, start] = useTransition();
  const [drag, setDrag] = useState<CardT | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const doMove = (c: CardT, to: string) => {
    if (!canMove(c.stage, to)) {
      setToast(`${c.stage.toLowerCase()} → ${to.toLowerCase().replace("_", " ")} happens automatically.`);
      return;
    }
    start(async () => {
      move({ id: c.id, to });
      const r = await moveOpportunityAction(slug, c.id, to);
      if (!r.ok) setToast(r.message ?? "Couldn't move that card.");
    });
  };

  return (
    <div>
      {toast && (
        <div role="status" className="mb-3 flex items-center justify-between rounded-md bg-warn-bg px-3 py-2 text-[13px] text-warn">
          {toast}
          <button onClick={() => setToast(null)} className="text-2xs underline">dismiss</button>
        </div>
      )}
      <div className="relative">
      <div className="grid auto-cols-[minmax(210px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3 pr-6">
        {STAGES.map(([key, label]) => {
          const col = optimistic.filter((c) => c.stage === key);
          const droppable = drag ? canMove(drag.stage, key) : false;
          return (
            <section
              key={key}
              aria-label={label}
              onDragOver={(e) => droppable && e.preventDefault()}
              onDrop={() => drag && doMove(drag, key)}
              className={cx("flex min-h-64 flex-col rounded-lg border bg-[#efede7] p-2", droppable ? "border-dashed border-ink" : "border-line", drag && !droppable && drag.stage !== key && "opacity-60")}
            >
              <header className="mb-2 flex items-center justify-between px-1">
                <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-2">{label}</h2>
                <span className="font-mono text-2xs text-muted">{col.length}</span>
              </header>
              <ul className="max-h-[68vh] space-y-1.5 overflow-y-auto pr-0.5">
                {col.length === 0 && <li className="px-1 py-6 text-center text-2xs text-muted">Empty</li>}
                {col.map((c) => (
                  <li
                    key={c.id}
                    draggable={!!MANUAL[c.stage] || c.stage !== "LOST"}
                    onDragStart={() => setDrag(c)}
                    onDragEnd={() => setDrag(null)}
                    className="cursor-grab rounded-md border border-line bg-surface p-2 shadow-[0_1px_0_rgba(0,0,0,0.04)] active:cursor-grabbing"
                  >
                    {c.applicationId ? (
                      <Link href={`/dashboard/${slug}/applications/${c.applicationId}`} className="text-[13px] font-medium underline-offset-2 hover:underline">{c.name}</Link>
                    ) : (
                      <p className="text-[13px] font-medium">{c.name}</p>
                    )}
                    <p className="truncate text-2xs text-muted">{c.unit}</p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className={cx("font-mono text-2xs", c.days > 7 ? "text-warn" : "text-muted")}>{c.days}d in stage</span>
                      {(MANUAL[c.stage] || c.stage !== "LOST") && (
                        <label className="sr-only" htmlFor={`mv-${c.id}`}>Move {c.name}</label>
                      )}
                      <select
                        id={`mv-${c.id}`}
                        value=""
                        onChange={(e) => e.target.value && doMove(c, e.target.value)}
                        className="min-h-7 rounded border border-line bg-paper px-1 text-2xs text-ink-2"
                        aria-label={`Move ${c.name}`}
                      >
                        <option value="">Move…</option>
                        {STAGES.filter(([k]) => canMove(c.stage, k)).map(([k, l]) => (
                          <option key={k} value={k}>{l}</option>
                        ))}
                      </select>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {/* scroll hint on narrow screens */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper to-transparent xl:hidden" />
      </div>
    </div>
  );
}
