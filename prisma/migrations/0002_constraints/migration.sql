-- Constraints and triggers that Prisma's schema language can't express. Hand-written; keep this
-- migration separate so `prisma migrate diff` output for 0001 stays regenerable.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Showings: an agent can't be double-booked. Half-open ranges so back-to-back slots are fine.
ALTER TABLE "Showing" ADD CONSTRAINT showing_agent_no_overlap
  EXCLUDE USING gist ("agentUserId" WITH =, tstzrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE (status = 'SCHEDULED');

-- Unit holds: at most one ACTIVE hold per unit at any instant. An ACTIVE hold whose range has
-- ended no longer blocks a new one, even before the sweeper flips it to EXPIRED.
ALTER TABLE "UnitHold" ADD CONSTRAINT unit_hold_active_window
  CHECK (status <> 'ACTIVE' OR ("startsAt" IS NOT NULL AND "expiresAt" > "startsAt"));
ALTER TABLE "UnitHold" ADD CONSTRAINT unit_hold_one_active
  EXCLUDE USING gist ("unitId" WITH =, tstzrange("startsAt", "expiresAt", '[)') WITH &&)
  WHERE (status = 'ACTIVE');

-- Residencies: backstop against two leases occupying the same unit on overlapping dates.
ALTER TABLE "Residency" ADD CONSTRAINT residency_dates_valid
  CHECK ("moveOut" IS NULL OR "moveOut" > "moveIn");
ALTER TABLE "Residency" ADD CONSTRAINT residency_no_overlap
  EXCLUDE USING gist ("unitId" WITH =, daterange("moveIn", COALESCE("moveOut", 'infinity'::date), '[)') WITH &&)
  WHERE (status IN ('FUTURE', 'CURRENT', 'NOTICE'));

-- One live application per lead and unit.
CREATE UNIQUE INDEX application_one_live_per_lead_unit
  ON "Application" ("leadId", "unitId") WHERE status <> 'WITHDRAWN';

ALTER TABLE "Unit" ADD CONSTRAINT unit_rent_positive CHECK ("rentCents" > 0 AND "depositCents" >= 0);
ALTER TABLE "Showing" ADD CONSTRAINT showing_range_valid CHECK ("endsAt" > "startsAt");
ALTER TABLE "AutomationQuota" ADD CONSTRAINT automation_quota_bounds CHECK (used >= 0 AND used <= cap);
ALTER TABLE "ReferenceResponse" ADD CONSTRAINT reference_condition_range CHECK ("propertyCondition" BETWEEN 1 AND 5);

-- Audit log is append-only.
CREATE FUNCTION audit_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit log is append-only';
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_block_mutation();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_block_mutation();

-- Criteria versions are immutable; publish a new version instead.
CREATE FUNCTION criteria_block_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'screening criteria are immutable; create a new version';
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER criteria_no_update BEFORE UPDATE ON "ScreeningCriteria"
  FOR EACH ROW EXECUTE FUNCTION criteria_block_update();

-- Encrypted fields bind their AAD to (agencyId, id). Changing either would orphan the ciphertext,
-- so both are frozen on every table that holds *Enc columns.
CREATE FUNCTION forbid_identity_change() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."agencyId" IS DISTINCT FROM OLD."agencyId" THEN
    RAISE EXCEPTION 'record identity is immutable on %', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER lead_identity BEFORE UPDATE ON "Lead" FOR EACH ROW EXECUTE FUNCTION forbid_identity_change();
CREATE TRIGGER ioi_identity BEFORE UPDATE ON "IndicationOfInterest" FOR EACH ROW EXECUTE FUNCTION forbid_identity_change();
CREATE TRIGGER application_identity BEFORE UPDATE ON "Application" FOR EACH ROW EXECUTE FUNCTION forbid_identity_change();
CREATE TRIGGER residence_identity BEFORE UPDATE ON "ResidenceHistory" FOR EACH ROW EXECUTE FUNCTION forbid_identity_change();
CREATE TRIGGER refresp_identity BEFORE UPDATE ON "ReferenceResponse" FOR EACH ROW EXECUTE FUNCTION forbid_identity_change();
CREATE TRIGGER screening_result_identity BEFORE UPDATE ON "ScreeningResult" FOR EACH ROW EXECUTE FUNCTION forbid_identity_change();
CREATE TRIGGER llm_call_identity BEFORE UPDATE ON "LlmCall" FOR EACH ROW EXECUTE FUNCTION forbid_identity_change();

-- MockCRA is a stand-in for a third-party screening company. Its data lives in its own schema
-- and only src/mock-cra/ touches it; the platform reads results through the provider adapter.
-- Note what's missing: no SSN or DOB column exists anywhere, here or in public.
CREATE SCHEMA mockcra;
CREATE TABLE mockcra.invitation (
  ref              text PRIMARY KEY,
  client_reference text NOT NULL,
  idempotency_key  text,
  applicant_email_sha256 text NOT NULL,
  rent_cents       integer NOT NULL,
  callback_url     text NOT NULL,
  status           text NOT NULL DEFAULT 'INVITED',
  persona          text,
  report_id        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);
CREATE UNIQUE INDEX mockcra_invitation_idem ON mockcra.invitation (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX mockcra_invitation_client_ref ON mockcra.invitation (client_reference);
CREATE TABLE mockcra.webhook_delivery (
  event_id     text PRIMARY KEY,
  ref          text NOT NULL REFERENCES mockcra.invitation(ref),
  event        text NOT NULL,
  delivered_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
