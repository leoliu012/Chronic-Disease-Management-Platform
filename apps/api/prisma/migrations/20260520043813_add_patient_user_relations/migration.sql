-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DiseaseType" AS ENUM ('HYPERTENSION', 'TYPE_2_DIABETES', 'COPD', 'CORONARY_HEART_DISEASE', 'HYPERLIPIDEMIA', 'OBESITY', 'OTHER');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('HIS', 'EMR', 'LIS', 'MINI_PROGRAM', 'NURSE_INPUT', 'MANUAL_IMPORT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DOCTOR', 'NURSE', 'MANAGER');

-- CreateEnum
CREATE TYPE "PatientBindingStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HospitalVisitReminderStatus" AS ENUM ('ACTIVE', 'ARRIVED', 'NO_SHOW', 'REFUSED', 'REVOKED');

-- CreateEnum
CREATE TYPE "EncounterType" AS ENUM ('OUTPATIENT', 'INPATIENT', 'EMERGENCY', 'CHECKUP');

-- CreateEnum
CREATE TYPE "MedicalRecordType" AS ENUM ('OUTPATIENT_NOTE', 'INPATIENT_RECORD', 'DISCHARGE_SUMMARY', 'PROGRESS_NOTE', 'CONSULTATION_NOTE');

-- CreateEnum
CREATE TYPE "IntegrationSystemType" AS ENUM ('HIS', 'EMR', 'LIS', 'PHARMACY', 'CHECKUP', 'MESSAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "IntegrationSyncStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationRecordStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ExternalRecordStatus" AS ENUM ('STAGED', 'IMPORTED', 'FAILED');

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "hospitalPatientId" TEXT,
    "name" TEXT NOT NULL,
    "gender" "Gender" NOT NULL DEFAULT 'UNKNOWN',
    "birthDate" TIMESTAMP(3),
    "phone" TEXT,
    "idCardNo" TEXT,
    "address" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "responsibleDoctorId" TEXT,
    "responsibleNurseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiseaseProfile" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "diseaseType" "DiseaseType" NOT NULL,
    "diagnosisDate" TIMESTAMP(3),
    "diseaseStage" TEXT,
    "complications" TEXT,
    "comorbidities" TEXT,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "dataSource" "DataSource" NOT NULL DEFAULT 'NURSE_INPUT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiseaseProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalRecord" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "dataSource" "DataSource" NOT NULL DEFAULT 'MINI_PROGRAM',
    "isAbnormal" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "monitoringPlanId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VitalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpRecord" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "followUpType" TEXT NOT NULL,
    "followUpTime" TIMESTAMP(3) NOT NULL,
    "content" TEXT,
    "result" TEXT,
    "suggestion" TEXT,
    "nextFollowUpTime" TIMESTAMP(3),
    "operatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "relatedAlertId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "ipAddress" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAlert" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "riskType" TEXT NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "triggerRule" TEXT,
    "sourceVitalRecordId" TEXT,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "handlingNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalMonitoringPlan" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "vitalType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "frequencyUnit" TEXT NOT NULL DEFAULT 'DAY',
    "timesPerUnit" INTEGER NOT NULL DEFAULT 1,
    "customMeasureTimes" JSONB,
    "customMeasureDays" JSONB,
    "reminderLeadMinutes" INTEGER NOT NULL DEFAULT 180,
    "checkInWindowBeforeMinutes" INTEGER NOT NULL DEFAULT 180,
    "missedWindowAfterMinutes" INTEGER NOT NULL DEFAULT 180,
    "sourcePreset" TEXT,
    "evidenceBasis" TEXT,
    "evidenceSource" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VitalMonitoringPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationRecord" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "medicationName" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "frequencyUnit" TEXT NOT NULL DEFAULT 'DAY',
    "timesPerUnit" INTEGER NOT NULL DEFAULT 1,
    "timingRelation" TEXT NOT NULL DEFAULT 'NONE',
    "customDoseTimes" JSONB,
    "customDoseDays" JSONB,
    "reminderLeadMinutes" INTEGER NOT NULL DEFAULT 180,
    "checkInWindowBeforeMinutes" INTEGER NOT NULL DEFAULT 180,
    "missedWindowAfterMinutes" INTEGER NOT NULL DEFAULT 180,
    "instructions" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "dataSource" "DataSource" NOT NULL DEFAULT 'NURSE_INPUT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationCheckIn" (
    "id" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "taken" BOOLEAN NOT NULL DEFAULT true,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireResult" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "questionnaireType" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "riskConclusion" TEXT NOT NULL,
    "answers" JSONB,
    "note" TEXT,
    "dataSource" "DataSource" NOT NULL DEFAULT 'MINI_PROGRAM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientBindingRequest" (
    "id" TEXT NOT NULL,
    "demoOpenId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "hospitalPatientId" TEXT,
    "phone" TEXT NOT NULL,
    "idCardLast4" TEXT,
    "status" "PatientBindingStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientBindingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientSession" (
    "id" TEXT NOT NULL,
    "demoOpenId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HospitalVisitReminder" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "sourceRiskAlertId" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" "HospitalVisitReminderStatus" NOT NULL DEFAULT 'ACTIVE',
    "remindedBy" TEXT,
    "remindedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedBy" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "arrivedAt" TIMESTAMP(3),
    "arrivalConfirmedBy" TEXT,
    "noShowAt" TIMESTAMP(3),
    "noShowConfirmedBy" TEXT,
    "refusedAt" TIMESTAMP(3),
    "refusalConfirmedBy" TEXT,
    "outcomeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HospitalVisitReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiseaseRuleTemplate" (
    "id" TEXT NOT NULL,
    "diseaseType" "DiseaseType" NOT NULL,
    "templateName" TEXT NOT NULL,
    "description" TEXT,
    "managementGoal" TEXT,
    "riskBasis" TEXT,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiseaseRuleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalThresholdRule" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "vitalType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "thresholdValue" DOUBLE PRECISION NOT NULL,
    "thresholdValueMax" DOUBLE PRECISION,
    "riskLevel" "RiskLevel" NOT NULL,
    "alertTitle" TEXT NOT NULL,
    "alertDescription" TEXT,
    "followUpAction" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VitalThresholdRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpPolicy" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "followUpType" TEXT NOT NULL,
    "dueWithinHours" INTEGER NOT NULL,
    "frequencyDescription" TEXT NOT NULL,
    "taskTitle" TEXT NOT NULL,
    "instruction" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireTemplate" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "questionnaireType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scoringRule" JSONB,
    "riskBands" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSource" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "systemType" "IntegrationSystemType" NOT NULL,
    "baseUrl" TEXT,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSyncBatch" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "batchType" TEXT NOT NULL,
    "status" "IntegrationSyncStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "operatorId" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSyncBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSyncRecord" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "externalRecordType" TEXT NOT NULL,
    "externalRecordId" TEXT NOT NULL,
    "localTargetType" TEXT,
    "localTargetId" TEXT,
    "status" "IntegrationRecordStatus" NOT NULL,
    "errorMessage" TEXT,
    "rawData" JSONB,
    "normalizedData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationSyncRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationFieldMapping" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetModel" TEXT NOT NULL,
    "externalField" TEXT NOT NULL,
    "localField" TEXT NOT NULL,
    "displayName" TEXT,
    "transformRule" TEXT,
    "defaultValue" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationFieldMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalPatientRecord" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalPatientId" TEXT NOT NULL,
    "hospitalPatientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" "Gender" NOT NULL DEFAULT 'UNKNOWN',
    "birthDate" TIMESTAMP(3),
    "phone" TEXT,
    "idCardNo" TEXT,
    "address" TEXT,
    "rawData" JSONB,
    "importStatus" "ExternalRecordStatus" NOT NULL DEFAULT 'STAGED',
    "localPatientId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalPatientRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalDiagnosisRecord" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalDiagnosisId" TEXT NOT NULL,
    "hospitalPatientId" TEXT NOT NULL,
    "diseaseType" "DiseaseType" NOT NULL,
    "diagnosisDate" TIMESTAMP(3),
    "diseaseStage" TEXT,
    "complications" TEXT,
    "comorbidities" TEXT,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "rawData" JSONB,
    "importStatus" "ExternalRecordStatus" NOT NULL DEFAULT 'STAGED',
    "localDiseaseProfileId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalDiagnosisRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalLabResultRecord" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalLabResultId" TEXT NOT NULL,
    "hospitalPatientId" TEXT NOT NULL,
    "labItemCode" TEXT NOT NULL,
    "labItemName" TEXT NOT NULL,
    "vitalType" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "rawData" JSONB,
    "importStatus" "ExternalRecordStatus" NOT NULL DEFAULT 'STAGED',
    "localVitalRecordId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalLabResultRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalPrescriptionRecord" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalPrescriptionId" TEXT NOT NULL,
    "hospitalPatientId" TEXT NOT NULL,
    "medicationName" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "instructions" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "rawData" JSONB,
    "importStatus" "ExternalRecordStatus" NOT NULL DEFAULT 'STAGED',
    "localMedicationRecordId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalPrescriptionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncounterRecord" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "hospitalPatientId" TEXT,
    "externalVisitId" TEXT,
    "visitType" "EncounterType" NOT NULL,
    "departmentName" TEXT,
    "doctorName" TEXT,
    "visitTime" TIMESTAMP(3) NOT NULL,
    "chiefComplaint" TEXT,
    "diagnosisSummary" TEXT,
    "treatmentSummary" TEXT,
    "dataSource" "DataSource" NOT NULL DEFAULT 'HIS',
    "sourceSystem" TEXT,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EncounterRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalRecordSummary" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "externalRecordId" TEXT,
    "recordType" "MedicalRecordType" NOT NULL,
    "recordTime" TIMESTAMP(3) NOT NULL,
    "departmentName" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "diagnosisText" TEXT,
    "treatmentPlan" TEXT,
    "doctorAdvice" TEXT,
    "dataSource" "DataSource" NOT NULL DEFAULT 'EMR',
    "sourceSystem" TEXT,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalRecordSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamReportRecord" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "externalExamId" TEXT,
    "examType" TEXT NOT NULL,
    "examName" TEXT NOT NULL,
    "examTime" TIMESTAMP(3) NOT NULL,
    "departmentName" TEXT,
    "finding" TEXT,
    "conclusion" TEXT,
    "reportUrl" TEXT,
    "dataSource" "DataSource" NOT NULL DEFAULT 'HIS',
    "sourceSystem" TEXT,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamReportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HospitalMedicationOrder" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "externalOrderId" TEXT,
    "encounterRecordId" TEXT,
    "medicationName" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "route" TEXT,
    "duration" TEXT,
    "prescribedBy" TEXT,
    "prescribedAt" TIMESTAMP(3) NOT NULL,
    "dataSource" "DataSource" NOT NULL DEFAULT 'HIS',
    "sourceSystem" TEXT,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HospitalMedicationOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Patient_hospitalPatientId_key" ON "Patient"("hospitalPatientId");

-- CreateIndex
CREATE INDEX "Patient_responsibleDoctorId_idx" ON "Patient"("responsibleDoctorId");

-- CreateIndex
CREATE INDEX "Patient_responsibleNurseId_idx" ON "Patient"("responsibleNurseId");

-- CreateIndex
CREATE INDEX "Patient_createdAt_idx" ON "Patient"("createdAt");

-- CreateIndex
CREATE INDEX "DiseaseProfile_patientId_idx" ON "DiseaseProfile"("patientId");

-- CreateIndex
CREATE INDEX "DiseaseProfile_diseaseType_idx" ON "DiseaseProfile"("diseaseType");

-- CreateIndex
CREATE INDEX "DiseaseProfile_riskLevel_idx" ON "DiseaseProfile"("riskLevel");

-- CreateIndex
CREATE INDEX "DiseaseProfile_patientId_riskLevel_idx" ON "DiseaseProfile"("patientId", "riskLevel");

-- CreateIndex
CREATE INDEX "VitalRecord_patientId_measuredAt_idx" ON "VitalRecord"("patientId", "measuredAt");

-- CreateIndex
CREATE INDEX "VitalRecord_patientId_type_measuredAt_idx" ON "VitalRecord"("patientId", "type", "measuredAt");

-- CreateIndex
CREATE INDEX "VitalRecord_monitoringPlanId_measuredAt_idx" ON "VitalRecord"("monitoringPlanId", "measuredAt");

-- CreateIndex
CREATE INDEX "VitalRecord_isAbnormal_measuredAt_idx" ON "VitalRecord"("isAbnormal", "measuredAt");

-- CreateIndex
CREATE INDEX "FollowUpRecord_patientId_followUpTime_idx" ON "FollowUpRecord"("patientId", "followUpTime");

-- CreateIndex
CREATE INDEX "FollowUpRecord_operatorId_followUpTime_idx" ON "FollowUpRecord"("operatorId", "followUpTime");

-- CreateIndex
CREATE INDEX "Task_patientId_status_dueAt_idx" ON "Task"("patientId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_dueAt_idx" ON "Task"("assigneeId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_relatedAlertId_idx" ON "Task"("relatedAlertId");

-- CreateIndex
CREATE INDEX "AuditLog_operatorId_createdAt_idx" ON "AuditLog"("operatorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "RiskAlert_patientId_status_createdAt_idx" ON "RiskAlert"("patientId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RiskAlert_status_riskLevel_createdAt_idx" ON "RiskAlert"("status", "riskLevel", "createdAt");

-- CreateIndex
CREATE INDEX "RiskAlert_sourceVitalRecordId_idx" ON "RiskAlert"("sourceVitalRecordId");

-- CreateIndex
CREATE INDEX "VitalMonitoringPlan_patientId_isActive_idx" ON "VitalMonitoringPlan"("patientId", "isActive");

-- CreateIndex
CREATE INDEX "VitalMonitoringPlan_patientId_vitalType_idx" ON "VitalMonitoringPlan"("patientId", "vitalType");

-- CreateIndex
CREATE INDEX "MedicationRecord_patientId_isActive_idx" ON "MedicationRecord"("patientId", "isActive");

-- CreateIndex
CREATE INDEX "MedicationRecord_patientId_medicationName_idx" ON "MedicationRecord"("patientId", "medicationName");

-- CreateIndex
CREATE INDEX "MedicationCheckIn_medicationId_scheduledAt_idx" ON "MedicationCheckIn"("medicationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "MedicationCheckIn_patientId_checkedAt_idx" ON "MedicationCheckIn"("patientId", "checkedAt");

-- CreateIndex
CREATE INDEX "QuestionnaireResult_patientId_createdAt_idx" ON "QuestionnaireResult"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "QuestionnaireResult_patientId_riskLevel_createdAt_idx" ON "QuestionnaireResult"("patientId", "riskLevel", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE INDEX "PatientBindingRequest_demoOpenId_status_createdAt_idx" ON "PatientBindingRequest"("demoOpenId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PatientBindingRequest_patientId_status_idx" ON "PatientBindingRequest"("patientId", "status");

-- CreateIndex
CREATE INDEX "PatientBindingRequest_status_createdAt_idx" ON "PatientBindingRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PatientSession_tokenHash_key" ON "PatientSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PatientSession_demoOpenId_patientId_idx" ON "PatientSession"("demoOpenId", "patientId");

-- CreateIndex
CREATE INDEX "PatientSession_patientId_expiresAt_idx" ON "PatientSession"("patientId", "expiresAt");

-- CreateIndex
CREATE INDEX "PatientSession_expiresAt_idx" ON "PatientSession"("expiresAt");

-- CreateIndex
CREATE INDEX "HospitalVisitReminder_patientId_status_remindedAt_idx" ON "HospitalVisitReminder"("patientId", "status", "remindedAt");

-- CreateIndex
CREATE INDEX "HospitalVisitReminder_status_remindedAt_idx" ON "HospitalVisitReminder"("status", "remindedAt");

-- CreateIndex
CREATE INDEX "HospitalVisitReminder_sourceRiskAlertId_idx" ON "HospitalVisitReminder"("sourceRiskAlertId");

-- CreateIndex
CREATE INDEX "DiseaseRuleTemplate_diseaseType_isActive_idx" ON "DiseaseRuleTemplate"("diseaseType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DiseaseRuleTemplate_diseaseType_version_key" ON "DiseaseRuleTemplate"("diseaseType", "version");

-- CreateIndex
CREATE INDEX "VitalThresholdRule_templateId_isActive_idx" ON "VitalThresholdRule"("templateId", "isActive");

-- CreateIndex
CREATE INDEX "VitalThresholdRule_vitalType_isActive_idx" ON "VitalThresholdRule"("vitalType", "isActive");

-- CreateIndex
CREATE INDEX "VitalThresholdRule_riskLevel_isActive_idx" ON "VitalThresholdRule"("riskLevel", "isActive");

-- CreateIndex
CREATE INDEX "FollowUpPolicy_templateId_riskLevel_isActive_idx" ON "FollowUpPolicy"("templateId", "riskLevel", "isActive");

-- CreateIndex
CREATE INDEX "FollowUpPolicy_riskLevel_isActive_idx" ON "FollowUpPolicy"("riskLevel", "isActive");

-- CreateIndex
CREATE INDEX "QuestionnaireTemplate_templateId_isActive_idx" ON "QuestionnaireTemplate"("templateId", "isActive");

-- CreateIndex
CREATE INDEX "QuestionnaireTemplate_questionnaireType_isActive_idx" ON "QuestionnaireTemplate"("questionnaireType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSource_code_key" ON "IntegrationSource"("code");

-- CreateIndex
CREATE INDEX "IntegrationSource_systemType_isEnabled_idx" ON "IntegrationSource"("systemType", "isEnabled");

-- CreateIndex
CREATE INDEX "IntegrationSyncBatch_sourceId_status_startedAt_idx" ON "IntegrationSyncBatch"("sourceId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "IntegrationSyncBatch_batchType_status_startedAt_idx" ON "IntegrationSyncBatch"("batchType", "status", "startedAt");

-- CreateIndex
CREATE INDEX "IntegrationSyncRecord_sourceId_externalRecordType_externalR_idx" ON "IntegrationSyncRecord"("sourceId", "externalRecordType", "externalRecordId");

-- CreateIndex
CREATE INDEX "IntegrationSyncRecord_batchId_status_idx" ON "IntegrationSyncRecord"("batchId", "status");

-- CreateIndex
CREATE INDEX "IntegrationSyncRecord_localTargetType_localTargetId_idx" ON "IntegrationSyncRecord"("localTargetType", "localTargetId");

-- CreateIndex
CREATE INDEX "IntegrationFieldMapping_sourceId_targetModel_isActive_idx" ON "IntegrationFieldMapping"("sourceId", "targetModel", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationFieldMapping_sourceId_targetModel_externalField_key" ON "IntegrationFieldMapping"("sourceId", "targetModel", "externalField");

-- CreateIndex
CREATE INDEX "ExternalPatientRecord_hospitalPatientId_idx" ON "ExternalPatientRecord"("hospitalPatientId");

-- CreateIndex
CREATE INDEX "ExternalPatientRecord_sourceId_importStatus_createdAt_idx" ON "ExternalPatientRecord"("sourceId", "importStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalPatientRecord_localPatientId_idx" ON "ExternalPatientRecord"("localPatientId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalPatientRecord_sourceId_externalPatientId_key" ON "ExternalPatientRecord"("sourceId", "externalPatientId");

-- CreateIndex
CREATE INDEX "ExternalDiagnosisRecord_hospitalPatientId_idx" ON "ExternalDiagnosisRecord"("hospitalPatientId");

-- CreateIndex
CREATE INDEX "ExternalDiagnosisRecord_sourceId_importStatus_createdAt_idx" ON "ExternalDiagnosisRecord"("sourceId", "importStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalDiagnosisRecord_localDiseaseProfileId_idx" ON "ExternalDiagnosisRecord"("localDiseaseProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalDiagnosisRecord_sourceId_externalDiagnosisId_key" ON "ExternalDiagnosisRecord"("sourceId", "externalDiagnosisId");

-- CreateIndex
CREATE INDEX "ExternalLabResultRecord_hospitalPatientId_measuredAt_idx" ON "ExternalLabResultRecord"("hospitalPatientId", "measuredAt");

-- CreateIndex
CREATE INDEX "ExternalLabResultRecord_sourceId_importStatus_createdAt_idx" ON "ExternalLabResultRecord"("sourceId", "importStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalLabResultRecord_localVitalRecordId_idx" ON "ExternalLabResultRecord"("localVitalRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalLabResultRecord_sourceId_externalLabResultId_key" ON "ExternalLabResultRecord"("sourceId", "externalLabResultId");

-- CreateIndex
CREATE INDEX "ExternalPrescriptionRecord_hospitalPatientId_idx" ON "ExternalPrescriptionRecord"("hospitalPatientId");

-- CreateIndex
CREATE INDEX "ExternalPrescriptionRecord_sourceId_importStatus_createdAt_idx" ON "ExternalPrescriptionRecord"("sourceId", "importStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalPrescriptionRecord_localMedicationRecordId_idx" ON "ExternalPrescriptionRecord"("localMedicationRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalPrescriptionRecord_sourceId_externalPrescriptionId_key" ON "ExternalPrescriptionRecord"("sourceId", "externalPrescriptionId");

-- CreateIndex
CREATE INDEX "EncounterRecord_patientId_visitTime_idx" ON "EncounterRecord"("patientId", "visitTime");

-- CreateIndex
CREATE INDEX "EncounterRecord_visitType_visitTime_idx" ON "EncounterRecord"("visitType", "visitTime");

-- CreateIndex
CREATE INDEX "EncounterRecord_externalVisitId_idx" ON "EncounterRecord"("externalVisitId");

-- CreateIndex
CREATE INDEX "MedicalRecordSummary_patientId_recordTime_idx" ON "MedicalRecordSummary"("patientId", "recordTime");

-- CreateIndex
CREATE INDEX "MedicalRecordSummary_recordType_recordTime_idx" ON "MedicalRecordSummary"("recordType", "recordTime");

-- CreateIndex
CREATE INDEX "MedicalRecordSummary_externalRecordId_idx" ON "MedicalRecordSummary"("externalRecordId");

-- CreateIndex
CREATE INDEX "ExamReportRecord_patientId_examTime_idx" ON "ExamReportRecord"("patientId", "examTime");

-- CreateIndex
CREATE INDEX "ExamReportRecord_examType_examTime_idx" ON "ExamReportRecord"("examType", "examTime");

-- CreateIndex
CREATE INDEX "ExamReportRecord_externalExamId_idx" ON "ExamReportRecord"("externalExamId");

-- CreateIndex
CREATE INDEX "HospitalMedicationOrder_patientId_prescribedAt_idx" ON "HospitalMedicationOrder"("patientId", "prescribedAt");

-- CreateIndex
CREATE INDEX "HospitalMedicationOrder_encounterRecordId_idx" ON "HospitalMedicationOrder"("encounterRecordId");

-- CreateIndex
CREATE INDEX "HospitalMedicationOrder_externalOrderId_idx" ON "HospitalMedicationOrder"("externalOrderId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_responsibleDoctorId_fkey" FOREIGN KEY ("responsibleDoctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_responsibleNurseId_fkey" FOREIGN KEY ("responsibleNurseId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiseaseProfile" ADD CONSTRAINT "DiseaseProfile_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalRecord" ADD CONSTRAINT "VitalRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalRecord" ADD CONSTRAINT "VitalRecord_monitoringPlanId_fkey" FOREIGN KEY ("monitoringPlanId") REFERENCES "VitalMonitoringPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpRecord" ADD CONSTRAINT "FollowUpRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAlert" ADD CONSTRAINT "RiskAlert_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalMonitoringPlan" ADD CONSTRAINT "VitalMonitoringPlan_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationRecord" ADD CONSTRAINT "MedicationRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationCheckIn" ADD CONSTRAINT "MedicationCheckIn_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "MedicationRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationCheckIn" ADD CONSTRAINT "MedicationCheckIn_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireResult" ADD CONSTRAINT "QuestionnaireResult_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalVisitReminder" ADD CONSTRAINT "HospitalVisitReminder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalThresholdRule" ADD CONSTRAINT "VitalThresholdRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DiseaseRuleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpPolicy" ADD CONSTRAINT "FollowUpPolicy_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DiseaseRuleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireTemplate" ADD CONSTRAINT "QuestionnaireTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DiseaseRuleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSyncBatch" ADD CONSTRAINT "IntegrationSyncBatch_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "IntegrationSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSyncRecord" ADD CONSTRAINT "IntegrationSyncRecord_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "IntegrationSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSyncRecord" ADD CONSTRAINT "IntegrationSyncRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "IntegrationSyncBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationFieldMapping" ADD CONSTRAINT "IntegrationFieldMapping_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "IntegrationSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterRecord" ADD CONSTRAINT "EncounterRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecordSummary" ADD CONSTRAINT "MedicalRecordSummary_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamReportRecord" ADD CONSTRAINT "ExamReportRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalMedicationOrder" ADD CONSTRAINT "HospitalMedicationOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalMedicationOrder" ADD CONSTRAINT "HospitalMedicationOrder_encounterRecordId_fkey" FOREIGN KEY ("encounterRecordId") REFERENCES "EncounterRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
