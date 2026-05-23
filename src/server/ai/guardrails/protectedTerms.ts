/**
 * Words and phrases that point at a protected class under the federal Fair Housing Act and
 * California FEHA / Unruh, plus criminal history (Oakland and Berkeley Fair Chance ordinances).
 * Anything matching is replaced with [REDACTED] before text reaches a model, and model output is
 * scanned with the same list. Only the count of matches is recorded, never the matched text.
 *
 * This is a blunt lexicon on purpose. It over-redacts rather than under-redacts; a redacted
 * reference loses a little signal, which only moves the LLM's share of the score (at most 4.5
 * points), whereas leaking a protected characteristic into a decision is the thing we can't do.
 */
export const PROTECTED_CATEGORIES: Record<string, string[]> = {
  race_color_origin: [
    "race", "racial", "black", "white", "asian", "latino", "latina", "latinx", "hispanic", "african", "caucasian",
    "mexican", "chinese", "indian", "filipino", "vietnamese", "korean", "arab", "middle eastern", "ethnic", "ethnicity",
    "immigrant", "foreigner", "accent", "national origin", "ancestry", "skin color",
  ],
  religion: ["church", "mosque", "synagogue", "temple", "religious", "religion", "christian", "muslim", "jewish", "hindu", "buddhist", "sikh", "catholic", "pray", "prayer", "bible", "quran", "torah"],
  sex_gender: ["gender", "transgender", "trans", "pregnant", "pregnancy", "maternity", "woman", "man", "female", "male", "girlfriend", "boyfriend", "husband", "wife"],
  sexual_orientation: ["gay", "lesbian", "bisexual", "queer", "same-sex", "partner"],
  familial_status: ["kids", "kid", "children", "child", "baby", "babies", "toddler", "son", "daughter", "family", "newborn", "custody", "single mom", "single mother", "single dad"],
  disability: ["disability", "disabled", "wheelchair", "handicap", "handicapped", "blind", "deaf", "service animal", "emotional support animal", "esa", "mental illness", "depression", "anxiety", "autism", "therapy", "medication", "hiv", "cancer", "chronic illness"],
  age: ["elderly", "senior citizen", "retired", "retiree", "young", "old lady", "old man", "teenager", "millennial"],
  marital_status: ["married", "divorced", "divorce", "widow", "widowed", "separated", "single"],
  source_of_income: ["section 8", "voucher", "housing choice", "hud", "welfare", "ssi", "ssdi", "disability benefits", "food stamps", "calfresh", "unemployment benefits"],
  citizenship_immigration: ["citizen", "citizenship", "undocumented", "illegal alien", "green card", "visa", "immigration status", "deported"],
  military_veteran: ["veteran", "military", "army", "navy", "marine", "deployed"],
  genetic_info: ["genetic", "dna test"],
  primary_language: ["english", "spanish speaker", "doesn't speak", "language barrier"],
  criminal_history: ["arrest", "arrested", "conviction", "convicted", "felony", "felon", "jail", "prison", "probation", "parole", "criminal record", "police"],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One regex, longest phrases first so "service animal" wins over "animal". */
export const PROTECTED_RE = new RegExp(
  `\\b(?:${Object.values(PROTECTED_CATEGORIES).flat().sort((a, b) => b.length - a.length).map(escape).join("|")})\\b`,
  "gi",
);
