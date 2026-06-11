-- patient-level-stratified-management-v9
-- Adds patient-level care plans, explainable stratification snapshots,
-- nurse-facing next-best-action proposals, and immutable risk-alert rule evidence.

CREATE TYPE "ClinicalRuleLifecycleStatus" AS ENUM (
  'DRAFT',
  'PHYSICIAN_REVIEW',
  'PUBLISHED',
  'EFFECTIVE',
  'DEACTIVATED'
);

ALTER TABLE "RiskAlert"
  ADD COLUMN "ruleId" TEXT,
  ADD COLUMN "ruleVersion" TEXT,
  ADD COLUMN "ruleSnapshot" JSONB,
  ADD COLUMN "evidenceBasis" TEXT,
  ADD COLUMN "evaluatedAt" TIMESTAMP(3),
  ADD COLUMN "inputSnapshot" JSONB,
  ADD COLUMN "matchedConditions" JSONB;

-- H5 demo questionnaire forms use a compact 0-9 UI score. Keep the original
-- value while persisting the governed template-range score in `score`.
ALTER TABLE "QuestionnaireResult" ADD COLUMN "rawScore" INTEGER;

ALTER TABLE "DiseaseRuleTemplate"
  ADD COLUMN "lifecycleStatus" "ClinicalRuleLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "evidenceBasis" TEXT,
  ADD COLUMN "effectiveFrom" TIMESTAMP(3),
  ADD COLUMN "effectiveUntil" TIMESTAMP(3),
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "publishedBy" TEXT,
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedBy" TEXT,
  ADD COLUMN "basedOnTemplateId" TEXT;

-- New versions start life as non-active Draft rows unless an explicit release
-- action activates them. Existing rows are normalized below before this default
-- begins applying to future inserts.
ALTER TABLE "DiseaseRuleTemplate" ALTER COLUMN "isActive" SET DEFAULT FALSE;

-- Existing templates were used before v9 had a release lifecycle. Preserve one
-- deterministic effective legacy version per disease. If historical data
-- accidentally contains multiple active versions, retain the most recently
-- updated version and deactivate the older duplicates before adding the partial
-- unique index below.
UPDATE "DiseaseRuleTemplate"
SET "lifecycleStatus" = 'DEACTIVATED',
    "deactivatedAt" = COALESCE("deactivatedAt", "updatedAt", "createdAt"),
    "evidenceBasis" = COALESCE("evidenceBasis", "riskBasis")
WHERE "isActive" = FALSE;

WITH ranked_active AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "diseaseType"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "DiseaseRuleTemplate"
  WHERE "isActive" = TRUE
)
UPDATE "DiseaseRuleTemplate" AS template
SET "lifecycleStatus" = CASE
      WHEN ranked_active.rn = 1 THEN 'EFFECTIVE'::"ClinicalRuleLifecycleStatus"
      ELSE 'DEACTIVATED'::"ClinicalRuleLifecycleStatus"
    END,
    "isActive" = ranked_active.rn = 1,
    "effectiveFrom" = CASE
      WHEN ranked_active.rn = 1 THEN COALESCE(template."effectiveFrom", template."createdAt")
      ELSE template."effectiveFrom"
    END,
    "effectiveUntil" = CASE
      WHEN ranked_active.rn = 1 THEN NULL
      ELSE COALESCE(template."effectiveUntil", CURRENT_TIMESTAMP)
    END,
    "publishedAt" = COALESCE(template."publishedAt", template."createdAt"),
    "evidenceBasis" = COALESCE(template."evidenceBasis", template."riskBasis"),
    "deactivatedAt" = CASE
      WHEN ranked_active.rn = 1 THEN NULL
      ELSE COALESCE(template."deactivatedAt", CURRENT_TIMESTAMP)
    END
FROM ranked_active
WHERE template."id" = ranked_active."id";

