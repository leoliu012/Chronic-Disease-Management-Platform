-- clinical-disposition-v5
-- Establish a single clinical disposition chain: RiskEpisode -> Task, with RiskAlert as signals.

CREATE TYPE "RiskEpisodeStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

ALTER TABLE "Task"
  ADD COLUMN "riskEpisodeId" TEXT,
  ADD COLUMN "openRiskEpisodeKey" TEXT,
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "RiskAlert"
  ADD COLUMN "sourceQuestionnaireResultId" TEXT,
  ADD COLUMN "riskEpisodeId" TEXT;

ALTER TABLE "HospitalVisitReminder"
  ADD COLUMN "sourceTaskId" TEXT,
  ADD COLUMN "riskEpisodeId" TEXT;

CREATE TABLE "RiskEpisode" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "riskCategory" TEXT NOT NULL,
  "correlationKey" TEXT NOT NULL,
  "openKey" TEXT,
  "firstTriggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastTriggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "peakRiskLevel" "RiskLevel" NOT NULL,
  "status" "RiskEpisodeStatus" NOT NULL DEFAULT 'OPEN',
  "openTaskId" TEXT,
  "triggerCount" INTEGER NOT NULL DEFAULT 1,
  "latestEvidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RiskEpisode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RiskEpisode_openKey_key" ON "RiskEpisode"("openKey");
CREATE INDEX "RiskEpisode_patientId_status_lastTriggeredAt_idx" ON "RiskEpisode"("patientId", "status", "lastTriggeredAt");
CREATE INDEX "RiskEpisode_riskCategory_status_lastTriggeredAt_idx" ON "RiskEpisode"("riskCategory", "status", "lastTriggeredAt");
CREATE INDEX "RiskEpisode_correlationKey_status_idx" ON "RiskEpisode"("correlationKey", "status");
CREATE INDEX "RiskEpisode_openTaskId_idx" ON "RiskEpisode"("openTaskId");

CREATE UNIQUE INDEX "Task_openRiskEpisodeKey_key" ON "Task"("openRiskEpisodeKey");
CREATE INDEX "Task_riskEpisodeId_status_idx" ON "Task"("riskEpisodeId", "status");
CREATE INDEX "Task_priority_status_dueAt_idx" ON "Task"("priority", "status", "dueAt");
CREATE INDEX "RiskAlert_sourceQuestionnaireResultId_idx" ON "RiskAlert"("sourceQuestionnaireResultId");
CREATE INDEX "RiskAlert_riskEpisodeId_status_idx" ON "RiskAlert"("riskEpisodeId", "status");
CREATE INDEX "HospitalVisitReminder_sourceTaskId_idx" ON "HospitalVisitReminder"("sourceTaskId");
CREATE INDEX "HospitalVisitReminder_riskEpisodeId_idx" ON "HospitalVisitReminder"("riskEpisodeId");

ALTER TABLE "RiskEpisode"
  ADD CONSTRAINT "RiskEpisode_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RiskEpisode"
  ADD CONSTRAINT "RiskEpisode_openTaskId_fkey"
  FOREIGN KEY ("openTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_riskEpisodeId_fkey"
  FOREIGN KEY ("riskEpisodeId") REFERENCES "RiskEpisode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RiskAlert"
  ADD CONSTRAINT "RiskAlert_riskEpisodeId_fkey"
  FOREIGN KEY ("riskEpisodeId") REFERENCES "RiskEpisode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
