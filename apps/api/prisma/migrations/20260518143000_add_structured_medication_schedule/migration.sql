-- Structured medication schedule for hospital-side medication orders.
-- Keeps the existing frequency text for backward compatibility, but stops using it as the primary input.

ALTER TABLE "MedicationRecord"
ADD COLUMN "frequencyUnit" TEXT NOT NULL DEFAULT 'DAY',
ADD COLUMN "timesPerUnit" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "timingRelation" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN "customDoseTimes" JSONB,
ADD COLUMN "customDoseDays" JSONB,
ADD COLUMN "reminderLeadMinutes" INTEGER NOT NULL DEFAULT 180,
ADD COLUMN "checkInWindowBeforeMinutes" INTEGER NOT NULL DEFAULT 180,
ADD COLUMN "missedWindowAfterMinutes" INTEGER NOT NULL DEFAULT 180;

ALTER TABLE "MedicationCheckIn"
ADD COLUMN "scheduledAt" TIMESTAMP(3);

CREATE INDEX "MedicationCheckIn_medicationId_scheduledAt_idx" ON "MedicationCheckIn"("medicationId", "scheduledAt");
