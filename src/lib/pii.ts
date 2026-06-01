/** Separators people type inside an SSN: hyphen, space, dot, en or em dash. */
const SEP = String.raw`[-\s.\u2012\u2013\u2014]`;
/** SSN shapes: 123-45-6789, 123 45 6789, 123.45.6789, 123–45–6789, or nine digits in a row. */
export const SSN_SOURCE = String.raw`(?<!\d)\d{3}${SEP}\d{2}${SEP}\d{4}(?!\d)|(?<!\d)\d{9}(?!\d)`;

/** True if text contains something shaped like a Social Security number. */
export function looksLikeSsn(text: string | undefined | null) {
  return !!text && new RegExp(SSN_SOURCE).test(text);
}

export const NO_SSN_MESSAGE = "Please remove the Social Security number. We never collect it; the screening company asks for it on its own page.";
