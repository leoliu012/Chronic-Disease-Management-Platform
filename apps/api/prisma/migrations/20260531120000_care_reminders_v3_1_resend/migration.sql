-- care_reminders_v3_1_resend
--
-- Adds resend bookkeeping to CareReminderOccurrence so "再次发送" can be tracked
-- across both reused and freshly-minted PatientFormLinks. The actual resend
-- history lives in PatientOutboundMessage (one row per send); these two columns
-- are a cheap denormalized summary for the UI / smoke assertions.
--
-- Both columns are additive and nullable-safe:
--   resendCount  defaults to 0 for every existing row
--   lastResentAt stays NULL until the first resend

ALTER TABLE "CareReminderOccurrence"
    ADD COLUMN "resendCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastResentAt" TIMESTAMP(3);
