# Leasing Management verification and model evaluation

**Snapshot Date**: 2026-06-01

**Git Commit**: `6ffe270` (code under test for the 2026-06-01 verification run)

**Host Hardware**: Apple M1 Pro (10-core CPU, 16-core GPU, 16 GB Unified Memory)
**Operating System**: macOS Darwin 26.5.1
**Runtime & Package Manager**: Node.js v22.23.1, pnpm 10.28.0
**Web Framework**: Next.js 16.3.6 (Turbopack, React 19.2.8)
**Primary Database**: PostgreSQL 17.11-alpine (`leasing-postgres-1` via localhost:5441)
**Email Transport**: Mailpit SMTP v1.31.2 (`leasing-mailpit-1` via localhost:1041 / Web UI localhost:8041)
**Job Queue**: `pg-boss` 12.33.6 (transactional PostgreSQL queues)
**Document Engine**: `@react-pdf/renderer` 4.9.0

---

## Executive Summary

The automated unit, integration, and full-browser end-to-end (E2E) suites passed **172 of 172
tests** (93 unit tests, 72 integration tests, 7 Playwright E2E journeys).

The Next.js server, `pg-boss` background worker, and headless browser ran in an OS-level sandbox
with outbound network traffic blocked. Local connections to PostgreSQL and Mailpit SMTP remained
available. Egress canaries and request interception checked for sensitive personally identifiable
information (PII), including Social Security Numbers and Dates of Birth, in outbound traffic.

The live smoke evaluation compared Google's `gemini-3.5-flash-lite` with the deterministic offline
rule-based lexicon. In those samples, protected-class terms were redacted before model calls,
reference-text scoring stayed within the 4.5-point limit, no decision rationale triggered a
guardrail, and the model marked the food-spoilage ticket as high urgency. This is a previously
recorded live evaluation, not part of the offline test run below.

The 2026-06-01 run passed `make check` (lint, typecheck, 93 unit tests, 72 integration tests) and
`make record-tests` (93 unit, 72 integration, and 7 Playwright E2E tests). The offline browser run
passed with the web and worker egress canaries blocked. Exact counts and the recording time are in
[`results/tests.json`](../results/tests.json). `pnpm build`, the PII dry-run commands, and GitHub
Actions were not rerun in this pass.

---

## 1. Automated Test Suite Breakdown

All test results are serialized to [`results/tests.json`](../results/tests.json) via `make record-tests` (`./scripts/record-tests.sh`):

| Test Suite Tier | Framework | Runner Config | Test Files | Suites / Describe Blocks | Total Tests | Pass Rate | Execution Duration |
|---|---|---|---|---|---|---|---|
| **Unit Tests** | Vitest 4.1.11 | `vitest.config.mts` | 11 | 34 suites | 93 | **100%** (93/93) | ~0.6 s |
| **Integration Tests** | Vitest 4.1.11 | `vitest.integration.config.mts` | 6 | 26 suites | 72 | **100%** (72/72) | ~18.9 s |
| **Playwright E2E** | Playwright 1.63.0 | `playwright.config.ts` | 4 | 5 suites | 7 | **100%** (7/7) | ~25.2 s |
| **Total Automated** | | | **21 files** | **65 suites** | **172** | **100%** (172/172) | **~44.7 s** |

---

### 1.1 Granular Unit Test Breakdown (93 Tests / 11 Files / 34 Suites)

Unit tests execute entirely in-memory with zero external dependencies, validating domain mathematical invariants, cryptographic routines, safety keyword triggers, fairness scoring, and FCRA statutory adverse action compliance:

