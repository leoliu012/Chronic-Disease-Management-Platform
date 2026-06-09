#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function must(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`[assert] missing ${label}: ${needle}`);
}

const schema = read('apps/api/prisma/schema.prisma');
const occurrence = read('apps/api/src/care-reminders/care-reminder-occurrence.service.ts');
const worker = read('apps/api/src/care-reminders/care-reminder-worker.service.ts');
const controller = read('apps/api/src/care-reminders/care-reminders.controller.ts');
const migration = read('apps/api/prisma/migrations/20260609143000_care_reminder_worker_v7_reliability/migration.sql');

for (const field of [
  'sendAttemptCount',
  'retryCount',
  'nextRetryAt',
  'sendingStartedAt',
  'replayCount',
  'lastReplayRequestedAt',
]) must(schema, field, `schema field ${field}`);
must(schema, 'model CareReminderWorkerHeartbeat', 'heartbeat model');
must(schema, 'model CareReminderWorkerRun', 'run model');
must(worker, 'pg_try_advisory_xact_lock', 'PostgreSQL advisory lock');
must(worker, 'recoverStuckSending', 'stale SENDING recovery');
must(worker, 'latestSuccessfulRunAt', 'latest success status');
must(worker, 'heartbeatInterrupted', 'heartbeat interruption detection');
must(worker, 'attachDispatchArtifacts', 'pre-dispatch artifact persistence');
must(worker, "triggerReason: message.lastAttemptAt ? 'WORKER_RETRY' : 'INITIAL'", 'worker retry attempt reason');
must(occurrence, 'Math.pow(2', 'exponential retry backoff');
must(occurrence, 'requestReplay', 'manual replay service');
must(controller, "@Post('occurrences/:id/replay')", 'manual replay route');
must(controller, "@Post('worker/recover-stuck')", 'manual recovery route');
must(migration, 'CREATE TABLE "CareReminderWorkerHeartbeat"', 'heartbeat migration');
must(migration, 'CREATE TABLE "CareReminderWorkerRun"', 'run migration');
console.log('[PASS] care-reminder-worker-v7 static assertions succeeded');
