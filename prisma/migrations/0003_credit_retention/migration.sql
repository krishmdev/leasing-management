-- Credit detail is encrypted everywhere it's kept, and purged columns can be null.
ALTER TABLE "Lead" ALTER COLUMN "nameEnc" DROP NOT NULL, ALTER COLUMN "emailEnc" DROP NOT NULL;
ALTER TABLE "ScreeningResult" DROP COLUMN "keyFactors", ADD COLUMN "keyFactorsEnc" TEXT;
ALTER TABLE "AdverseActionNotice" ADD COLUMN "craScoreEnc" TEXT;
ALTER TABLE "GeneratedDocument" ADD COLUMN "purgedAt" TIMESTAMPTZ(3);

-- AdverseActionNotice now holds an encrypted column, so its identity is frozen too.
CREATE TRIGGER adverse_notice_identity BEFORE UPDATE ON "AdverseActionNotice" FOR EACH ROW EXECUTE FUNCTION forbid_identity_change();
ALTER TABLE "OutboxMessage" ALTER COLUMN "availableAt" SET DEFAULT CURRENT_TIMESTAMP;