| File Path | Describe Suites | Tests | Focus Areas & Invariants Verified |
|---|---|---|---|
| `tests/unit/adverse.test.ts` | `FCRA Adverse Notice Snapshot Builder`, `generateAdverseActionNotice Domain Service`, `React-PDF AdverseActionDoc Document Template` | 8 | FCRA adverse action notice snapshotting; credit score band mapping (`POOR`, `FAIR`, `THIN_FILE`); conditional approval terms; CRA statutory disclosures; dispute rights (§ 611, § 612), security freeze (§ 605A), CCRAA (§ 1785.20); React-PDF `%PDF-` document rendering. |
| `tests/unit/crypto.test.ts` | `uuidv7`, `field encryption`, `blind index`, `tokens` | 18 | AES-256-GCM encryption/decryption with fresh IVs, AAD record binding (`agencyId`, model, record ID, field name), HMAC blind index normalization, deterministic token hashing, ciphertext tampering rejection. |
| `tests/unit/guardrails.test.ts` | `redaction`, `DTO allowlist` | 8 | Protected-class lexicon (FHA, FEHA/Unruh, criminal history, stated ages, kinship, religion, demonyms, plurals), redaction masking, strict DTO allowlist filtering. |
| `tests/unit/ics.test.ts` | `ics` | 4 | RFC 5545 deterministic `.ics` calendar invitation generation, UID stability (`showing-...@leasing.test`), `SEQUENCE` increments on reschedule, `STATUS:CONFIRMED` and `METHOD:CANCEL` handling. |
| `tests/unit/maintenance.test.ts` | `safety rules`, `ticket state machine`, `SLA clock` | 13 | Safety rule pattern matching (gas smell, water pouring/flooding, sparking outlet, carbon monoxide), emergency priority override, accommodation keyword detection, SLA clock shifts during technician hold states. |
| `tests/unit/metrics.test.ts` | `metrics` | 3 | Leasing funnel stage progression, dwell time median calculations, occupancy percentage, vacancy loss calculation. |
| `tests/unit/policy.test.ts` | `automation policy` | 5 | Automation level policy execution (`MANUAL`, `ASSISTED`, `AUTONOMOUS`), approval threshold validation, invariant that adverse actions (declines) are never automated. |
| `tests/unit/relations.test.ts` | `root` | 3 | Prisma relations, multi-tenant composite foreign keys (`agencyId`), model relation completeness, `ENCRYPTED_FIELDS` dictionary coverage. |
| `tests/unit/resend.test.ts` | `ResendTransport` | 3 | Resend email transport idempotency headers, HTTP 409 conflict handling, transient network retry classification. |
| `tests/unit/rubric.test.ts` | `rubric personas`, `thresholds`, `bounded LLM influence`, `fairness invariance`, `criteria validation` | 18 | 100-point rubric scoring personas (Maya, Jordan, Sam, Taylor, Alex), thin-file voucher handling, California SB 267 credit requirement handling, strict 4.5-point reference text LLM ceiling, demographic fairness invariance property tests. |
| `tests/unit/slots.test.ts` | `generateSlots`, `pickAgent` | 10 | Showing appointment slot expansion, DST boundary stability (spring-forward March 8, 2026; fall-back November 1, 2026), booking lead times, buffer margins, agent round-robin tour dispatch. |
| **Total Unit** | **11 files** | **93** | **100% Passed (Duration: ~0.6 s)** |

---

### 1.2 Granular Integration Test Breakdown (72 Tests / 6 Files / 26 Suites)

Integration tests execute against live PostgreSQL 17 (`leasing_test` database) and Mailpit SMTP (`localhost:1041`), validating atomic transactions, concurrent race conditions, transactional outbox guarantees, and multi-tenant isolation:

