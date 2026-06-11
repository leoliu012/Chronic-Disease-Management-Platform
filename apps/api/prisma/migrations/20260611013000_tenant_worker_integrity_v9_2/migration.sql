-- tenant-worker-integrity-v9.2
-- Close tenant ownership for clinical writes and make worker-generated tasks
-- crash-safe / retry-safe. Existing rows are backfilled before NOT NULL is
-- enforced. If populated legacy data exists without any HospitalTenant row, the
-- migration fails closed instead of guessing a hospital.

ALTER TABLE "Task"
  ADD COLUMN "sourceCareReminderOccurrenceId" TEXT,
  ADD COLUMN "sourceNextBestActionId" TEXT;

ALTER TABLE "CarePlan"
  ADD COLUMN "currentSnapshotHash" TEXT;

ALTER TABLE "PatientRiskStratification"
  ADD COLUMN "snapshotHash" TEXT;

ALTER TABLE "IntegrationSource"
  ADD COLUMN "hospitalTenantId" TEXT;

-- ---------------------------------------------------------------------------
-- Backfill tenant ownership for legacy rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fallback_tenant_id TEXT;
  tenant_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO tenant_count FROM "HospitalTenant";
  IF tenant_count = 1 THEN
    SELECT "id" INTO fallback_tenant_id FROM "HospitalTenant" LIMIT 1;
  ELSE
    fallback_tenant_id := NULL;
  END IF;

  -- Known single-hospital demo / gateway fixtures can be assigned explicitly.
  -- Do not use this for arbitrary real integration sources.
  UPDATE "IntegrationSource"
  SET "hospitalTenantId" = 'demo-tenant-001'
  WHERE "hospitalTenantId" IS NULL
    AND EXISTS (
      SELECT 1 FROM "HospitalTenant" WHERE "id" = 'demo-tenant-001'
    )
    AND (
      "code" IN ('HIS_DEMO', 'EMR_DEMO', 'LIS_DEMO', 'PHARMACY_DEMO')
      OR "code" LIKE 'GATEWAY_%'
    );

  IF EXISTS (SELECT 1 FROM "Patient" WHERE "hospitalTenantId" IS NULL)
     AND fallback_tenant_id IS NULL THEN
    RAISE EXCEPTION
      'tenant-worker-integrity-v9.2 cannot infer Patient hospitalTenantId with multiple/no tenants; backfill Patient ownership before retrying migration';
  END IF;

  UPDATE "Patient"
  SET "hospitalTenantId" = fallback_tenant_id
  WHERE "hospitalTenantId" IS NULL;

  UPDATE "PatientFormLink" link
  SET "hospitalTenantId" = patient."hospitalTenantId"
  FROM "Patient" patient
  WHERE link."patientId" = patient."id"
    AND link."hospitalTenantId" IS NULL;

  UPDATE "PatientOutboundMessage" message
  SET "hospitalTenantId" = link."hospitalTenantId"
  FROM "PatientFormLink" link
  WHERE message."formLinkId" = link."id"
    AND message."hospitalTenantId" IS NULL;

  UPDATE "PatientOutboundMessage" message
  SET "hospitalTenantId" = patient."hospitalTenantId"
  FROM "Patient" patient
  WHERE message."patientId" = patient."id"
    AND message."hospitalTenantId" IS NULL;

  UPDATE "PatientOutboundAttempt" attempt
  SET "hospitalTenantId" = message."hospitalTenantId"
  FROM "PatientOutboundMessage" message
  WHERE attempt."messageId" = message."id"
    AND attempt."hospitalTenantId" IS NULL;

  UPDATE "PatientOutboundAttempt" attempt
  SET "hospitalTenantId" = patient."hospitalTenantId"
  FROM "Patient" patient
  WHERE attempt."patientId" = patient."id"
    AND attempt."hospitalTenantId" IS NULL;

  IF EXISTS (SELECT 1 FROM "PatientFormLink" WHERE "hospitalTenantId" IS NULL)
     AND fallback_tenant_id IS NOT NULL THEN
    UPDATE "PatientFormLink"
    SET "hospitalTenantId" = fallback_tenant_id
    WHERE "hospitalTenantId" IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM "PatientOutboundMessage" WHERE "hospitalTenantId" IS NULL)
     AND fallback_tenant_id IS NOT NULL THEN
    UPDATE "PatientOutboundMessage"
    SET "hospitalTenantId" = fallback_tenant_id
    WHERE "hospitalTenantId" IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM "PatientOutboundAttempt" WHERE "hospitalTenantId" IS NULL)
     AND fallback_tenant_id IS NOT NULL THEN
    UPDATE "PatientOutboundAttempt"
    SET "hospitalTenantId" = fallback_tenant_id
    WHERE "hospitalTenantId" IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM "IntegrationSource" WHERE "hospitalTenantId" IS NULL) THEN
    IF fallback_tenant_id IS NULL THEN
      RAISE EXCEPTION
        'tenant-worker-integrity-v9.2 cannot infer IntegrationSource hospitalTenantId with multiple/no tenants; backfill source ownership before retrying migration';
    END IF;
    UPDATE "IntegrationSource"
    SET "hospitalTenantId" = fallback_tenant_id
    WHERE "hospitalTenantId" IS NULL;
  END IF;
