/**
 * Safety rules run before any classifier. A match forces EMERGENCY and shows the tenant what to
 * do right now. The classifier can raise urgency afterwards but never lower a rule-flagged one.
 */
export interface SafetyRule {
  id: string;
  pattern: RegExp;
  instructions: string;
  category: "PLUMBING" | "ELECTRICAL" | "HVAC" | "LOCKS_SECURITY" | "STRUCTURAL" | "OTHER";
  months?: number[]; // only in these months (1-12)
}

export const SAFETY_RULES: SafetyRule[] = [
  { id: "gas", pattern: /\b(smell(s|ing)? (of )?gas|gas (smell|leak)|rotten egg)/i, category: "OTHER", instructions: "Leave the unit now. Don't use light switches or flames. Call PG&E at 1-800-743-5000 or 911 from outside." },
  { id: "fire", pattern: /\b(fire|smoke|burning smell|flames?)\b/i, category: "ELECTRICAL", instructions: "If there is fire or smoke, get out and call 911." },
  { id: "co", pattern: /\b(carbon monoxide|co alarm|co detector)/i, category: "HVAC", instructions: "Get everyone outside into fresh air and call 911." },
  { id: "flood", pattern: /\b(flood(ing|ed)?|sewage|water (pouring|gushing|everywhere)|burst pipe)/i, category: "PLUMBING", instructions: "If you can reach it safely, turn off the water valve under the sink or behind the toilet." },
  { id: "sparking", pattern: /\b(spark(s|ing)?|exposed wires?|electrical (burning|shock)|outlet (is )?smoking)/i, category: "ELECTRICAL", instructions: "Stay away from it and switch off that circuit at the breaker panel if it's safe to do so." },
  { id: "no_water", pattern: /\bno (running )?water\b/i, category: "PLUMBING", instructions: "We'll dispatch someone within the hour." },
  { id: "no_heat", pattern: /\b(no heat|heat(er|ing)? (is )?(not working|broken|out)|furnace (is )?(out|broken))/i, category: "HVAC", instructions: "We'll dispatch someone within the hour.", months: [10, 11, 12, 1, 2, 3, 4] },
  { id: "lockout", pattern: /\b(locked out|can'?t get in)\b/i, category: "LOCKS_SECURITY", instructions: "Stay somewhere safe; we'll call you back." },
  { id: "exterior_lock", pattern: /\b(front|entry|exterior|building) door (lock )?(is )?(broken|won'?t lock|doesn'?t lock)/i, category: "LOCKS_SECURITY", instructions: "We'll secure the door within the hour." },
];

export function matchSafetyRule(text: string, month: number): SafetyRule | null {
  return SAFETY_RULES.find((r) => r.pattern.test(text) && (!r.months || r.months.includes(month))) ?? null;
}

/** Phrases suggesting a disability-related accommodation request; those go to a person. */
export const ACCOMMODATION_RE = /\b(accommodation|grab bars?|ramp|wheelchair|accessib(le|ility)|disabilit(y|ies)|service animal|support animal|visual(ly)? impair|hearing impair)\b/i;
