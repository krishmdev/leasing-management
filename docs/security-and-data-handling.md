# Security and data handling

## Field encryption

`src/server/crypto/fieldEncryption.ts` encrypts columns ending in `Enc` with AES-256-GCM and a
fresh 12-byte IV.

- The stored form is `enc:v1:{keyId}:{base64(iv|ciphertext|tag)}`.
- The AAD is `enc:v1|key:{keyId}|agency:{agencyId}|{model}|id:{recordId}|{field}`. Ciphertext
  copied to another record, field, model or agency fails to decrypt. Tests cover each case,
  including copies made directly in the database.
- Record ids are UUIDv7s minted before insert. A trigger stops `id` or `agencyId` from changing
  on every table with encrypted columns, so the binding can't drift.
- Keys come from `PII_KEYRING` (JSON, keyId → 32-byte key) and `PII_ACTIVE_KEY_ID`, through a
  `KeyProvider` interface that a KMS could implement later.
- `pnpm pii:rotate` re-encrypts every field not already under the active key:
  - Because the envelope names its key, the key id in the AAD changes; the record binding
    doesn't.
  - Old keys must stay in the keyring until rotation has run.
  - Values that don't decrypt under their own binding are reported, not re-encrypted.
- Email lookup uses a blind index, `HMAC(PII_BLIND_INDEX_KEY, agencyId|field|normalized)`, so
  the same email differs per agency. The blind-index key can't be rotated yet.

## Link tokens

Showing, reference and lease links carry `base64url(HMAC(TOKEN_KEY, purpose|rowId|version))`.
Only the sha256 is stored. A token can be re-derived to render an email again, and bumping the
version reissues it. The reference form is single-use (a status compare-and-set). The lease
token can replay a completed signature but can't create a second one.

## Access

Staff roles and permissions live in `src/server/access.ts`, and every staff page and action
checks membership in server code.

- **Revealing PII** takes a purpose from a fixed list and writes an audit row. Only the purpose
  code is stored in it.
- **Maintenance staff** have no PII permission.
- **Documents** download through `/api/documents/{id}` for staff of the agency, the applicant, or
  the holder of the lease link. Every download is audited.
- **Ticket photos** are checked by their bytes (JPEG, PNG or WebP only) and re-encoded with
  sharp, which drops EXIF and GPS. They're served only to agency staff and the reporting
  resident.

## Audit

`AuditLog` is append-only: a trigger rejects UPDATE, DELETE and TRUNCATE. The `audit()` helper
refuses metadata keys that look like PII. Audit rows are written in the same transaction as the
change they describe.

## Retention

The nightly `retention.purge` job (and `pnpm pii:purge`) works to these defaults. Confirm the
periods with counsel; the FTC Disposal Rule is 16 CFR 682.

- **Credit detail, after 120 days** (from the decision, or from closing without one): the
  encrypted score and key factors, score model, range and date; the score block encrypted on the
  adverse-action notice; and the notice PDF file.
- **Declined or withdrawn applicants, after 730 days:**
  - encrypted name, phone, income and residence fields;
  - reference free text and model analysis;
  - redacted prompt copies, stored model outputs and step outputs that carried them;
  - every agent step's stored input (the rubric step's input holds income and rent);
  - the rationale text, interest messages, and consent IP and user agent;
  - every PDF for the application (lease, notice, decision letters);
  - the lead's contact fields, when they have no other application or residency.
- **What stays.** Status, decision, reason codes, the notice row, the credit band and counts,
  each document's sha256, and the rubric step's output. That output has the score lines with
  derived text such as "3.10x tenant-portion rent", but not the income or rent amounts. It's
  kept so the decision can still be shown to have been made and sent.
- **Files.** A PDF is deleted after its row is marked purged. A failed delete is logged, and
  each run sweeps purged documents whose file is still on disk. A download of a purged
  document returns 410.
- **Better Auth rows.** An applicant's user, session, account and verification rows are deleted
  only if the same user has no staff membership, other application or residency at any agency.

## Known gaps

- There's no Postgres row-level security; isolation is enforced in the application. The raw-SQL
  check is a heuristic, not a boundary.
- Better Auth stores `user.email` in plaintext (the purge removes it with the applicant).
- Uploads and PDFs are on local disk (`storage/`), not encrypted object storage.
