-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('AVAILABLE', 'PENDING', 'LEASED', 'OFF_MARKET');

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('INTEREST', 'SHOWING', 'APPLIED', 'SCREENED', 'DECISION', 'LEASE_SIGNED', 'LOST');

-- CreateEnum
CREATE TYPE "ShowingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REFERENCES_PENDING', 'SCREENING', 'SCREENED', 'DECISION_PENDING', 'APPROVED', 'CONDITIONAL', 'DECLINED', 'WITHDRAWN', 'LEASE_SENT', 'LEASE_SIGNED');

-- CreateEnum
CREATE TYPE "IncomeType" AS ENUM ('EMPLOYMENT', 'SELF_EMPLOYMENT', 'BENEFITS', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('FCRA_AUTHORIZATION', 'REFERENCE_CONTACT', 'ESIGN', 'PRIVACY');

-- CreateEnum
CREATE TYPE "ReferenceStatus" AS ENUM ('SENT', 'OPENED', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ScreeningStatus" AS ENUM ('PENDING_INVITE', 'INVITED', 'CONSENTED', 'IN_PROGRESS', 'COMPLETE', 'ERROR');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('APPROVE', 'CONDITIONAL', 'DECLINE', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "DecisionMode" AS ENUM ('MANUAL', 'ASSISTED', 'AUTONOMOUS');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('DECISION', 'DOCUMENTS', 'ADVERSE_ACTION', 'ESCALATION');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "OutboxKind" AS ENUM ('EMAIL', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENDING', 'DONE', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('LEASE', 'SIGNED_LEASE', 'SUMMARY', 'ADVERSE_ACTION');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'WAITLISTED', 'CONSUMED', 'EXPIRED', 'RELEASED');

-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('DRAFT', 'SENT', 'SIGNED', 'VOID');

-- CreateEnum
CREATE TYPE "ResidencyStatus" AS ENUM ('FUTURE', 'CURRENT', 'NOTICE', 'PAST');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('PLUMBING', 'ELECTRICAL', 'HVAC', 'APPLIANCE', 'PEST', 'STRUCTURAL', 'LOCKS_SECURITY', 'OTHER');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('EMERGENCY', 'HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'CANCELED');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "activeOrganizationId" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "metadata" TEXT,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviterId" TEXT NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencySettings" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "jurisdictionState" TEXT NOT NULL DEFAULT 'CA',
    "jurisdictionCity" TEXT,
    "theme" JSONB NOT NULL,
    "contact" JSONB NOT NULL,
    "automation" JSONB NOT NULL,
    "retention" JSONB NOT NULL,
    "automationPaused" BOOLEAN NOT NULL DEFAULT false,
    "holdHours" INTEGER NOT NULL DEFAULT 72,
    "activeCriteriaId" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AgencySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationQuota" (
    "agencyId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "cap" INTEGER NOT NULL,

    CONSTRAINT "AutomationQuota_pkey" PRIMARY KEY ("agencyId","day")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CA',
    "zip" TEXT NOT NULL,
    "neighborhood" TEXT,
    "amenities" TEXT[],
    "description" TEXT NOT NULL,
    "yearBuilt" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "beds" INTEGER NOT NULL,
    "baths" DOUBLE PRECISION NOT NULL,
    "sqft" INTEGER NOT NULL,
    "rentCents" INTEGER NOT NULL,
    "depositCents" INTEGER NOT NULL,
    "availableOn" DATE NOT NULL,
    "status" "UnitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "description" TEXT NOT NULL,
    "features" TEXT[],
    "petPolicy" TEXT NOT NULL DEFAULT 'Cats and small dogs considered. Assistance animals are not pets.',
    "listingAgentId" TEXT,
    "photoSeed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "nameEnc" TEXT NOT NULL,
    "emailEnc" TEXT NOT NULL,
    "emailBidx" TEXT NOT NULL,
    "phoneEnc" TEXT,
    "source" TEXT NOT NULL DEFAULT 'website',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'INTEREST',
    "stageChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lostReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageEvent" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "from" "OpportunityStage",
    "to" "OpportunityStage" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndicationOfInterest" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "desiredMoveIn" DATE NOT NULL,
    "messageEnc" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndicationOfInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityRule" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "slotMin" INTEGER NOT NULL DEFAULT 30,
    "bufferMin" INTEGER NOT NULL DEFAULT 15,

    CONSTRAINT "AvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityException" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "AvailabilityException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Showing" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ShowingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "icsUid" TEXT NOT NULL,
    "icsSequence" INTEGER NOT NULL DEFAULT 0,
    "manageTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Showing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "userId" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "statusChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "legalNameEnc" TEXT,
    "phoneEnc" TEXT,
    "desiredMoveIn" DATE,
    "totalOccupants" INTEGER,
    "incomeType" "IncomeType",
    "monthlyIncomeCents" INTEGER,
    "hasRentSubsidy" BOOLEAN NOT NULL DEFAULT false,
    "subsidyMonthlyCents" INTEGER,
    "altEvidenceProvided" BOOLEAN NOT NULL DEFAULT false,
    "criteriaVersionId" TEXT,
    "submittedAt" TIMESTAMPTZ(3),
    "purgedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidenceHistory" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "addressEnc" TEXT,
    "landlordNameEnc" TEXT,
    "landlordEmailEnc" TEXT,
    "landlordPhoneEnc" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "monthlyRentCents" INTEGER NOT NULL,
    "consentToContact" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ResidenceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "textVersion" TEXT NOT NULL,
    "textSha256" TEXT NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "ua" TEXT,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceRequest" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "residenceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'SENT',
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceResponse" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "referenceRequestId" TEXT NOT NULL,
    "paidOnTime" TEXT NOT NULL,
    "lateCount" INTEGER NOT NULL,
    "leaseViolations" BOOLEAN NOT NULL,
    "noticeGiven" BOOLEAN NOT NULL,
    "propertyCondition" INTEGER NOT NULL,
    "wouldRentAgain" TEXT NOT NULL,
    "freeTextEnc" TEXT,
    "respondentRole" TEXT NOT NULL,
    "attestation" BOOLEAN NOT NULL,
    "aiAnalysis" JSONB,
    "redactionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningCriteria" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "configSha256" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningCriteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningRequest" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "criteriaVersionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerApplicantRef" TEXT,
    "providerReportId" TEXT,
    "hostedUrl" TEXT,
    "status" "ScreeningStatus" NOT NULL DEFAULT 'PENDING_INVITE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScreeningRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningResult" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "screeningRequestId" TEXT NOT NULL,
    "creditBand" TEXT NOT NULL,
    "creditScoreEnc" TEXT,
    "scoreModel" TEXT,
    "scoreRangeMin" INTEGER,
    "scoreRangeMax" INTEGER,
    "keyFactors" TEXT[],
    "scoreDate" DATE,
    "evictionJudgmentsInLookback" INTEGER NOT NULL,
    "collectionsNonMedicalCount" INTEGER NOT NULL,
    "collectionsNonMedicalCents" INTEGER NOT NULL,
    "identityVerified" BOOLEAN NOT NULL,
    "incomeVerified" BOOLEAN NOT NULL,
    "craDisclosure" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ScreeningResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "criteriaVersionId" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "inputJson" JSONB,
    "inputSha256" TEXT,
    "outputJson" JSONB,
    "outputSha256" TEXT,
    "outputSummary" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "applicationId" TEXT,
    "purpose" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "redactedInputEnc" TEXT,
    "output" JSONB NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "criteriaVersionId" TEXT NOT NULL,
    "rubricScore" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "flags" TEXT[],
    "outcome" "Outcome" NOT NULL,
    "conditions" TEXT[],
    "rationale" TEXT NOT NULL,
    "rationaleSource" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "criteriaVersionId" TEXT NOT NULL,
    "outcome" "Outcome" NOT NULL,
    "mode" "DecisionMode" NOT NULL,
    "decidedByType" TEXT NOT NULL,
    "decidedById" TEXT,
    "reasonCodes" TEXT[],
    "overrodeRecommendation" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalTask" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "applicationId" TEXT,
    "ticketId" TEXT,
    "type" "TaskType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "escalationReasons" TEXT[],
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMPTZ(3),
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdverseActionNotice" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "reasonCodes" JSONB NOT NULL,
    "basis" TEXT[],
    "craSnapshot" JSONB NOT NULL,
    "documentId" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdverseActionNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "kind" "OutboxKind" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "firstAttemptAt" TIMESTAMPTZ(3),
    "lastAttemptAt" TIMESTAMPTZ(3),
    "transport" TEXT,
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMPTZ(3),

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "applicationId" TEXT,
    "leaseId" TEXT,
    "kind" "DocumentKind" NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitHold" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "HoldStatus" NOT NULL,
    "startsAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "queuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UnitHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lease" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "rentCents" INTEGER NOT NULL,
    "depositCents" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "LeaseStatus" NOT NULL DEFAULT 'DRAFT',
    "signTokenHash" TEXT NOT NULL,
    "signTokenExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "sentAt" TIMESTAMPTZ(3),
    "signedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "typedName" TEXT NOT NULL,
    "ip" TEXT,
    "ua" TEXT,
    "docSha256" TEXT NOT NULL,
    "signedAt" TIMESTAMPTZ(3) NOT NULL,
    "responseJson" JSONB NOT NULL,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Residency" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "leaseId" TEXT,
    "leadId" TEXT,
    "residentUserId" TEXT,
    "moveIn" DATE NOT NULL,
    "moveOut" DATE,
    "status" "ResidencyStatus" NOT NULL,
    "rentCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Residency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceTicket" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "residencyId" TEXT,
    "reporterUserId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL DEFAULT 'OTHER',
    "urgency" "Urgency" NOT NULL DEFAULT 'NORMAL',
    "aiTriage" JSONB,
    "triageSource" TEXT,
    "safetyRule" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "assigneeUserId" TEXT,
    "permissionToEnter" BOOLEAN NOT NULL DEFAULT false,
    "slaRespondBy" TIMESTAMPTZ(3),
    "slaResolveBy" TIMESTAMPTZ(3),
    "firstRespondedAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "onHoldSince" TIMESTAMPTZ(3),
    "pausedMs" INTEGER NOT NULL DEFAULT 0,
    "respondBreached" BOOLEAN NOT NULL DEFAULT false,
    "resolveBreached" BOOLEAN NOT NULL DEFAULT false,
    "escalatedAt" TIMESTAMPTZ(3),
    "possibleAccommodationRequest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MaintenanceTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketPhoto" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketComment" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorType" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "from" "TicketStatus",
    "to" "TicketStatus" NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "agencyId" TEXT NOT NULL,
    "urgency" "Urgency" NOT NULL,
    "respondMins" INTEGER NOT NULL,
    "resolveMins" INTEGER NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("agencyId","urgency")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessCheck" (
    "id" TEXT NOT NULL,
    "process" TEXT NOT NULL,
    "check" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "member_organizationId_idx" ON "member"("organizationId");

-- CreateIndex
CREATE INDEX "member_userId_idx" ON "member"("userId");

-- CreateIndex
CREATE INDEX "invitation_organizationId_idx" ON "invitation"("organizationId");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AgencySettings_agencyId_key" ON "AgencySettings"("agencyId");

-- CreateIndex
CREATE INDEX "Property_agencyId_idx" ON "Property"("agencyId");

-- CreateIndex
CREATE INDEX "Unit_agencyId_status_idx" ON "Unit"("agencyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_agencyId_slug_key" ON "Unit"("agencyId", "slug");

-- CreateIndex
CREATE INDEX "Lead_agencyId_idx" ON "Lead"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_agencyId_emailBidx_key" ON "Lead"("agencyId", "emailBidx");

-- CreateIndex
CREATE INDEX "Opportunity_agencyId_stage_idx" ON "Opportunity"("agencyId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_leadId_unitId_key" ON "Opportunity"("leadId", "unitId");

-- CreateIndex
CREATE INDEX "StageEvent_agencyId_at_idx" ON "StageEvent"("agencyId", "at");

-- CreateIndex
CREATE INDEX "IndicationOfInterest_agencyId_idx" ON "IndicationOfInterest"("agencyId");

-- CreateIndex
CREATE INDEX "AvailabilityRule_agencyId_agentUserId_idx" ON "AvailabilityRule"("agencyId", "agentUserId");

-- CreateIndex
CREATE INDEX "AvailabilityException_agencyId_agentUserId_idx" ON "AvailabilityException"("agencyId", "agentUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Showing_icsUid_key" ON "Showing"("icsUid");

-- CreateIndex
CREATE UNIQUE INDEX "Showing_manageTokenHash_key" ON "Showing"("manageTokenHash");

-- CreateIndex
CREATE INDEX "Showing_agencyId_startsAt_idx" ON "Showing"("agencyId", "startsAt");

-- CreateIndex
CREATE INDEX "Application_agencyId_status_idx" ON "Application"("agencyId", "status");

-- CreateIndex
CREATE INDEX "ResidenceHistory_agencyId_applicationId_idx" ON "ResidenceHistory"("agencyId", "applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRecord_applicationId_type_key" ON "ConsentRecord"("applicationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceRequest_tokenHash_key" ON "ReferenceRequest"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceRequest_applicationId_residenceId_key" ON "ReferenceRequest"("applicationId", "residenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceResponse_referenceRequestId_key" ON "ReferenceResponse"("referenceRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningCriteria_agencyId_version_key" ON "ScreeningCriteria"("agencyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningRequest_idempotencyKey_key" ON "ScreeningRequest"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningRequest_providerApplicantRef_key" ON "ScreeningRequest"("providerApplicantRef");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningRequest_applicationId_criteriaVersionId_key" ON "ScreeningRequest"("applicationId", "criteriaVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningResult_screeningRequestId_key" ON "ScreeningResult"("screeningRequestId");

-- CreateIndex
CREATE INDEX "AgentStep_agencyId_idx" ON "AgentStep"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentStep_applicationId_criteriaVersionId_stepName_key" ON "AgentStep"("applicationId", "criteriaVersionId", "stepName");

-- CreateIndex
CREATE INDEX "LlmCall_agencyId_inputHash_idx" ON "LlmCall"("agencyId", "inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_applicationId_criteriaVersionId_key" ON "Recommendation"("applicationId", "criteriaVersionId");

-- CreateIndex
CREATE INDEX "Decision_agencyId_createdAt_idx" ON "Decision"("agencyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_applicationId_criteriaVersionId_key" ON "Decision"("applicationId", "criteriaVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalTask_idempotencyKey_key" ON "ApprovalTask"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ApprovalTask_agencyId_status_idx" ON "ApprovalTask"("agencyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AdverseActionNotice_applicationId_key" ON "AdverseActionNotice"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMessage_idempotencyKey_key" ON "OutboxMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboxMessage_status_availableAt_idx" ON "OutboxMessage"("status", "availableAt");

-- CreateIndex
CREATE INDEX "OutboxMessage_agencyId_createdAt_idx" ON "OutboxMessage"("agencyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedDocument_idempotencyKey_key" ON "GeneratedDocument"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GeneratedDocument_agencyId_applicationId_idx" ON "GeneratedDocument"("agencyId", "applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitHold_applicationId_key" ON "UnitHold"("applicationId");

-- CreateIndex
CREATE INDEX "UnitHold_unitId_status_idx" ON "UnitHold"("unitId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Lease_applicationId_key" ON "Lease"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Lease_signTokenHash_key" ON "Lease"("signTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Signature_leaseId_signerId_key" ON "Signature"("leaseId", "signerId");

-- CreateIndex
CREATE UNIQUE INDEX "Residency_leaseId_key" ON "Residency"("leaseId");

-- CreateIndex
CREATE INDEX "Residency_agencyId_status_idx" ON "Residency"("agencyId", "status");

-- CreateIndex
CREATE INDEX "MaintenanceTicket_agencyId_status_idx" ON "MaintenanceTicket"("agencyId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_agencyId_createdAt_idx" ON "AuditLog"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "ProcessCheck_process_check_createdAt_idx" ON "ProcessCheck"("process", "check", "createdAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencySettings" ADD CONSTRAINT "AgencySettings_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageEvent" ADD CONSTRAINT "StageEvent_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndicationOfInterest" ADD CONSTRAINT "IndicationOfInterest_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Showing" ADD CONSTRAINT "Showing_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Showing" ADD CONSTRAINT "Showing_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_criteriaVersionId_fkey" FOREIGN KEY ("criteriaVersionId") REFERENCES "ScreeningCriteria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidenceHistory" ADD CONSTRAINT "ResidenceHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceRequest" ADD CONSTRAINT "ReferenceRequest_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceRequest" ADD CONSTRAINT "ReferenceRequest_residenceId_fkey" FOREIGN KEY ("residenceId") REFERENCES "ResidenceHistory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceResponse" ADD CONSTRAINT "ReferenceResponse_referenceRequestId_fkey" FOREIGN KEY ("referenceRequestId") REFERENCES "ReferenceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningRequest" ADD CONSTRAINT "ScreeningRequest_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResult" ADD CONSTRAINT "ScreeningResult_screeningRequestId_fkey" FOREIGN KEY ("screeningRequestId") REFERENCES "ScreeningRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitHold" ADD CONSTRAINT "UnitHold_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitHold" ADD CONSTRAINT "UnitHold_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Residency" ADD CONSTRAINT "Residency_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Residency" ADD CONSTRAINT "Residency_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketPhoto" ADD CONSTRAINT "TicketPhoto_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MaintenanceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MaintenanceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MaintenanceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

