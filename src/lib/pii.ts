/** True if text contains something shaped like a Social Security number. */
export function looksLikeSsn(text: string | undefined | null) {
  return !!text && /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b|\b\d{9}\b/.test(text);
}

export const NO_SSN_MESSAGE = "Please remove the Social Security number. We never collect it; the screening company asks for it on its own page.";