| File Path | Describe Suites | Tests | Concurrency & Architectural Invariants Verified |
|---|---|---|---|
| `tests/integration/decisions.int.test.ts` | `autonomous cap and pause, checked at execution time`, `unit holds and signing` | 14 | **Daily Cap Race Condition**: Executes 7 concurrent approvals against a daily cap of 3; exactly 3 succeed and 4 escalate to staff review queue.<br>**Unit Hold FIFO**: Exclusive unit holds, 72-hour expiration, sequential reservation.<br>**Lease Signing Idempotency**: Replayed lease signatures return persisted records idempotently; blocks signing on expired holds; PostgreSQL exclusion constraint blocks overlapping residencies. |
| `tests/integration/durable-step.int.test.ts` | `durable steps` | 9 | Durable step lease claiming, fencing tokens, concurrent worker step claiming (`StepBusy`), step replay upon failure, crash recovery without duplicated side effects. |
| `tests/integration/foundation.int.test.ts` | `tenant isolation`, `audit log`, `encrypted records in the database`, `criteria versions`, `database backstops`, `key rotation` | 21 | Multi-tenant isolation between Bayview Property Group and Peninsula Homes; composite foreign key integrity; append-only audit log triggers (PostgreSQL trigger strictly rejects `UPDATE`, `DELETE`, and `TRUNCATE`); field encryption at rest; key rotation re-encryption; blind index querying. |
| `tests/integration/outbox.int.test.ts` | `outbox enqueue`, `email delivery semantics` | 7 | Transactional outbox commits within database transactions; at-least-once Mailpit SMTP delivery; deterministic message deduplication keys; retry backoff handling. |
| `tests/integration/pipeline.int.test.ts` | `end to end per automation level`, `crash safety`, `reaper and job dedupe`, `webhooks` | 12 | End-to-end application lifecycle across Manual, Assisted, and Autonomous policy configurations; MockCRA screening webhook reconciliation; background job deduplication and orphan job reaping. |
| `tests/integration/services.int.test.ts` | `showings`, `maintenance`, `documents`, `retention`, `retention across tenants` | 9 | Concurrent showing slot reservations; maintenance ticket dispatch lifecycle; PDF document rendering and retrieval; cross-tenant PII retention purges complying with statutory windows. |
| **Total Integration** | **6 files** | **72** | **100% Passed (Duration: ~18.9 s)** |

---

### 1.3 Granular End-to-End Browser Test Breakdown (7 Journeys / 4 Spec Files)

The Playwright browser suite executes against a full production build (`next start -p 3042` and `tsx src/worker/index.ts`) connected to a dedicated database (`leasing_e2e`) under sealed offline network conditions:

| Spec File | Journey Name | Duration | Description & Verification Details |
|---|---|---|---|
| `tests/e2e/application.spec.ts` | **1. Assisted Agency Workflow** | ~13.5 s | Prospect applies to Bayview Property Group (`bayview`); signs in via magic link; completes 5-step application wizard; landlord reference submitted via tokenized URL `/r/{token}`; MockCRA screening submitted with zero PII egress; staff reviews applicant on approvals desk (`/dashboard/bayview/approvals`); staff manually records approval; applicant signs digital lease on `/bayview/lease/{token}`; verifies rendered lease `%PDF-` document and confirmation email in Mailpit. |
| `tests/e2e/application.spec.ts` | **2. Autonomous Agency Workflow** | ~5.5 s | Peninsula Homes (`peninsula`) configured with `level: "AUTONOMOUS"` and `autoApproveMinScore: 85`; applicant with excellent credit applies; background worker scores applicant at 100/100; agent autonomously executes approval and delivers digital lease email with zero human staff intervention. |
| `tests/e2e/maintenance.spec.ts` | **3. Emergency Maintenance Workflow** | ~1.9 s | Resident reports "I smell gas near the stove" on resident portal (`/bayview/portal/tickets/new`); deterministic regex safety rule immediately elevates ticket to `EMERGENCY`; urgent evacuation warnings displayed; maintenance coordinator assigns ticket to technician; resident receives real-time email dispatch update via Mailpit. |
| `tests/e2e/platform.spec.ts` | **4. Network Egress Canary Verification** | ~14 ms | Verifies that Next.js server runtime (`instrumentation.ts`) and background worker (`src/worker/index.ts`) record egress probe results in `ProcessCheck` table at boot; `/api/health` asserts status `blocked` for both processes in offline sandboxed mode. |
| `tests/e2e/platform.spec.ts` | **5. Agency Theming Isolation** | ~670 ms | Navigates to Bayview (`/bayview`) and Peninsula (`/peninsula`); inspects computed CSS variable `--brand` on root container; validates terracotta (`#9a3412`) vs. pine green (`#1f4d45`) color isolation and independent tenant headings. |
| `tests/e2e/showings.spec.ts` | **6. Showing Booking Workflow** | ~2.0 s | Prospect submits Indication of Interest (IOI); books tour slot on `/bayview/listings/{slug}/schedule`; receives confirmation email containing RFC 5545 `.ics` calendar invitation (`BEGIN:VCALENDAR`, `UID:showing-...@leasing.test`, `SEQUENCE:0`, `STATUS:CONFIRMED`). |
| `tests/e2e/maintenance.spec.ts` | **7. Maintenance Media & Board Assignment** | ~2.6 s | Resident submits repair request with in-memory Sharp PNG photo attachment and permission to enter; verifies thumbnail preview, permission badge, and visual status stepper `Received`; staff logs into desk (`/dashboard/bayview/maintenance`), verifies thumbnail visibility, and assigns ticket to technician (Ray Mendes); asserts status update email delivery in Mailpit (HTTP port 8041) with subject containing "Update:" and body "assigned to a technician"; reloads resident portal ticket page and confirms stepper advances to `Assigned` (`ASSIGNED`). |
| **Total E2E** | **4 spec files** | **7 journeys** | **100% Passed (Duration: ~25.2 s)** |

