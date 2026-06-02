-- patient_engagement_v3_2_history_detail_filters
--
-- 1. PatientOutboundMessage: lastAttemptAt + deliverySummary (additive, nullable)
-- 2. PatientFormLink: submissionType / submissionId / submittedAt (additive, nullable)
-- 3. PatientOutboundAttempt: one row per real delivery attempt (WeChat/SMS)
-- 4. HospitalVisitFeedback: structured patient 到院反馈

-- ----------------------------------------------------------------------------
-- 1) PatientOutboundMessage aggregate columns
-- ----------------------------------------------------------------------------
ALTER TABLE "PatientOutboundMessage"
    ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
    ADD COLUMN "deliverySummary" JSONB;

-- ----------------------------------------------------------------------------
-- 2) PatientFormLink submission linkage
-- ----------------------------------------------------------------------------
ALTER TABLE "PatientFormLink"
    ADD COLUMN "submissionType" TEXT,
    ADD COLUMN "submissionId" TEXT,
    ADD COLUMN "submittedAt" TIMESTAMP(3);

-- ----------------------------------------------------------------------------
-- 3) PatientOutboundAttempt
-- ----------------------------------------------------------------------------
CREATE TABLE "PatientOutboundAttempt" (
    "id"                TEXT          NOT NULL,
    "messageId"         TEXT          NOT NULL,
    "hospitalTenantId"  TEXT,
    "patientId"         TEXT          NOT NULL,
    "formLinkId"        TEXT,
    "channel"           TEXT          NOT NULL,
    "status"            TEXT          NOT NULL,
    "recipientMasked"   TEXT,
    "providerMessageId" TEXT,
    "errorMessage"      TEXT,
    "attemptNo"         INTEGER       NOT NULL,
    "triggerReason"     TEXT,
    "triggeredBy"       TEXT,
    "sentAt"            TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientOutboundAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientOutboundAttempt_messageId_createdAt_idx"
    ON "PatientOutboundAttempt"("messageId", "createdAt");
CREATE INDEX "PatientOutboundAttempt_hospitalTenantId_patientId_createdAt_idx"
    ON "PatientOutboundAttempt"("hospitalTenantId", "patientId", "createdAt");
CREATE INDEX "PatientOutboundAttempt_channel_status_idx"
    ON "PatientOutboundAttempt"("channel", "status");

ALTER TABLE "PatientOutboundAttempt"
    ADD CONSTRAINT "PatientOutboundAttempt_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "PatientOutboundMessage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientOutboundAttempt"
    ADD CONSTRAINT "PatientOutboundAttempt_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- 4) HospitalVisitFeedback
-- ----------------------------------------------------------------------------
CREATE TABLE "HospitalVisitFeedback" (
    "id"                      TEXT          NOT NULL,
    "hospitalTenantId"        TEXT          NOT NULL,
    "patientId"               TEXT          NOT NULL,
    "formLinkId"              TEXT,
    "messageId"               TEXT,
    "hospitalVisitReminderId" TEXT,
    "taskId"                  TEXT,
    "riskAlertId"             TEXT,
    "action"                  TEXT          NOT NULL,
    "note"                    TEXT,
    "submittedAt"             TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source"                  TEXT          NOT NULL DEFAULT 'H5_LINK',
    "createdAt"               TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               TIMESTAMP(3)  NOT NULL,
    CONSTRAINT "HospitalVisitFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HospitalVisitFeedback_hospitalTenantId_patientId_submittedAt_idx"
    ON "HospitalVisitFeedback"("hospitalTenantId", "patientId", "submittedAt");
CREATE INDEX "HospitalVisitFeedback_formLinkId_idx" ON "HospitalVisitFeedback"("formLinkId");
CREATE INDEX "HospitalVisitFeedback_messageId_idx" ON "HospitalVisitFeedback"("messageId");
CREATE INDEX "HospitalVisitFeedback_hospitalVisitReminderId_idx" ON "HospitalVisitFeedback"("hospitalVisitReminderId");
CREATE INDEX "HospitalVisitFeedback_taskId_idx" ON "HospitalVisitFeedback"("taskId");
CREATE INDEX "HospitalVisitFeedback_riskAlertId_idx" ON "HospitalVisitFeedback"("riskAlertId");

ALTER TABLE "HospitalVisitFeedback"
    ADD CONSTRAINT "HospitalVisitFeedback_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
