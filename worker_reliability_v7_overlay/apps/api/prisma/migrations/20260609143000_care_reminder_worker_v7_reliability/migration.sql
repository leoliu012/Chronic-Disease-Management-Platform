-- care_reminder_worker_v7_reliability
-- Trial-ready protections for the setInterval care reminder worker:
-- retry/backoff state, stale-SENDING recovery metadata, instance heartbeat,
-- and durable per-round metrics.

ALTER TABLE "CareReminderOccurrence"
  ADD COLUMN "sendAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextRetryAt" TIMESTAMP(3),
  ADD COLUMN "sendingStartedAt" TIMESTAMP(3),
  ADD COLUMN "lastSendAttemptAt" TIMESTAMP(3),
  ADD COLUMN "replayCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReplayRequestedAt" TIMESTAMP(3),
  ADD COLUMN "lastReplayRequestedBy" TEXT;

CREATE INDEX "CareReminderOccurrence_status_nextRetryAt_idx"
  ON "CareReminderOccurrence"("status", "nextRetryAt");
CREATE INDEX "CareReminderOccurrence_status_sendingStartedAt_idx"
  ON "CareReminderOccurrence"("status", "sendingStartedAt");

CREATE TABLE "CareReminderWorkerHeartbeat" (
  "instanceId"       TEXT         NOT NULL,
  "startedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt"      TIMESTAMP(3) NOT NULL,
  "stoppedAt"        TIMESTAMP(3),
  "lastRunAt"        TIMESTAMP(3),
  "lastSucceededAt"  TIMESTAMP(3),
  "lastFailedAt"     TIMESTAMP(3),
  "lastRunId"        TEXT,
  "lastSummary"      JSONB,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareReminderWorkerHeartbeat_pkey" PRIMARY KEY ("instanceId")
);

CREATE INDEX "CareReminderWorkerHeartbeat_heartbeatAt_idx"
  ON "CareReminderWorkerHeartbeat"("heartbeatAt");

CREATE TABLE "CareReminderWorkerRun" (
  "id"               TEXT         NOT NULL,
  "instanceId"       TEXT         NOT NULL,
  "status"           TEXT         NOT NULL,
  "startedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt"      TIMESTAMP(3),
  "finishedAt"       TIMESTAMP(3),
  "generated"        INTEGER      NOT NULL DEFAULT 0,
  "dispatched"       INTEGER      NOT NULL DEFAULT 0,
  "dispatchFailed"   INTEGER      NOT NULL DEFAULT 0,
  "retried"          INTEGER      NOT NULL DEFAULT 0,
  "retryScheduled"   INTEGER      NOT NULL DEFAULT 0,
  "recoveredStuck"   INTEGER      NOT NULL DEFAULT 0,
  "recoveredAsSent"  INTEGER      NOT NULL DEFAULT 0,
  "missed"           INTEGER      NOT NULL DEFAULT 0,
  "escalated"        INTEGER      NOT NULL DEFAULT 0,
  "error"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CareReminderWorkerRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CareReminderWorkerRun_status_startedAt_idx"
  ON "CareReminderWorkerRun"("status", "startedAt");
CREATE INDEX "CareReminderWorkerRun_finishedAt_idx"
  ON "CareReminderWorkerRun"("finishedAt");
CREATE INDEX "CareReminderWorkerRun_instanceId_startedAt_idx"
  ON "CareReminderWorkerRun"("instanceId", "startedAt");