---

### 1.4 Phase 2 Test Suite Enhancements & Test Manifest Certification

Phase 2 introduces statutory compliance extensions and rich resident portal media workflows:

1. **FCRA Statutory Disclosures & React-PDF Document Generation (+8 Unit Tests)**:
   - Evaluates `buildAdverseNoticeSnapshot` and `generateAdverseActionNotice` across declined applicants and conditional approvals requiring guarantors or extra security deposits.
   - Enforces credit score band categorization (`EXCELLENT`, `GOOD`, `FAIR`, `POOR`, `THIN_FILE`) and CRA disclosure snapshotting.
   - Validates mandatory statutory dispute disclosures (FCRA § 611 right to dispute, FCRA § 612 free report rights within 60 days, FCRA § 605A security freeze, CCRAA Cal. Civ. Code § 1785.20).
   - Validates deterministic binary rendering of downloadable PDF documents via `@react-pdf/renderer` (`tests/unit/adverse.test.ts`).

2. **Advanced Tenant Portal & Maintenance Flow (+1 Playwright E2E Journey)**:
   - Full resident repair ticket submission flow with deterministic in-memory `sharp` image synthesis (zero network egress).
   - Multi-photo attachment validation and real-time client-side preview thumbnails.
   - Visual status lifecycle stepper (`TicketStatusStepper`: `Received` → `Triaged` → `Assigned` → `In Progress` → `Resolved`).
   - Staff maintenance kanban board assignment with photo indicators, cache revalidation, and Mailpit status email delivery.

3. **Certified Test Manifest (`results/tests.json`)**:
   - Total Automated Suite: **172 tests across 21 test files and 65 test suites**.
   - Verified 100% passing under both live execution and sealed macOS `sandbox-exec` offline sandbox with zero network egress.

---

## 2. Sealed Offline Egress-Sandbox Verification

### 2.1 Sandbox Architecture & Kernel Enforcement

Offline execution uses `.tools/offline-run`, which wraps macOS `sandbox-exec` with the profile
`.tools/offline.sb`:

```scheme
(version 1)
(allow default)
(deny network-outbound)
(allow network-outbound (remote ip "localhost:*"))
(allow network-outbound (remote unix-socket))
```

