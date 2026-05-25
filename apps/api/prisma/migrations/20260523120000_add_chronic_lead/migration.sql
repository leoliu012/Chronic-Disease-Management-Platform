-- ChronicLead — patient-prestart-gate (高危慢病线索池)
--
-- 网关捞到的高危信号在患者签署知情同意之前先落到这张表，不进入正式档案。
-- 任何向 Patient 表升档的动作都必须经过签约接口 (consentSource 必填)。

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM (
    'PENDING_REVIEW',
    'CONTACTED',
    'SIGNED',
    'REJECTED',
    'DEFERRED',
    'EXPIRED'
);

-- CreateEnum
CREATE TYPE "LeadSourceChannel" AS ENUM (
    'HL7_DISCHARGE',
    'HL7_OUTPATIENT',
    'HL7_ABNORMAL_OBSERVATION',
    'FHIR_DISCHARGE',
    'FHIR_ENCOUNTER',
    'FHIR_CONDITION',
    'FHIR_OBSERVATION',
    'HIS_EVENT_DISCHARGE',
    'HIS_EVENT_ENCOUNTER',
    'HIS_EVENT_LAB',
    'INTERMEDIATE_DB',
    'MANUAL'
);

-- CreateEnum
CREATE TYPE "LeadConsentSource" AS ENUM (
    'MINI_PROGRAM_SIGN',
    'NURSE_CONFIRM',
    'DOCTOR_CONFIRM'
);

-- CreateTable
CREATE TABLE "ChronicLead" (
    "id" TEXT NOT NULL,
    "hospitalPatientId" TEXT,
    "idCardNo" TEXT,
    "phone" TEXT,
    "externalPatientId" TEXT,
    "name" TEXT,
    "gender" "Gender" NOT NULL DEFAULT 'UNKNOWN',
    "birthDate" TIMESTAMP(3),
    "sourceChannel" "LeadSourceChannel" NOT NULL,
    "sourceRecordId" TEXT,
    "sourceBatchId" TEXT,
    "suspectedDisease" "DiseaseType",
    "diagnosisIcd" TEXT,
    "diagnosisText" TEXT,
    "riskHint" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "evidenceSummary" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "consentSource" "LeadConsentSource",
    "consentRef" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "contactNote" TEXT,
    "deferNote" TEXT,
    "promotedPatientId" TEXT,
    "promotedAt" TIMESTAMP(3),
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChronicLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChronicLead_status_lastSeenAt_idx" ON "ChronicLead"("status", "lastSeenAt");
CREATE INDEX "ChronicLead_hospitalPatientId_idx" ON "ChronicLead"("hospitalPatientId");
CREATE INDEX "ChronicLead_idCardNo_idx" ON "ChronicLead"("idCardNo");
CREATE INDEX "ChronicLead_phone_idx" ON "ChronicLead"("phone");
CREATE INDEX "ChronicLead_suspectedDisease_riskHint_idx" ON "ChronicLead"("suspectedDisease", "riskHint");
CREATE INDEX "ChronicLead_sourceChannel_lastSeenAt_idx" ON "ChronicLead"("sourceChannel", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "ChronicLead" ADD CONSTRAINT "ChronicLead_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChronicLead" ADD CONSTRAINT "ChronicLead_promotedPatientId_fkey" FOREIGN KEY ("promotedPatientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
