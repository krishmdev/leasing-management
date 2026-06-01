import { SSN_SOURCE } from "@/lib/pii";
import { PROTECTED_RE } from "./protectedTerms";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const TITLED_NAME_RE = /\b(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g;
/** SSNs in the usual shapes, and dates of birth. The platform must never keep either. */
export const SSN_RE = new RegExp(SSN_SOURCE, "g");
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
/** A birth-year-looking year: 1900-2012. Lease and move dates are later than that. */
const BIRTH_YEAR = String.raw`(?:19\d{2}|200\d|201[0-2])`;
/**
 * After a birth keyword, everything up to five tokens ("born in 1990 on April 12", "birthdate
 * 1990-04-12"). On its own, a full date whose year looks like a birth year ("12 April 1990",
 * "April 12, 1990", "04/12/1990", "1990-04-12").
 */
const DOB_RE = new RegExp(
  [
    String.raw`\b(?:born|dob|d\.o\.b\.?|date of birth|birth ?date|birthday)(?![\p{L}])[:\s]*[\p{L}\p{N}/.,\u2013-]*(?:\s+[\p{L}\p{N}/.,\u2013-]+){0,4}`,
    String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH},?\s+${BIRTH_YEAR}\b`,
    String.raw`\b${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+${BIRTH_YEAR}\b`,
    String.raw`\b\d{1,2}[/.\u2013-]\d{1,2}[/.\u2013-]${BIRTH_YEAR}\b`,
    String.raw`\b${BIRTH_YEAR}[/.\u2013-]\d{1,2}[/.\u2013-]\d{1,2}\b`,
  ].join("|"),
  "giu",
);
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
    // Unicode-aware edges, so "José" and "Zoë" match whole (\b is ASCII-only).
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${[...new Set(names)].map((n) => n.normalize("NFKC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
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