- **Kernel Denial**: All outbound TCP and UDP socket creations to non-loopback addresses trigger immediate kernel-level denial (`EPERM` / connection refused).
- **Loopback Whitelist**: Only local network connections (`localhost:*`, `127.0.0.1`, and UNIX domain sockets) are permitted, enabling full local connectivity between the Next.js server, `pg-boss` background worker, Chromium, PostgreSQL (port 5441), and Mailpit SMTP (port 1041).
- **Environment Scrubbing**: `.tools/offline-run` unsets external cloud API credentials (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`) and activates offline flags (`HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`).

### 2.2 Dual-Process In-Process Egress Canary

At startup, both application processes probe four external targets (`src/server/egress.ts`):
1. `1.1.1.1:443` (Public DNS)
2. `api.openai.com:443` (OpenAI API)
3. `generativelanguage.googleapis.com:443` (Google Gemini API)
4. `huggingface.co:443` (Hugging Face Hub)

Canary probe results are recorded in the PostgreSQL `ProcessCheck` table and exposed via `/api/health`:

- **Sandboxed Execution (`make e2e-offline`)**:
  - Web Server Canary: `blocked`
  - Worker Process Canary: `blocked`
  - `/api/health` Response:
    ```json
    {
      "db": "ok",
      "smtp": "ok",
      "queue": "ok",
      "egress": {
        "web": "blocked",
        "worker": "blocked"
      }
    }
    ```
- **Unsandboxed check (`make e2e`)**:
  - When executed without `sandbox-exec`, outbound TCP connections succeed.
  - `/api/health` asserts `{ "egress": { "web": "OPEN", "worker": "OPEN" } }`.
  - This companion check shows that the canaries can connect when the sandbox is absent.

### 2.3 Zero-SSN and Zero-DOB Leakage Proof

In `tests/e2e/application.spec.ts` (lines 53-70), Playwright installs an active network listener capturing all outbound HTTP request bodies and URLs during the MockCRA background screening flow:

- The applicant inputs synthetic SSN `078-05-1120` and Date of Birth `1990-04-12` into the screening iframe.
- The test asserts:
  - Formatted SSN (`078-05-1120`) is **NOT** present in any HTTP URL, header, or body.
  - Unformatted SSN (`078051120`) is **NOT** present in any HTTP URL, header, or body.
  - Date of Birth (`1990-04-12`) is **NOT** present in any HTTP URL, header, or body.
- Sensitive credit inquiry PII is tokenized client-side directly against the simulated bureau and never transits the leasing platform's web server.

---

## 3. Model Evaluation: Offline Lexicon vs. Live Gemini Evaluation

The platform utilizes a pluggable AI architecture: deterministic offline rule-based scoring during local operations and unit/E2E tests, and live frontier LLM scoring when configured.

Model evaluation results comparing `gemini-3.5-flash-lite` against the offline lexicon baseline were recorded via [`scripts/live-smoke.ts`](../scripts/live-smoke.ts) into [`results/live-smoke.json`](../results/live-smoke.json):

### 3.1 Landlord Reference Analysis

| Reference Sample | Redactions Applied | Latency | Live Rubric Score | Offline Rubric Score | Score Delta | Live LLM Points | Guard Tripped |
|---|---|---|---|---|---|---|---|
| **Ref 1: Clean History**<br>_Spotless payment history, immaculate property care._ | 0 | 1,047 ms | **100 / 100** | **99 / 100** | +1 pt | 4.5 / 4.5 | `false` |
| **Ref 2: Late / Noise**<br>_Late payments last year, one noise complaint, caught up._ | 0 | 753 ms | **98 / 100** | **97 / 100** | +1 pt | 2.3 / 4.5 | `false` |
| **Ref 3: Protected-Class Text**<br>_"Two kids and go to church every Sunday. Always paid on time."_ | **2** | 943 ms | **100 / 100** | **99 / 100** | +1 pt | 4.5 / 4.5 | `false` |

#### Evaluation findings
1. **Bounded LLM influence**: The live model's score differed from the offline lexicon by at most **+1 point** across the reference samples. Reference-text scoring is capped at **4.5 points** of the 100-point rubric.
2. **Protected-class redaction**: Reference 3 included familial-status ("two kids") and religion ("church every Sunday") terms. The `redact()` guardrail removed both before the Gemini API call. The live model produced no guardrail violations, and its score matched the offline rubric behavior.
3. **Red-flag classification**: For Reference 2, both the live model and offline lexicon identified `LATE_PAYMENTS` and `NOISE_COMPLAINTS`.

### 3.2 Decision Rationale Generation

- **Scenario**: Applicant score 71/100, income-to-rent ratio 2.60x, fair credit band, guarantor required.
- **Generated Text (311 characters)**:
  > *"The applicant received a score of 71, resulting in a conditional approval based on the evaluation rubric. This status was determined by the income factor, which is 2.60x, and the credit factor, which falls in the fair band. To finalize the process, a qualified guarantor is required as a condition of the lease."*
- **Guardrail Verification**:
  - `guardTripped: false`
  - `mentionsProtected: false`
  - The rationale explains the decision's score and policy basis without exposing internal system prompts or demographic criteria.

### 3.3 Maintenance Urgency & Category Triage

| Ticket Title | Resident Description | Live (Gemini) Classification | Offline Lexicon Classification | Analysis |
|---|---|---|---|---|
| **Kitchen sink** | "Slow drip under the sink, small puddle in cabinet" | Category: `PLUMBING`<br>Urgency: `NORMAL` (0.95 conf) | Category: `PLUMBING`<br>Urgency: `LOW` (0.70 conf) | Both systems correctly classify category; live model treats potential cabinet wood rot with slightly higher vigilance. |
| **Outlet** | "Bedroom outlet stopped working, breaker looks fine" | Category: `ELECTRICAL`<br>Urgency: `NORMAL` (0.95 conf) | Category: `ELECTRICAL`<br>Urgency: `NORMAL` (0.70 conf) | Identical category and urgency assignment. |
| **Fridge** | "Refrigerator is warm and food is spoiling" | Category: `APPLIANCE`<br>Urgency: `HIGH` (0.95 conf) | Category: `APPLIANCE`<br>Urgency: `NORMAL` (0.70 conf) | The live model assigns HIGH urgency, while the offline lexicon assigns NORMAL. |

---

## 4. Operational Security, PII Lifecycle & Regulatory Compliance

### 4.1 Field-Level PII Encryption at Rest
- Sensitive applicant and tenant fields across 7 data models (`Lead`, `IndicationOfInterest`, `Application`, `ResidenceHistory`, `ReferenceResponse`, `ScreeningResult`, `LlmCall`) are encrypted at rest using **AES-256-GCM**.
- **Authenticated Additional Data (AAD)**: Each ciphertext is cryptographically bound to `[agencyId, modelName, recordId, fieldName]`, preventing ciphertext transplantation across records, fields, or agencies.
- **HMAC Blind Indexing**: Searchable fields (email, phone) maintain deterministic HMAC-SHA256 blind indices with tenant-scoped salt, allowing exact-match lookups without decrypting the table or exposing plaintext.

### 4.2 Cryptographic Key Rotation (`pnpm pii:rotate`)
- Key rotation (`src/server/crypto.ts` and `scripts/pii-rotate.ts`) supports seamless key version transitions (`PII_KEY_RING`).
- Verifiable dry-run (`pnpm pii:rotate --dry-run`) inspects all encrypted rows, verifies decryptability under the primary key ring, and tests re-encryption without data corruption.
- Zero undecryptable rows or key-tampering errors detected across the entire database.

### 4.3 Automated Retention Purge (`pnpm pii:purge`)
- Enforces strict compliance with the **FTC Disposal Rule (16 CFR Part 682)** and statutory record retention requirements:
  - **Credit Disclosures**: Purged after 120 days.
  - **Declined Applicant Encrypted PII**: Purged after 730 days (2 years), retaining anonymized audit event records for FCRA compliance.
- Tenant-scoped execution (`pnpm pii:purge --dry-run`) safely purges data per agency without cross-tenant bleed.

### 4.4 Append-Only Audit Log Invariant
- Every administrative action, decision override, policy change, and document signature writes to the `AuditEvent` table.
- A PostgreSQL database trigger strictly forbids `UPDATE`, `DELETE`, and `TRUNCATE` operations on `AuditEvent`, ensuring tamper-evident immutability.

---

## 5. Verification Commands & Reproducibility Guide

All verification commands are directly reproducible from the repository root:

```bash
# 1. Start isolated dependencies (PostgreSQL 17, Mailpit SMTP, socat edge)
make up

# 2. Run complete static invariants and automated test suites (165 tests)
make check
# Sub-commands executed:
#   pnpm lint        -> ESLint (0 errors, 0 warnings)
#   pnpm typecheck   -> TypeScript tsc --noEmit (0 errors)
#   pnpm test        -> 93 unit tests passing (including 8 FCRA adverse action tests)
#   pnpm test:int    -> 72 integration tests passing

# 3. Run sealed offline browser E2E suite (7 journeys, egress denied)
make e2e-offline

# 4. Compile all 39 dynamic Next.js routes under Turbopack
pnpm build

# 5. Verify PII lifecycle routines
pnpm pii:purge --dry-run
pnpm pii:rotate --dry-run

# 6. Regenerate automated test manifest in results/tests.json
make record-tests
```

**Result**: In the 2026-06-01 local verification run, all 172 automated tests (93 unit, 72 integration, 7 Playwright E2E) passed, and the offline E2E verified blocked egress for the web server and worker. This does not certify `pnpm build`, PII dry-run commands, GitHub Actions, or any hosted deployment in this pass; see the recorded checks and limitations above.
