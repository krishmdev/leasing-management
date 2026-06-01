import type { ReferenceAnalysis, ReferenceDTO, RationaleDTO, TriageDTO, TriageResult } from "./guardrails/dto";

/**
 * Deterministic stand-in for the LLM, used by default and in every test. It reads the same
 * redacted DTOs a model would, so the guardrails are exercised identically.
 */
const POS = {
  // Word boundaries throughout, so names like McLean or Stainton don't count. "clean" and "tidy"
  // are matched in lower case only so a capitalized name ("Tidy Brooks") isn't read as praise.
  pay: [/\bon time\b/i, /\bnever late\b/i, /\balways paid\b/i, /\bpaid early\b/i, /\breliabl[ey]\b/i, /\bautopay\b/i],
  care: [/\bclean(?:ed|ing|ly)?\b/, /\bspotless\b/i, /\bwell[- ]kept\b/i, /\btook (?:good )?care\b/i, /\bgreat condition\b/i, /\btidy\b/],
  comply: [/\bno (?:issues|complaints|problems)\b/i, /\brespectful\b/i, /\bquiet\b/i, /\bfollowed the lease\b/i, /\bgreat tenant\b/i, /\brecommend(?:ed)?\b/i, /\bpleasure\b/i],
};
const NEG = {
  // Rental lateness specifically, so "late" in other senses can't cost points.
  pay: [/\b(?:paid|pays|paying|was|were|often|sometimes|always) late\b/i, /\blate (?:rent|payments?|fees?|with (?:the )?rent)\b/i, /\bbehind on rent\b/i, /\bbounced\b/i, /\bunpaid\b/i, /\bowed\b/i, /\bpayment plan\b/i],
  care: [/\bdamage[ds]?\b/i, /\bmess(?:y)?\b/i, /\bdirty\b/i, /\brepairs? (?:were|was) needed\b/i, /\bholes? in\b/i, /\bstain(?:s|ed)?\b/i],
  comply: [/\bcomplaints?\b/i, /\bnoise\b/i, /\bunauthori[sz]ed\b/i, /\bviolations?\b/i, /\bwarnings?\b/i, /\bnotice to\b/i, /\beviction\b/i, /\bsmok(?:ing|ed)\b/i],
};

const count = (text: string, res: RegExp[]) => res.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));

export function offlineAnalyzeReference(dto: ReferenceDTO): ReferenceAnalysis {
  const t = dto.redactedText;
  const dims = (["pay", "care", "comply"] as const).map((k) => clamp(3 + count(t, POS[k]) - 1.5 * count(t, NEG[k])));
  const redFlags: ReferenceAnalysis["redFlags"] = [];
  if (NEG.pay.slice(0, 4).some((re) => re.test(t))) redFlags.push("LATE_PAYMENTS");
  if (/\bdamage[ds]?\b|\bholes? in\b/i.test(t)) redFlags.push("PROPERTY_DAMAGE");
  if (/\bviolations?\b|\bunauthori[sz]ed\b/i.test(t)) redFlags.push("LEASE_VIOLATION");
  if (/\bnoise\b|\bcomplaints?\b/i.test(t)) redFlags.push("NOISE_COMPLAINTS");
  if (/\bunpaid\b|\bowed\b/i.test(t)) redFlags.push("UNPAID_BALANCE");
  if (/\beviction\b|\bnotice to (?:pay|quit|vacate)\b/i.test(t)) redFlags.push("EVICTION_NOTICE");
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