END $$;

-- Fail with readable diagnostics before adding NOT NULL.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Patient" WHERE "hospitalTenantId" IS NULL) THEN
    RAISE EXCEPTION 'Patient rows remain tenantless after v9.2 backfill';
  END IF;
  IF EXISTS (SELECT 1 FROM "PatientFormLink" WHERE "hospitalTenantId" IS NULL) THEN
    RAISE EXCEPTION 'PatientFormLink rows remain tenantless after v9.2 backfill';
  END IF;
  IF EXISTS (SELECT 1 FROM "PatientOutboundMessage" WHERE "hospitalTenantId" IS NULL) THEN
    RAISE EXCEPTION 'PatientOutboundMessage rows remain tenantless after v9.2 backfill';
  END IF;
  IF EXISTS (SELECT 1 FROM "PatientOutboundAttempt" WHERE "hospitalTenantId" IS NULL) THEN
    RAISE EXCEPTION 'PatientOutboundAttempt rows remain tenantless after v9.2 backfill';
  END IF;
  IF EXISTS (SELECT 1 FROM "IntegrationSource" WHERE "hospitalTenantId" IS NULL) THEN
    RAISE EXCEPTION 'IntegrationSource rows remain tenantless after v9.2 backfill';
  END IF;
END $$;

ALTER TABLE "Patient"
  ALTER COLUMN "hospitalTenantId" SET NOT NULL;

ALTER TABLE "PatientFormLink"
  ALTER COLUMN "hospitalTenantId" SET NOT NULL;

ALTER TABLE "PatientOutboundMessage"
  ALTER COLUMN "hospitalTenantId" SET NOT NULL;

ALTER TABLE "PatientOutboundAttempt"
  ALTER COLUMN "hospitalTenantId" SET NOT NULL;

ALTER TABLE "IntegrationSource"
  ALTER COLUMN "hospitalTenantId" SET NOT NULL;

-- hospitalPatientId is an in-hospital identifier, not a platform-global one.
ALTER TABLE "Patient"
  DROP CONSTRAINT IF EXISTS "Patient_hospitalPatientId_key";

CREATE UNIQUE INDEX "Patient_hospitalTenantId_hospitalPatientId_key"
  ON "Patient"("hospitalTenantId", "hospitalPatientId");

-- Integration source codes are hospital-local identifiers as well.
ALTER TABLE "IntegrationSource"
  DROP CONSTRAINT IF EXISTS "IntegrationSource_code_key";

