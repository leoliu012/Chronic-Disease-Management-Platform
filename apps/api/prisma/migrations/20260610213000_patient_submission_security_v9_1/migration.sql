-- patient-submission-security-v9.1
-- Harden public H5 clinical writes and preserve immutable NextBestAction SLA anchors.

ALTER TABLE "VitalRecord"
  ADD COLUMN "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "VitalRecord_patientId_receivedAt_idx"
  ON "VitalRecord"("patientId", "receivedAt");

ALTER TABLE "NextBestAction"
  ADD COLUMN "firstProposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastEvidenceChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "deadlinePolicyVersion" TEXT NOT NULL DEFAULT 'CARDIOMETABOLIC_PILOT_V1';

-- Preserve the original recommendation age for pre-hotfix records rather than
-- pretending that every existing action was first proposed at migration time.
UPDATE "NextBestAction"
SET
  "firstProposedAt" = "createdAt",
  "lastEvidenceChangedAt" = "updatedAt";

-- Existing active clinical write links were created under mixed policies.
-- Upgrade them immediately so previously issued reminder links are not weaker
-- than newly issued links. Pre-hotfix questionnaire links will additionally be
-- rejected at submit time and must be resent with an immutable scoring snapshot.
UPDATE "PatientFormLink"
SET "requiresIdentityCheck" = TRUE
WHERE "status" = 'ACTIVE'
  AND "type" IN (
    'QUESTIONNAIRE',
    'VITAL_RECHECK',
    'MEDICATION_CHECKIN',
    'HOSPITAL_VISIT_CONFIRM'
  );
