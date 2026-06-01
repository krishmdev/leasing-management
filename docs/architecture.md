# Architecture

## Processes

- **Web** (Next.js 16, App Router). Serves:
  - the agency sites at `/{agency}`, the application at `/{agency}/apply`, the landlord form at
    `/r/{token}` and the resident portal at `/{agency}/portal`;
  - the staff desk at `/dashboard/{agency}`;
  - the MockCRA hosted page at `/mock-provider/{ref}` and its webhook target
    `/api/webhooks/screening/{provider}`.

  Mutations are server actions, except photo uploads, which use a route handler to avoid the
  server-action body limit.
- **Worker** (`src/worker/index.ts`, run with tsx). pg-boss consumers for `application.submitted`
  and `agent.evaluate`, plus crons:
  - the step reaper (5 min), hold sweeper (1 min), reference expiry (hourly), SLA breach check
    (5 min) and retention purge (nightly);
  - a loop that drains the outbox: emails, and PDFs rendered with React-PDF.
- **Postgres 17**. App tables, the `pgboss` schema, and a separate `mockcra` schema that only
  `src/mock-cra/` touches.
- **Mailpit** in development.

`proxy.ts` only maps `bayview.localhost` to `/bayview`. Authentication and membership checks
happen in server code (`src/server/session.ts`).

## Tenancy

Every tenant table has `agencyId`, and there are three layers on top of it:

1. `tenantDb(agencyId)` (`src/server/tenant.ts`), a Prisma client extension. It:
   - adds `agencyId` to every where clause and create;
   - refuses nested relation writes, and refuses any include/select/where path that reaches a
     tenant model through a global one (Organization, User, Member);
   - refuses raw SQL that doesn't filter on this tenant's `agencyId`.
2. Composite foreign keys `(agencyId, xId) -> (agencyId, id)` on every tenant-to-tenant
   relation, so a row can't point at another agency's row.
3. ESLint bans raw queries in domain code outside `tenantRaw`.

## Correctness under retries

pg-boss is at-least-once, so the queue schedules work and Postgres decides whether it still
needs doing.

- **`AgentStep`** (`src/server/agent/durable.ts`). One row per (application, criteria version,
  step), with a claim token and a lease.
  - Timing is fixed in `src/server/jobs/config.ts`: step hard timeout < job expiry < lease − 30s,
    and the retry delay is longer than the lease.
  - A busy step throws, so the job retries after the other runner's lease has passed.
  - Input drift or too many attempts marks the step `DEAD`.
- **Screening invite** (`src/server/domain/screening/invite.ts`). The request row commits before
  the provider call. On retry, the provider is asked about the idempotency key first.
- **Outbox** (`src/server/outbox/outbox.ts`). Rows are written in the business transaction with
  deterministic keys and claimed with a lease.
  - The SMTP transport is at-least-once.
  - The Resend transport sends `Idempotency-Key`. A retry older than the 24h window (less a
    5-minute margin) goes to `NEEDS_REVIEW`.
  - Renders are deterministic from row state and payload snapshots.
- **Lock order** everywhere: AgencySettings → Unit → Application → Lease → UnitHold
  (`src/server/domain/locks.ts`). Transactions retry on deadlock or serialization failure.
- **Queues** for agent work use pg-boss's `exclusive` policy, so singleton keys collapse
  duplicate sends.

## Holds, leases, residencies

- **Holds.** An approval places a hold: ACTIVE if the unit is free, otherwise WAITLISTED in FIFO
  order. The rules are enforced in the database:
  - a partial unique index allows one ACTIVE row per unit;
  - an exclusion constraint forbids overlapping ACTIVE windows;
  - another exclusion constraint forbids overlapping FUTURE/CURRENT/NOTICE residencies.
- **Signing** (`src/server/domain/leases/sign.ts):
  1. Lock the unit, then the lease.
  2. If a signature already exists, return it.
  3. Otherwise check the hold, the token expiry and the reviewed document's hash.
  4. Write the signature, residency, consumed hold and leased unit together.
- **Sweeper.** Expires holds, voids their leases, promotes the next applicant, and releases
  waitlisted holds on units that got leased.

## Where to look

| Concern | Files |
|---|---|
| Rubric and criteria | `src/server/domain/screening/rubric.ts`, `criteria.ts` |
| Model calls and guardrails | `src/server/ai/provider.ts`, `ai/guardrails/*`, `ai/offline.ts` |
| Pipeline | `src/server/agent/pipeline.ts` |
| Decisions and notices | `src/server/domain/decisions/decide.ts`, `screening/adverse.ts` |
| Encryption and tokens | `src/server/crypto/*` |
| Maintenance | `src/server/domain/maintenance/*` |
| Schema and hand-written constraints | `prisma/schema.prisma`, `prisma/migrations/0002_constraints/migration.sql` |
