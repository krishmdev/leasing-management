"use client";

import { useState } from "react";
import { ActionForm } from "@/components/forms/ActionForm";
import { Card, CardHeader, Checkbox, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { AutomationConfig } from "@/server/domain/agent/policy";
import { automationAction } from "../actions";

const LEVELS = [
  { v: "MANUAL", t: "Manual", d: "The agent scores and summarizes. People decide and send everything." },
  { v: "ASSISTED", t: "Assisted", d: "The agent drafts the decision and documents; a person approves before anything goes out." },
  { v: "AUTONOMOUS", t: "Autonomous", d: "Clean approvals above the score threshold execute on their own, within the daily cap. Everything else is escalated. Declines always need a person." },
];

export function AutomationForm({ slug, cfg, paused, usedToday, holdHours, retention }: { slug: string; cfg: AutomationConfig; paused: boolean; usedToday: number; holdHours: number; retention: { creditDataDays?: number; declinedPiiDays?: number } }) {
  const [level, setLevel] = useState(cfg.level);
  const auto = level === "AUTONOMOUS";
  const capReached = cfg.level === "AUTONOMOUS" && usedToday >= cfg.dailyCap;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader title="Screening automation" sub={`Autonomous approvals used today: ${usedToday} of ${cfg.dailyCap}`} />
        <ActionForm action={automationAction.bind(null, slug)} className="space-y-5 p-4">
          {() => (
            <>
              <fieldset className="grid gap-2 md:grid-cols-3">
                <legend className="mb-2 text-sm font-medium">Level</legend>
                {LEVELS.map((l) => (
                  <label key={l.v} className="flex cursor-pointer gap-2.5 rounded-md border border-line p-3 has-[:checked]:border-ink has-[:checked]:bg-paper">
                    <input type="radio" name="level" value={l.v} checked={level === l.v} onChange={() => setLevel(l.v as typeof level)} className="mt-0.5 size-4 accent-[color:var(--ink)]" />
                    <span><span className="text-[13px] font-semibold">{l.t}</span><span className="mt-0.5 block text-2xs text-muted">{l.d}</span></span>
                  </label>
                ))}
              </fieldset>
              {capReached && (
                <p role="status" className="rounded-md bg-warn-bg p-3 text-[13px] text-warn">
                  Today&apos;s cap of {cfg.dailyCap} automatic approvals is used up. Further clean approvals today go to the approvals queue.
                </p>
              )}
              <fieldset disabled={!auto} className={`space-y-4 ${auto ? "" : "opacity-50"}`}>
              <legend className="sr-only">Autonomous settings</legend>
              {!auto && <p className="text-2xs text-muted">These apply only in Autonomous mode.</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Auto-approve minimum score" htmlFor="autoApproveMinScore" hint="75 to 100. Below this, even clean approvals go to a person.">
                  <Input id="autoApproveMinScore" name="autoApproveMinScore" type="number" min={75} max={100} defaultValue={cfg.autoApproveMinScore} />
                </Field>
                <Field label="Daily cap" htmlFor="dailyCap" hint="Checked atomically at execution; the rest escalate.">
                  <Input id="dailyCap" name="dailyCap" type="number" min={0} max={100} defaultValue={cfg.dailyCap} />
                </Field>
              </div>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Credit bands allowed for auto-approval</legend>
                <div className="flex flex-wrap gap-3">
                  {["EXCELLENT", "GOOD", "FAIR"].map((b) => <Checkbox key={b} id={`b-${b}`} name="allowedCreditBands" value={b} defaultChecked={cfg.allowedCreditBands.includes(b as never)} label={b.toLowerCase()} />)}
                </div>
              </fieldset>
              </fieldset>
              {!auto && cfg.allowedCreditBands.map((b) => <input key={b} type="hidden" name="allowedCreditBands" value={b} />)}
              {!auto && <><input type="hidden" name="autoApproveMinScore" value={cfg.autoApproveMinScore} /><input type="hidden" name="dailyCap" value={cfg.dailyCap} /></>}
              <div className="rounded-md border border-warn/30 bg-warn-bg/50 p-3">
                <Checkbox id="paused" name="paused" defaultChecked={paused} label={<><span className="font-semibold text-ink">Pause automation</span> — takes effect immediately, including for recommendations already made.</>} />
              </div>
              <SubmitButton>Save automation settings</SubmitButton>
            </>
          )}
        </ActionForm>
      </Card>
      <Card>
        <CardHeader title="Holds and retention" />
        <dl className="space-y-2 p-4 text-[13px]">
          <div className="flex justify-between"><dt className="text-muted">Approval hold</dt><dd>{holdHours} hours</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Credit data kept</dt><dd>{retention.creditDataDays ?? 120} days after decision</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Declined applicant PII</dt><dd>{retention.declinedPiiDays ?? 730} days</dd></div>
        </dl>
        <p className="px-4 pb-4 text-2xs text-muted">Retention periods are defaults to confirm with counsel (FTC Disposal Rule, 16 CFR 682). The purge runs nightly.</p>
      </Card>
    </div>
  );
}
