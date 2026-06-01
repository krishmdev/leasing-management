# Screening and compliance

This describes what the code does. It is not legal advice, and every jurisdiction-specific rule
below is marked "verify with counsel" in the product too.

## What is collected

The application asks for:

- a legal name, phone and move-in date;
- the number of occupants (used only for occupancy limits, never scored);
- past addresses and landlord contacts;
- income and any rent subsidy.

It never asks for SSN, date of birth, sex, marital status, children, national origin,
citizenship, disability or criminal history. Pets are asked about with a note that assistance
animals are not pets.

The screening provider collects SSN and DOB on its own page. The platform receives:

- a credit band;
- eviction judgment and non-medical collection counts;
- identity and income verification flags;
- a report id;
- the score, score model, range, key factors and date. These are kept only for the
  adverse-action disclosure, encrypted (on the result and on the notice), and purged after
  120 days along with the notice PDF.

Applicants are told not to type an SSN or date of birth into free-text fields. Reference text,
interest messages and repair requests that look like an SSN are refused, and the redactor
masks SSN- and date-of-birth-shaped strings before any text reaches a model.

## The rubric

This is criteria version 1 (`src/server/domain/screening/criteria.ts`). Versions are immutable
rows, and an application is scored against the version locked at submit.

- **Income, 35 points.** Monthly income over the tenant's share of rent. Subsidy is subtracted
  first (California source-of-income rules; verify with counsel). Bands: 3.0x → 35,
  2.5x → 28, 2.0x → 18.
- **Credit, 25 points.** Excellent 25, good 21, fair 14, poor 5. No score counts as neutral
  (14) and is flagged for a person. A subsidized applicant who offers other evidence of ability
  to pay is scored on that instead (SB 267; verify with counsel), and flagged.
- **Evictions, 15 points.** Landlord-prevailed judgments in 5 years. Any judgment gives 0 points
  and is flagged.
- **Collections, 10 points.** Non-medical only; the MockCRA summary already excludes medical and
  COVID-era rental debt (verify with counsel).
- **References, 15 points.** 70% structured answers and 30% model-read text. The criteria schema
  caps the text share at 0.3, so the model moves at most 4.5 points.

## Guardrails around the model

- Prompt builders only accept strict zod DTOs (`src/server/ai/guardrails/dto.ts`). A Prisma
  row, or anything carrying names, contacts, occupants or pets, fails to parse.
- Free text is redacted before any model call (`guardrails/redact.ts`, `protectedTerms.ts`).
  Redaction covers:
  - emails, phones, and the applicant's and landlord's names;
  - a protected-class lexicon (FHA; California FEHA/Unruh; criminal history under the Oakland
    and Berkeley Fair Chance ordinances), with plurals, demonyms, kinship words and stated ages.

  Only the count of redactions is stored.
- The same scan runs on model output. A rationale that trips it is replaced with a template,
  and the case is flagged.
- If a model call fails, reference scoring and triage fall back to the offline lexicon. The
  rationale falls back to the template.

## Decisions and notices

- A declined or conditionally approved application gets a notice. It lists the chosen reasons,
  each tagged with its basis: consumer report, third party, or the applicant's own information.
- When at least one chosen reason is based on the consumer report, the notice gives the
  §615(a) block (a report that exists but didn't drive the outcome isn't cited):
  - the CRA's name, address, phone and website;
  - a statement that the CRA didn't make the decision;
  - the right to a free report within 60 days and the right to dispute;
  - the score used, its range, up to four key factors and its date.
- When a third-party reason (landlord references) was chosen, it adds a courtesy disclosure
  modeled on §615(b): the applicant may ask in writing for the nature of that information.
  Whether §615(b) strictly applies here is a question for counsel.
- A conditional approval notice says it's approval on less favorable terms and lists the
  conditions.
- The wording in `src/worker/documents/templates.tsx` is a sample; verify with counsel.
- Declines are never executed automatically at any automation level. A staff decline has to
  pick at least one reason. Overriding the recommendation requires a written reason, which is
  stored.

## Not done

- SmartMove is documented in `providers/smartmove.stub.ts` but not wired up. It needs a partner
  agreement.
- The notices and lease have not been reviewed by a lawyer.
- There is no application fee handling, adverse-action mailing by post, or record of
  delivery beyond the email being accepted by the transport.