-- Before v9, the local unified demo seed used placeholder questionnaire JSON
-- without min/max score bands. Correct only those known placeholder rows while
-- adopting governance. Customized hospital rows are intentionally untouched.
WITH demo_questionnaire_defaults("id", "scoringRule", "riskBands") AS (
  VALUES
    ('q-htn-monthly', '{"maxScore":20,"fields":["症状","用药依从性","复测情况"]}'::jsonb, '[{"min":0,"max":6,"riskLevel":"LOW"},{"min":7,"max":13,"riskLevel":"MEDIUM"},{"min":14,"max":20,"riskLevel":"HIGH"}]'::jsonb),
    ('q-dm-monthly', '{"maxScore":24,"fields":["低血糖","足部症状","用药依从性"]}'::jsonb, '[{"min":0,"max":8,"riskLevel":"LOW"},{"min":9,"max":16,"riskLevel":"MEDIUM"},{"min":17,"max":24,"riskLevel":"HIGH"}]'::jsonb),
    ('q-copd-cat', '{"maxScore":40,"fields":["咳嗽","咳痰","活动耐量"]}'::jsonb, '[{"min":0,"max":9,"riskLevel":"LOW"},{"min":10,"max":20,"riskLevel":"MEDIUM"},{"min":21,"max":40,"riskLevel":"HIGH"}]'::jsonb),
    ('q-chd-monthly', '{"maxScore":20,"fields":["胸痛","活动耐量","用药依从性"]}'::jsonb, '[{"min":0,"max":6,"riskLevel":"LOW"},{"min":7,"max":13,"riskLevel":"MEDIUM"},{"min":14,"max":20,"riskLevel":"HIGH"}]'::jsonb),
    ('q-lipid-lifestyle', '{"maxScore":16,"fields":["饮食","运动","用药依从性"]}'::jsonb, '[{"min":0,"max":5,"riskLevel":"LOW"},{"min":6,"max":10,"riskLevel":"MEDIUM"},{"min":11,"max":16,"riskLevel":"HIGH"}]'::jsonb),
    ('q-obesity-lifestyle', '{"maxScore":20,"fields":["饮食","运动","睡眠","体重变化"]}'::jsonb, '[{"min":0,"max":6,"riskLevel":"LOW"},{"min":7,"max":13,"riskLevel":"MEDIUM"},{"min":14,"max":20,"riskLevel":"HIGH"}]'::jsonb)
)
UPDATE "QuestionnaireTemplate" AS questionnaire
SET "scoringRule" = defaults."scoringRule",
    "riskBands" = defaults."riskBands"
FROM demo_questionnaire_defaults AS defaults
WHERE questionnaire."id" = defaults."id"
  AND (
    questionnaire."scoringRule" = '{"demo":true}'::jsonb
    OR questionnaire."riskBands" = '[{"riskLevel":"LOW"},{"riskLevel":"MEDIUM"},{"riskLevel":"HIGH"}]'::jsonb
  );