CREATE UNIQUE INDEX "IntegrationSource_hospitalTenantId_code_key"
  ON "IntegrationSource"("hospitalTenantId", "code");

CREATE INDEX "IntegrationSource_hospitalTenantId_systemType_isEnabled_idx"
  ON "IntegrationSource"("hospitalTenantId", "systemType", "isEnabled");

ALTER TABLE "IntegrationSource"
  ADD CONSTRAINT "IntegrationSource_hospitalTenantId_fkey"
  FOREIGN KEY ("hospitalTenantId") REFERENCES "HospitalTenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatientOutboundAttempt"
  ADD CONSTRAINT "PatientOutboundAttempt_hospitalTenantId_fkey"
  FOREIGN KEY ("hospitalTenantId") REFERENCES "HospitalTenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill source idempotency keys for already-generated tasks.
-- ---------------------------------------------------------------------------
UPDATE "Task" task
SET "sourceCareReminderOccurrenceId" = occurrence."id"
FROM "CareReminderOccurrence" occurrence
WHERE occurrence."escalatedTaskId" = task."id"
  AND task."sourceCareReminderOccurrenceId" IS NULL;

UPDATE "Task" task
SET "sourceNextBestActionId" = action."id"
FROM "NextBestAction" action
WHERE action."linkedTaskId" = task."id"
  AND task."sourceNextBestActionId" IS NULL;

CREATE UNIQUE INDEX "Task_sourceCareReminderOccurrenceId_key"
  ON "Task"("sourceCareReminderOccurrenceId");

CREATE UNIQUE INDEX "Task_sourceNextBestActionId_key"
  ON "Task"("sourceNextBestActionId");

-- Historical rows predate deterministic hashing. Preserve them as distinct
-- snapshots; the service writes stable SHA-256 hashes for all new rows.
UPDATE "PatientRiskStratification"
SET "snapshotHash" = md5("carePlanId" || ':' || "id")
WHERE "snapshotHash" IS NULL;

ALTER TABLE "PatientRiskStratification"
  ALTER COLUMN "snapshotHash" SET NOT NULL;

CREATE UNIQUE INDEX "PatientRiskStratification_carePlanId_snapshotHash_key"
  ON "PatientRiskStratification"("carePlanId", "snapshotHash");

-- ---------------------------------------------------------------------------
-- Durable metrics and heartbeat for the care-plan refresh worker.
-- ---------------------------------------------------------------------------
CREATE TABLE "CarePlanRefreshWorkerHeartbeat" (
  "instanceId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt" TIMESTAMP(3) NOT NULL,
  "stoppedAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "lastSucceededAt" TIMESTAMP(3),
  "lastFailedAt" TIMESTAMP(3),
  "lastRunId" TEXT,
  "lastSummary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CarePlanRefreshWorkerHeartbeat_pkey" PRIMARY KEY ("instanceId")
);

CREATE TABLE "CarePlanRefreshWorkerRun" (
  "id" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "enrolled" INTEGER NOT NULL DEFAULT 0,
  "refreshed" INTEGER NOT NULL DEFAULT 0,
  "unchanged" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "failedPatientIds" JSONB,
  "errorSummaries" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarePlanRefreshWorkerRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CarePlanRefreshWorkerHeartbeat_heartbeatAt_idx"
  ON "CarePlanRefreshWorkerHeartbeat"("heartbeatAt");

CREATE INDEX "CarePlanRefreshWorkerRun_status_startedAt_idx"
  ON "CarePlanRefreshWorkerRun"("status", "startedAt");

CREATE INDEX "CarePlanRefreshWorkerRun_finishedAt_idx"
  ON "CarePlanRefreshWorkerRun"("finishedAt");

CREATE INDEX "CarePlanRefreshWorkerRun_instanceId_startedAt_idx"
  ON "CarePlanRefreshWorkerRun"("instanceId", "startedAt");
