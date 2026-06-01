import { PROTECTED_RE } from "./protectedTerms";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const TITLED_NAME_RE = /\b(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g;
/** SSNs in the usual shapes, and a date after "born"/"DOB". The platform must never keep either. */
export const SSN_RE = /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b|\b\d{9}\b/g;
const DOB_RE = /\b(?:born(?:\s+on)?|dob|d\.o\.b\.?|date of birth|birthday)\b[:\s]*[\w/.,-]*(?:\s[\w/.,-]+){0,2}/gi;
/**
 * Words that describe the redacted thing ("her late husband", "an elderly mother") can carry
 * the protected trait on their own, or read as rental facts ("late"). They go with it.
 */
const MODIFIER_RE = /\b(?:late|dear|beloved|young|little|elderly|older|deceased|former|ex|new|sick|ailing|disabled|pregnant|single|widowed|divorced|foreign|devout)\s+(?=\[REDACTED\])/gi;
export const REDACTED = "[REDACTED]";

export interface Redaction {
  text: string;
  count: number;
}

/**
 * Scrub free text before it goes anywhere near a model: contact details, names we know about
 * (applicant, landlord) or can spot (Mr./Ms. X), and protected-class terms.
 */
export function redact(input: string, opts: { knownNames?: string[] } = {}): Redaction {
  let count = 0;
  const sub = (re: RegExp) => (s: string) =>
    s.replace(re, () => {
      count++;
      return REDACTED;
    });
  let text = input.normalize("NFKC");
  text = sub(SSN_RE)(text);
  text = sub(DOB_RE)(text);
  text = sub(EMAIL_RE)(text);
  text = sub(PHONE_RE)(text);
  text = sub(TITLED_NAME_RE)(text);
  const names = (opts.knownNames ?? []).flatMap((n) => n.split(/\s+/)).filter((n) => n.length >= 2);
  if (names.length) {
    const re = new RegExp(`\\b(?:${[...new Set(names)].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
    text = sub(re)(text);
  }
  text = sub(PROTECTED_RE)(text);
  // Collapse modifiers into the redaction, repeatedly for chains like "her dear late husband".
  for (let prev = ""; prev !== text; ) {
    prev = text;
    text = text.replace(MODIFIER_RE, "");
  }
  return { text, count };
}

/** Does text mention anything on the protected list? Used on model output. */
export function mentionsProtected(text: string): boolean {
  PROTECTED_RE.lastIndex = 0;
  const hit = PROTECTED_RE.test(text);
  PROTECTED_RE.lastIndex = 0;
  return hit;
}