CREATE TABLE "ClinicalRuleApproval" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "reviewerRole" TEXT NOT NULL,
  "decision" TEXT NOT NULL DEFAULT 'APPROVED',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClinicalRuleApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CarePlan" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "activeKey" TEXT,
  "cohort" TEXT NOT NULL DEFAULT 'THREE_HIGHS',
  "stratificationLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
  "goals" JSONB,
  "activeInterventions" JSONB,
  "followUpCadence" JSONB,
  "referralStatus" TEXT NOT NULL DEFAULT 'NONE',
  "nextReviewAt" TIMESTAMP(3),
  "owningTeamId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pausedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CarePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PatientRiskStratification" (
  "id" TEXT NOT NULL,
  "carePlanId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "riskLevel" "RiskLevel" NOT NULL,
  "priorityScore" INTEGER NOT NULL,
  "reasons" JSONB NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientRiskStratification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NextBestAction" (
  "id" TEXT NOT NULL,
  "carePlanId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "actionKey" TEXT NOT NULL,
  "activeKey" TEXT,
  "title" TEXT NOT NULL,
  "reasonSummary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "priorityScore" INTEGER NOT NULL,
  "requiresDoctor" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "dueAt" TIMESTAMP(3),
  "linkedTaskId" TEXT,
  "acceptedBy" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "dismissedBy" TEXT,
  "dismissedAt" TIMESTAMP(3),
  "dismissReason" TEXT,
  "expiresAt" TIMESTAMP(3),
  "policyVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NextBestAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicalRuleApproval_templateId_reviewerId_key" ON "ClinicalRuleApproval"("templateId", "reviewerId");
CREATE INDEX "ClinicalRuleApproval_templateId_decision_createdAt_idx" ON "ClinicalRuleApproval"("templateId", "decision", "createdAt");
-- PostgreSQL partial unique index: activation remains race-safe even when two
-- reviewers try to make competing versions effective at the same time.
CREATE UNIQUE INDEX "DiseaseRuleTemplate_one_effective_per_disease_key" ON "DiseaseRuleTemplate"("diseaseType") WHERE "lifecycleStatus" = 'EFFECTIVE';

CREATE UNIQUE INDEX "CarePlan_activeKey_key" ON "CarePlan"("activeKey");
CREATE INDEX "CarePlan_patientId_status_idx" ON "CarePlan"("patientId", "status");
CREATE INDEX "CarePlan_cohort_stratificationLevel_status_idx" ON "CarePlan"("cohort", "stratificationLevel", "status");
CREATE INDEX "CarePlan_nextReviewAt_status_idx" ON "CarePlan"("nextReviewAt", "status");

CREATE INDEX "PatientRiskStratification_patientId_calculatedAt_idx" ON "PatientRiskStratification"("patientId", "calculatedAt");
CREATE INDEX "PatientRiskStratification_carePlanId_calculatedAt_idx" ON "PatientRiskStratification"("carePlanId", "calculatedAt");
CREATE INDEX "PatientRiskStratification_riskLevel_priorityScore_calculatedAt_idx" ON "PatientRiskStratification"("riskLevel", "priorityScore", "calculatedAt");

CREATE UNIQUE INDEX "NextBestAction_activeKey_key" ON "NextBestAction"("activeKey");
CREATE INDEX "NextBestAction_patientId_status_priorityScore_idx" ON "NextBestAction"("patientId", "status", "priorityScore");
CREATE INDEX "NextBestAction_carePlanId_status_idx" ON "NextBestAction"("carePlanId", "status");
CREATE INDEX "NextBestAction_actionType_status_dueAt_idx" ON "NextBestAction"("actionType", "status", "dueAt");
CREATE INDEX "NextBestAction_linkedTaskId_idx" ON "NextBestAction"("linkedTaskId");

ALTER TABLE "ClinicalRuleApproval"
  ADD CONSTRAINT "ClinicalRuleApproval_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "DiseaseRuleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CarePlan"
  ADD CONSTRAINT "CarePlan_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientRiskStratification"
  ADD CONSTRAINT "PatientRiskStratification_carePlanId_fkey"
  FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientRiskStratification"
  ADD CONSTRAINT "PatientRiskStratification_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NextBestAction"
  ADD CONSTRAINT "NextBestAction_carePlanId_fkey"
  FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NextBestAction"
  ADD CONSTRAINT "NextBestAction_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NextBestAction"
  ADD CONSTRAINT "NextBestAction_linkedTaskId_fkey"
  FOREIGN KEY ("linkedTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Persist operational task SLA inputs so queue deadlines are inspectable rather
-- than embedded as service literals. Existing records receive the former
-- behavior as an explicit stored default.
ALTER TABLE "VitalMonitoringPlan" ADD COLUMN "missedFollowUpDueWithinMinutes" INTEGER NOT NULL DEFAULT 1440;
ALTER TABLE "HospitalVisitReminder" ADD COLUMN "followUpDueWithinHours" INTEGER NOT NULL DEFAULT 48;
ALTER TABLE "HospitalVisitReminder" ADD COLUMN "retryDueWithinHours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "CareReminderSchedule" ADD COLUMN "escalationTaskDueWithinMinutes" INTEGER NOT NULL DEFAULT 1440;

-- H5 submissions must enter an explicit manual-review queue instead of being
-- inferred indirectly from risk alerts. Existing links are not retroactively
-- queued because their review state is unknown.
ALTER TABLE "PatientFormLink" ADD COLUMN "manualReviewStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE "PatientFormLink" ADD COLUMN "manualReviewDueAt" TIMESTAMP(3);
ALTER TABLE "PatientFormLink" ADD COLUMN "manualReviewedAt" TIMESTAMP(3);
ALTER TABLE "PatientFormLink" ADD COLUMN "manualReviewedBy" TEXT;
ALTER TABLE "PatientFormLink" ADD COLUMN "manualReviewNote" TEXT;
CREATE INDEX "PatientFormLink_manualReviewStatus_manualReviewDueAt_idx" ON "PatientFormLink"("manualReviewStatus", "manualReviewDueAt");
