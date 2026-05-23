import type { ReferenceAnalysis, ReferenceDTO, RationaleDTO, TriageDTO, TriageResult } from "./guardrails/dto";

/**
 * Deterministic stand-in for the LLM, used by default and in every test. It reads the same
 * redacted DTOs a model would, so the guardrails are exercised identically.
 */
const POS = {
  pay: [/on time/i, /never late/i, /always paid/i, /paid early/i, /reliable/i, /autopay/i],
  care: [/clean/i, /spotless/i, /well[- ]kept/i, /took (good )?care/i, /great condition/i, /tidy/i],
  comply: [/no (issues|complaints|problems)/i, /respectful/i, /quiet/i, /followed the lease/i, /great tenant/i, /recommend/i, /pleasure/i],
};
const NEG = {
  pay: [/\blate\b/i, /behind on rent/i, /bounced/i, /unpaid/i, /owed/i, /payment plan/i],
  care: [/damage/i, /\bmess\b/i, /dirty/i, /repairs? (were|was) needed/i, /holes? in/i, /stain/i],
  comply: [/complaints?/i, /noise/i, /unauthori[sz]ed/i, /violation/i, /warning/i, /notice to/i, /eviction/i, /smok(ing|ed)/i],
};

const count = (text: string, res: RegExp[]) => res.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));

export function offlineAnalyzeReference(dto: ReferenceDTO): ReferenceAnalysis {
  const t = dto.redactedText;
  const dims = (["pay", "care", "comply"] as const).map((k) => clamp(3 + count(t, POS[k]) - 1.5 * count(t, NEG[k])));
  const redFlags: ReferenceAnalysis["redFlags"] = [];
  if (/\blate\b|behind on rent|bounced/i.test(t)) redFlags.push("LATE_PAYMENTS");
  if (/damage|holes? in/i.test(t)) redFlags.push("PROPERTY_DAMAGE");
  if (/violation|unauthori[sz]ed/i.test(t)) redFlags.push("LEASE_VIOLATION");
  if (/noise|complaints?/i.test(t)) redFlags.push("NOISE_COMPLAINTS");
  if (/unpaid|owed/i.test(t)) redFlags.push("UNPAID_BALANCE");
  if (/eviction|notice to (pay|quit|vacate)/i.test(t)) redFlags.push("EVICTION_NOTICE");
  const quotes = t
    .split(/(?<=[.!?])\s+/)
    .filter((s) => [...POS.pay, ...POS.care, ...POS.comply, ...NEG.pay, ...NEG.care, ...NEG.comply].some((re) => re.test(s)))
    .slice(0, 2)
    .map((s) => s.slice(0, 200));
  return {
    paymentReliability: dims[0],
    propertyCare: dims[1],
    leaseCompliance: dims[2],
    redFlags,
    evidenceQuotes: quotes,
    confidence: t.trim().length < 20 ? 0.2 : Math.min(0.9, 0.4 + 0.1 * quotes.length),
  };
}

const FACTOR_NAMES: Record<string, string> = {
  income: "income relative to the tenant's share of rent",
  credit: "credit",
  evictions: "eviction history",
  collections: "non-medical collections",
  references: "rental references",
};

export function templateRationale(dto: RationaleDTO): { summary: string } {
  const strong = dto.breakdown.filter((b) => b.points >= b.max * 0.8).map((b) => FACTOR_NAMES[b.factor] ?? b.factor);
  const weak = dto.breakdown.filter((b) => b.points < b.max * 0.6).map((b) => FACTOR_NAMES[b.factor] ?? b.factor);
  const verdict = {
    APPROVE: "meets the approval threshold",
    CONDITIONAL: "falls in the conditional range",
    DECLINE: "is below the conditional threshold",
    NEEDS_REVIEW: "needs a person to review it",
  }[dto.outcome];
  const parts = [`Scored ${dto.score}/100 under the agency's written criteria and ${verdict}.`];
  if (strong.length) parts.push(`Strongest factors: ${strong.join(", ")}.`);
  if (weak.length) parts.push(`Points were lost on ${weak.join(", ")}.`);
  if (dto.flags.length) parts.push(`Flags for review: ${dto.flags.map((f) => f.toLowerCase().replaceAll("_", " ")).join(", ")}.`);
  if (dto.conditions.length) parts.push(`Suggested conditions: ${dto.conditions.join("; ")}.`);
  return { summary: parts.join(" ").slice(0, 1200) };
}

const CATEGORY_RULES: [TriageResult["category"], RegExp][] = [
  ["PLUMBING", /leak|drip|toilet|sink|drain|clog|faucet|water heater|pipe|shower/i],
  ["ELECTRICAL", /outlet|breaker|light|switch|power|electric|wiring/i],
  ["HVAC", /heat|heater|furnace|ac\b|air condition|thermostat|vent/i],
  ["APPLIANCE", /fridge|refrigerator|stove|oven|dishwasher|washer|dryer|microwave|disposal/i],
  ["PEST", /mice|mouse|rat|roach|cockroach|ants|bed ?bugs|pest|termite/i],
  ["LOCKS_SECURITY", /lock|key|door won'?t|deadbolt|window latch|gate/i],
  ["STRUCTURAL", /ceiling|crack|wall|floor|roof|mold|window/i],
];

export function offlineTriage(dto: TriageDTO): TriageResult {
  const text = `${dto.title} ${dto.redactedText}`;
  const hit = CATEGORY_RULES.find(([, re]) => re.test(text));
  const category = hit ? hit[0] : "OTHER";
  const urgency: TriageResult["urgency"] = /urgent|asap|can'?t use|not working at all|flood|overflow/i.test(text)
    ? "HIGH"
    : /cosmetic|whenever|minor|small/i.test(text)
      ? "LOW"
      : "NORMAL";
  return { category, urgency, confidence: hit ? 0.7 : 0.3 };
}
