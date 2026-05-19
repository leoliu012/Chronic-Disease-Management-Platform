-- Add medication management and questionnaire result tables for patient mini program V2.

CREATE TABLE "MedicationRecord" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "medicationName" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
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

CREATE TABLE "MedicationCheckIn" (
    "id" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "taken" BOOLEAN NOT NULL DEFAULT true,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationCheckIn_pkey" PRIMARY KEY ("id")
);

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

CREATE INDEX "MedicationRecord_patientId_idx" ON "MedicationRecord"("patientId");
CREATE INDEX "MedicationCheckIn_medicationId_checkedAt_idx" ON "MedicationCheckIn"("medicationId", "checkedAt");
CREATE INDEX "MedicationCheckIn_patientId_checkedAt_idx" ON "MedicationCheckIn"("patientId", "checkedAt");
CREATE INDEX "QuestionnaireResult_patientId_createdAt_idx" ON "QuestionnaireResult"("patientId", "createdAt");

ALTER TABLE "MedicationRecord" ADD CONSTRAINT "MedicationRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicationCheckIn" ADD CONSTRAINT "MedicationCheckIn_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "MedicationRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicationCheckIn" ADD CONSTRAINT "MedicationCheckIn_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuestionnaireResult" ADD CONSTRAINT "QuestionnaireResult_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
