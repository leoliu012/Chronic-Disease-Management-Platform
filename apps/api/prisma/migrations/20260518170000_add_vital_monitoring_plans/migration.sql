-- Add structured vital monitoring plans for hospital-configured patient check-ins.

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

ALTER TABLE "VitalRecord" ADD COLUMN "monitoringPlanId" TEXT;
ALTER TABLE "VitalRecord" ADD COLUMN "scheduledAt" TIMESTAMP(3);

CREATE INDEX "VitalMonitoringPlan_patientId_isActive_idx" ON "VitalMonitoringPlan"("patientId", "isActive");
CREATE INDEX "VitalMonitoringPlan_patientId_vitalType_idx" ON "VitalMonitoringPlan"("patientId", "vitalType");
CREATE INDEX "VitalRecord_monitoringPlanId_measuredAt_idx" ON "VitalRecord"("monitoringPlanId", "measuredAt");

ALTER TABLE "VitalMonitoringPlan" ADD CONSTRAINT "VitalMonitoringPlan_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VitalRecord" ADD CONSTRAINT "VitalRecord_monitoringPlanId_fkey" FOREIGN KEY ("monitoringPlanId") REFERENCES "VitalMonitoringPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
