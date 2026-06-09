-- trial-stabilization-v8.1: persist H5 expiry housekeeping count per care-reminder worker run.
ALTER TABLE "CareReminderWorkerRun"
ADD COLUMN "expiredLinks" INTEGER NOT NULL DEFAULT 0;
