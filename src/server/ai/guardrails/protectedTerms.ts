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
    "race", "racial", "jew", "jewish", "israeli", "palestinian", "nigerian", "ethiopian", "somali", "eritrean", "ghanaian", "kenyan",
    "japanese", "russian", "ukrainian", "polish", "irish", "italian", "german", "french", "brazilian", "salvadoran", "guatemalan",
    "honduran", "cuban", "dominican", "haitian", "jamaican", "puerto rican", "iranian", "iraqi", "syrian", "afghan", "pakistani",
    "bangladeshi", "egyptian", "moroccan", "turkish", "armenian", "samoan", "tongan", "hmong", "cambodian", "laotian", "thai",
    "burmese", "nepali", "tibetan", "native american", "indigenous", "foreign", "refugee", "asylum",
    "sudanese", "congolese", "yemeni", "lebanese", "jordanian", "saudi", "peruvian", "colombian", "venezuelan", "nicaraguan",
    "ecuadorian", "chilean", "argentinian", "argentine", "bolivian", "indonesian", "malaysian", "sri lankan", "tamil", "punjabi",
    "gujarati", "taiwanese", "mongolian", "romanian", "bulgarian", "serbian", "croatian", "bosnian", "albanian", "hungarian",
    "czech", "greek", "portuguese", "dutch", "swedish", "british", "scottish", "canadian", "australian", "caribbean", "latin american", "black", "white", "asian", "latino", "latina", "latinx", "hispanic", "african", "caucasian",
    "mexican", "chinese", "indian", "filipino", "vietnamese", "korean", "arab", "middle eastern", "ethnic", "ethnicity",
    "immigrant", "foreigner", "accent", "national origin", "ancestry", "skin color",
  ],
  religion: [
    "church", "mosque", "synagogue", "temple", "religious", "religion", "christian", "muslim", "jewish", "hindu", "buddhist", "sikh", "catholic", "pray", "prayer", "bible", "quran", "torah",
    "christmas", "eid", "passover", "hanukkah", "diwali", "easter", "pastor", "priest", "rabbi", "imam", "minister", "congregation",
    "mormon", "lds", "atheist", "agnostic", "protestant", "evangelical", "baptist", "orthodox", "jehovah's witness", "ramadan", "hijab", "yarmulke", "turban", "sabbath", "worship", "faith",
  ],
  sex_gender: [
    "gender", "transgender", "trans", "pregnant", "pregnancy", "maternity", "woman", "women", "man", "men", "female", "male", "lady", "ladies", "guy", "girl", "boy",
    "girlfriend", "boyfriend", "husband", "hubby", "wife", "wifey", "wives", "fiance", "fiancee",
  ],
  sexual_orientation: ["gay", "lesbian", "bisexual", "queer", "same-sex", "partner"],
  familial_status: [
    "kid", "kids", "children", "child", "baby", "babies", "toddler", "son", "daughter", "family", "families", "newborn", "custody", "single mom", "single mother", "single dad",
    "mom", "mother", "dad", "father", "parent", "grandkid", "grandchild", "grandchildren", "grandson", "granddaughter", "grandma", "grandpa", "grandparent",
    "sister", "brother", "sibling", "niece", "nephew", "aunt", "uncle", "stepson", "stepdaughter", "infant", "teen", "expecting",
    "daycare", "day care", "preschool", "stroller", "crib", "diaper", "nanny", "babysitter",
    "grandmother", "grandfather", "stepmother", "stepfather", "stepchild", "stepchildren", "in-law", "in-laws", "mother-in-law", "father-in-law", "cousin", "twins",
  ],
  disability: [
    "disability", "disabled", "wheelchair", "handicap", "handicapped", "blind", "deaf", "service animal", "emotional support animal", "esa", "mental illness", "depression", "anxiety", "autism", "therapy", "medication", "hiv", "cancer", "chronic illness",
    "ptsd", "bipolar", "schizophrenia", "schizophrenic", "dementia", "alzheimer's", "diabetes", "diabetic", "epilepsy", "seizure", "paraplegic", "quadriplegic", "amputee", "crutches",
    "service dog", "caregiver", "caretaker", "autistic", "mental health", "psychiatric", "cane",
    "hearing aid", "sign language", "adhd", "ocd", "down syndrome", "cerebral palsy", "multiple sclerosis", "dialysis", "chemo", "chemotherapy", "sober", "sobriety", "rehab", "recovery",
  ],
  age: ["elderly", "senior", "senior citizen", "retired", "retiree", "young", "old lady", "old man", "teenager", "millennial"],
  marital_status: ["married", "divorced", "divorce", "widow", "widower", "widowed", "separated", "single", "spouse", "newlywed", "unmarried"],
  source_of_income: ["section 8", "voucher", "housing choice", "hud", "welfare", "ssi", "ssdi", "disability benefits", "food stamps", "calfresh", "unemployment benefits",
    "medicaid", "medi-cal", "medicare", "snap", "ebt", "social security", "pension", "child support", "alimony"],
  citizenship_immigration: ["citizen", "citizenship", "undocumented", "illegal alien", "green card", "visa", "immigration status", "deported"],
  military_veteran: ["veteran", "military", "army", "navy", "marine", "air force", "national guard", "coast guard", "deployed", "deployment"],
  genetic_info: ["genetic", "dna test"],
  primary_language: [
    "english", "spanish", "spanish speaker", "mandarin", "cantonese", "arabic", "hebrew", "farsi", "hindi", "tagalog", "interpreter", "translator",
    "doesn't speak", "language barrier",
  ],
  // California protects survivors of domestic violence (Civ. Code 1161.3; verify with counsel), and
  // housing status reads as source of income or disability often enough to over-redact.
  survivor_status: ["domestic violence", "domestic abuse", "restraining order", "protective order", "abuser", "abusive"],
  housing_status: ["homeless", "homelessness", "unhoused", "shelter"],
  criminal_history: ["arrest", "arrested", "conviction", "convicted", "felony", "felon", "jail", "prison", "probation", "parole", "criminal record", "police"],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One regex for the lexicon, longest phrases first so "service animal" wins over "animal".
 * Each term also matches its plural and possessive ("veterans", "wheelchairs", "vouchers",
 * "Christians", "grandkids'"), and a trailing -y term matches -ies.
 */
const term = (t: string) => (t.endsWith("y") ? `${escape(t.slice(0, -1))}(?:y|ies|ys)` : `${escape(t)}(?:s|es)?`);
/** Unicode-aware word edges; \\b is ASCII-only and splits accented words. */
const L = String.raw`(?<![\p{L}\p{N}_])`;
const R = String.raw`(?![\p{L}\p{N}_])`;
const LEXICON = `${L}(?:${[...new Set(Object.values(PROTECTED_CATEGORIES).flat())].sort((a, b) => b.length - a.length).map(term).join("|")})(?:'s|s')?${R}`;

/** Ages stated outright: "72 years old", "72-year-old", "in her 60s", "sixty-something". */
const AGE = String.raw`\b(?:is|was|she's|he's|they're|aged?|turning|turned)\s+\d{2,3}\b(?!\s*(?:days?|weeks?|months?|years?|hours?|minutes?|units?|%|percent|sq|square|ft|feet|dollars?|miles?))|\b\d{1,3}[\s-]*(?:years?|yrs?)[\s-]*old\b|\bin (?:his|her|their|my|our) (?:early |mid |late )?(?:\d0s|twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties)\b|\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|\d0)[\s-]?something\b`;

export const PROTECTED_RE = new RegExp(`${LEXICON}|${AGE}`, "giu");
