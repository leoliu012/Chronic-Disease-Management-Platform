-- care_reminders_v3
--
-- 1. HospitalTenant.timezone (new column, NOT NULL, default 'Asia/Shanghai')
-- 2. CareReminderSchedule       (long-running reminder plans)
-- 3. CareReminderOccurrence     (per-firing instances, unique (scheduleId, dueAt))
-- 4. PatientDirectMessage       (nurse-initiated message envelope; dispatch
--    still goes through PatientOutboundMessage)

-- ----------------------------------------------------------------------------
-- 1) HospitalTenant.timezone
-- ----------------------------------------------------------------------------

ALTER TABLE "HospitalTenant" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai';

-- ----------------------------------------------------------------------------
-- 2) CareReminderSchedule
-- ----------------------------------------------------------------------------

CREATE TABLE "CareReminderSchedule" (
    "id"                          TEXT          NOT NULL,
    "hospitalTenantId"            TEXT          NOT NULL,
    "patientId"                   TEXT          NOT NULL,
    "sourceType"                  TEXT          NOT NULL,
    "sourceId"                    TEXT,
    "title"                       TEXT          NOT NULL,
    "description"                 TEXT,
    "reminderType"                TEXT          NOT NULL,
    "frequencyUnit"               TEXT          NOT NULL DEFAULT 'DAY',
    "timesPerUnit"                INTEGER       NOT NULL DEFAULT 1,
    "scheduledTimes"              JSONB,
    "scheduledDays"               JSONB,
    "payload"                     JSONB,
    "reminderLeadMinutes"         INTEGER       NOT NULL DEFAULT 0,
    "checkInWindowBeforeMinutes"  INTEGER       NOT NULL DEFAULT 180,
    "checkInWindowAfterMinutes"   INTEGER       NOT NULL DEFAULT 180,
    "escalationAfterMinutes"      INTEGER,
    "isActive"                    BOOLEAN       NOT NULL DEFAULT true,
    "pausedAt"                    TIMESTAMP(3),
    "startDate"                   TIMESTAMP(3),
    "endDate"                     TIMESTAMP(3),
    "createdBy"                   TEXT,
    "createdAt"                   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                   TIMESTAMP(3)  NOT NULL,
    CONSTRAINT "CareReminderSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CareReminderSchedule_hospitalTenantId_patientId_isActive_idx"
    ON "CareReminderSchedule"("hospitalTenantId", "patientId", "isActive");
CREATE INDEX "CareReminderSchedule_sourceType_sourceId_idx"
    ON "CareReminderSchedule"("sourceType", "sourceId");

ALTER TABLE "CareReminderSchedule"
    ADD CONSTRAINT "CareReminderSchedule_hospitalTenantId_fkey"
    FOREIGN KEY ("hospitalTenantId") REFERENCES "HospitalTenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CareReminderSchedule"
    ADD CONSTRAINT "CareReminderSchedule_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- 3) CareReminderOccurrence
-- ----------------------------------------------------------------------------

CREATE TABLE "CareReminderOccurrence" (
    "id"                  TEXT          NOT NULL,
    "hospitalTenantId"    TEXT          NOT NULL,
    "patientId"           TEXT          NOT NULL,
    "scheduleId"          TEXT          NOT NULL,
    "occurrenceType"      TEXT          NOT NULL,
    "title"               TEXT          NOT NULL,
    "dueAt"               TIMESTAMP(3)  NOT NULL,
    "availableFrom"       TIMESTAMP(3)  NOT NULL,
    "availableUntil"      TIMESTAMP(3)  NOT NULL,
    "status"              TEXT          NOT NULL DEFAULT 'PENDING',
    "formLinkId"          TEXT,
    "outboundMessageId"   TEXT,
    "sentAt"              TIMESTAMP(3),
    "completedAt"         TIMESTAMP(3),
    "missedAt"            TIMESTAMP(3),
    "escalatedAt"         TIMESTAMP(3),
    "escalatedTaskId"     TEXT,
    "resultType"          TEXT,
    "resultId"            TEXT,
    "lastError"           TEXT,
    "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3)  NOT NULL,
    CONSTRAINT "CareReminderOccurrence_pkey" PRIMARY KEY ("id")
);

-- Idempotency: one occurrence per (schedule, dueAt). Worker re-runs are no-ops.
CREATE UNIQUE INDEX "CareReminderOccurrence_scheduleId_dueAt_key"
    ON "CareReminderOccurrence"("scheduleId", "dueAt");
CREATE INDEX "CareReminderOccurrence_hospitalTenantId_patientId_dueAt_idx"
    ON "CareReminderOccurrence"("hospitalTenantId", "patientId", "dueAt");
CREATE INDEX "CareReminderOccurrence_status_dueAt_idx"
    ON "CareReminderOccurrence"("status", "dueAt");
CREATE INDEX "CareReminderOccurrence_formLinkId_idx"
    ON "CareReminderOccurrence"("formLinkId");

ALTER TABLE "CareReminderOccurrence"
    ADD CONSTRAINT "CareReminderOccurrence_hospitalTenantId_fkey"
    FOREIGN KEY ("hospitalTenantId") REFERENCES "HospitalTenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareReminderOccurrence"
    ADD CONSTRAINT "CareReminderOccurrence_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareReminderOccurrence"
    ADD CONSTRAINT "CareReminderOccurrence_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "CareReminderSchedule"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
-- formLinkId / escalatedTaskId left without FK constraints intentionally so
-- deleting a form link or task doesn't cascade-destroy the occurrence audit row.

-- ----------------------------------------------------------------------------
-- 4) PatientDirectMessage
-- ----------------------------------------------------------------------------

CREATE TABLE "PatientDirectMessage" (
    "id"                  TEXT          NOT NULL,
    "hospitalTenantId"    TEXT          NOT NULL,
    "patientId"           TEXT          NOT NULL,
    "senderId"            TEXT          NOT NULL,
    "title"               TEXT          NOT NULL,
    "content"             TEXT          NOT NULL,
    "priority"            TEXT          NOT NULL DEFAULT 'NORMAL',
    "channel"             TEXT          NOT NULL,
    "formLinkId"          TEXT,
    "outboundMessageId"   TEXT,
    "status"              TEXT          NOT NULL DEFAULT 'PENDING',
    "requiresAck"         BOOLEAN       NOT NULL DEFAULT false,
    "acknowledgedAt"      TIMESTAMP(3),
    "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3)  NOT NULL,
    CONSTRAINT "PatientDirectMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientDirectMessage_hospitalTenantId_patientId_createdAt_idx"
    ON "PatientDirectMessage"("hospitalTenantId", "patientId", "createdAt");
CREATE INDEX "PatientDirectMessage_senderId_createdAt_idx"
    ON "PatientDirectMessage"("senderId", "createdAt");
CREATE INDEX "PatientDirectMessage_formLinkId_idx"
    ON "PatientDirectMessage"("formLinkId");

ALTER TABLE "PatientDirectMessage"
    ADD CONSTRAINT "PatientDirectMessage_hospitalTenantId_fkey"
    FOREIGN KEY ("hospitalTenantId") REFERENCES "HospitalTenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientDirectMessage"
    ADD CONSTRAINT "PatientDirectMessage_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientDirectMessage"
    ADD CONSTRAINT "PatientDirectMessage_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
