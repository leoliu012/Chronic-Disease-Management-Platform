-- pilot-security-integrity-v9.3
-- P1 hardening: login throttling, gateway canonical idempotency,
-- manual outbound action state, and reminder-link deadline alignment.

CREATE TABLE IF NOT EXISTS "AuthLoginThrottle" (
  "keyType" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMP(3),
  "lastFailedAt" TIMESTAMP(3),
  "lastSucceededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthLoginThrottle_pkey" PRIMARY KEY ("keyType", "keyHash")
);

CREATE INDEX IF NOT EXISTS "AuthLoginThrottle_lockedUntil_idx"
  ON "AuthLoginThrottle"("lockedUntil");
CREATE INDEX IF NOT EXISTS "AuthLoginThrottle_lastFailedAt_idx"
  ON "AuthLoginThrottle"("lastFailedAt");

ALTER TABLE "IntegrationSyncRecord"
  ADD COLUMN IF NOT EXISTS "externalVersion" TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

-- Preserve historical rows. For each existing successful canonical event, only
-- the oldest successful row receives the canonical key. Legacy duplicates stay
-- readable but cannot create future competing canonical rows.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "sourceId", "externalRecordType", "externalRecordId", "externalVersion"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "IntegrationSyncRecord"
  WHERE "status" = 'SUCCESS'
)
UPDATE "IntegrationSyncRecord" r
SET "idempotencyKey" = concat_ws(
  chr(31),
  r."sourceId",
  r."externalRecordType",
  r."externalRecordId",
  r."externalVersion"
)
FROM ranked
WHERE ranked."id" = r."id"
  AND ranked.rn = 1
  AND r."idempotencyKey" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationSyncRecord_idempotencyKey_key"
  ON "IntegrationSyncRecord"("idempotencyKey");

DROP INDEX IF EXISTS "IntegrationSyncRecord_sourceId_externalRecordType_externalRecordId_idx";
CREATE INDEX IF NOT EXISTS "IntegrationSyncRecord_sourceId_externalRecordType_externalRecordId_externalVersion_idx"
  ON "IntegrationSyncRecord"("sourceId", "externalRecordType", "externalRecordId", "externalVersion");

ALTER TABLE "CareReminderWorkerRun"
  ADD COLUMN IF NOT EXISTS "manualActionRequired" INTEGER NOT NULL DEFAULT 0;

-- MANUAL_COPY is an operator handoff, not an electronic delivery acceptance.
UPDATE "PatientOutboundMessage"
SET "status" = 'MANUAL_ACTION_REQUIRED'
WHERE "channel" = 'MANUAL_COPY'
  AND "status" IN ('PENDING', 'SENT');

UPDATE "CareReminderOccurrence" occurrence
SET "status" = 'MANUAL_ACTION_REQUIRED'
FROM "PatientOutboundMessage" message
WHERE occurrence."outboundMessageId" = message."id"
  AND message."channel" = 'MANUAL_COPY'
  AND message."status" = 'MANUAL_ACTION_REQUIRED'
  AND occurrence."status" IN ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- Active links attached to an occurrence must never outlive that business window.
UPDATE "PatientFormLink" link
SET "expiresAt" = occurrence."availableUntil"
FROM "CareReminderOccurrence" occurrence
WHERE occurrence."formLinkId" = link."id"
  AND link."status" = 'ACTIVE'
  AND link."expiresAt" > occurrence."availableUntil";
