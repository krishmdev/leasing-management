# Verification log

What was actually run on the development machine (Apple M1 Pro, macOS, Docker Desktop), and
where the results live. Counts come from the result files, which record the commit they were
produced at. They aren't copied here, so they can't drift from them.

## Test suites

`scripts/record-tests.sh` (`make record-tests`) runs, in order:

1. Unit tests (`pnpm test`).
2. Integration tests against Postgres 17 and Mailpit (`pnpm test:int`).
3. The Playwright suite with the whole stack inside the egress-blocking wrapper
   (`scripts/offline-run` on macOS, or `OFFLINE_WRAPPER`).

It refuses to write anything unless all three pass, then writes `results/tests.json` with pass
and fail counts and the commit hash.

What the suites cover:

- **Unit** (`tests/unit/`):
  - rubric personas and threshold edges, the 4.5-point cap on model influence, and fairness
    invariance (fast-check);
  - protected-term redaction, including inflected forms that aren't in the lexicon verbatim;
  - the DTO allowlist, automation policy (declines never automatic), and criteria validation;
  - DST-safe slot generation, `.ics` output, field encryption and AAD binding, blind index,
    and derived tokens;
  - SLA clocks, the ticket state machine, safety rules, the Resend 409 handling, and the
    adverse-action snapshot and PDF.
- **Integration** (`tests/integration/`):
  - tenant isolation, including nested includes and raw SQL, and composite foreign keys;
  - the append-only audit log, and exclusion constraints on showings, holds and residencies;
  - the durable step runner (busy, lease loss, drift, dead), the outbox delivery semantics
    (idempotent provider, SMTP duplicate, window expiry), and crash-after-provider-call
    reconciliation;
  - crash after the decision commit, the reaper, singleton job dedupe, the cap race, the pause
    race, concurrent signing, identical-response replay, and expired holds;
  - showings, maintenance photos (EXIF stripped), document determinism, the retention purge
    (including users shared across agencies), and key rotation.
- **End to end** (`tests/e2e/`):
  - assisted flow: apply → reference → provider page → staff approval → e-sign;
  - an autonomous approval with no staff action;
  - maintenance: a gas emergency, and a photo ticket through assignment;
  - a showing with an `.ics` invite, and per-agency themes;
  - the egress canary.

## Offline proof

The e2e runner (`scripts/e2e.sh`) starts the production Next server and the worker with
`EGRESS_CANARY=1`. Each process tries to open TCP connections to 1.1.1.1:443, api.openai.com,
generativelanguage.googleapis.com and huggingface.co, and records what happened in the
`ProcessCheck` table. `/api/health` reports the latest result per process, and the platform
spec checks it:

- with `E2E_OFFLINE=1` under the wrapper, both processes must report `blocked`;
- without the wrapper (`make e2e`), both must report `OPEN`, so the check can't pass
  vacuously.

Both runs passed on the development machine on 2026-06-01. The wrapper, `scripts/offline-run`,
applies `scripts/offline.sb` with sandbox-exec: all outbound network is denied except
loopback and unix sockets, and provider API keys are unset.

In the assisted-flow spec, the test types an SSN and a date of birth into the MockCRA page. It
then asserts that neither value, formatted or not, appears in any request URL or body the
browser sent. The page's SSN and DOB inputs have no `name` attribute, so they aren't form data.

The Linux version of the offline run is `Dockerfile.e2e` plus the `e2e-offline` CI job: the app
container is attached only to the compose network, which is `internal: true`. It was built and
run locally; see the note at the end.

## Live model run

`results/live-smoke.json`, recorded 2026-06-01 with `scripts/live-smoke.ts`:

- Model: `gemini-3.5-flash-lite` through the AI SDK, with the key supplied from the
  environment at run time.
- Checked:
  - three landlord references, one containing two protected-class phrases that were redacted
    before the call;
  - one rationale for a conditional approval;
  - three maintenance tickets.
- Result:
  - Scores differed from the offline lexicon by one rubric point or less.
  - The rationale restated the rubric outcome and tripped nothing in the output guard.
  - Triage agreed with the offline classifier on every category, and rated two tickets one
    urgency level higher.
- The file includes the host manifest for the run.

Nothing else in the repository calls a live model; tests and the demo use the offline provider.

## Not verified

- The GitHub Actions workflow hasn't run yet; the repository hasn't been pushed.
- The Resend transport has never sent real email. Its request and response handling is covered
  by unit tests with a fake HTTP server.
- SmartMove is documented only.
- No hosted deployment.
