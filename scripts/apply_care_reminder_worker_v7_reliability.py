#!/usr/bin/env python3
from __future__ import annotations

import shutil
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path.cwd()
OVERLAY = ROOT / 'worker_reliability_v7_overlay'
SCHEMA = ROOT / 'apps/api/prisma/schema.prisma'
BACKUP = ROOT / 'apps/api/.patch-backups' / f"care-reminder-worker-v7-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

FILES = [
    'apps/api/src/care-reminders/care-reminder-occurrence.service.ts',
    'apps/api/src/care-reminders/care-reminder-worker.service.ts',
    'apps/api/src/care-reminders/care-reminders.controller.ts',
    'apps/api/prisma/migrations/20260609143000_care_reminder_worker_v7_reliability/migration.sql',
    'apps/api/prisma/check-care-reminder-worker-v7.js',
]


def fail(msg: str) -> None:
    print(f'[err] {msg}', file=sys.stderr)
    raise SystemExit(1)


def backup(path: Path) -> None:
    if not path.exists():
        return
    rel = path.relative_to(ROOT)
    target = BACKUP / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)


def copy_overlay(rel: str) -> None:
    src = OVERLAY / rel
    dst = ROOT / rel
    if not src.exists():
        fail(f'missing overlay file: {src}')
    backup(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    print(f'[ok] installed {rel}')


def patch_schema() -> None:
    if not SCHEMA.exists():
        fail(f'missing {SCHEMA}; run from repository root')
    src = SCHEMA.read_text(encoding='utf-8')
    original = src

    fields_anchor = '  lastResentAt      DateTime?\n'
    fields = '''  // care-reminder-worker-v7 — durable retry and crash recovery metadata
  sendAttemptCount      Int       @default(0)
  retryCount            Int       @default(0)
  nextRetryAt           DateTime?
  sendingStartedAt      DateTime?
  lastSendAttemptAt     DateTime?
  replayCount           Int       @default(0)
  lastReplayRequestedAt DateTime?
  lastReplayRequestedBy String?
'''
    if 'sendAttemptCount' not in src:
        if fields_anchor not in src:
            fail('schema anchor missing: CareReminderOccurrence.lastResentAt')
        src = src.replace(fields_anchor, fields_anchor + fields, 1)

    index_anchor = '  @@index([formLinkId])\n}\n\nmodel PatientDirectMessage {'
    index_replacement = '''  @@index([formLinkId])
  @@index([status, nextRetryAt])
  @@index([status, sendingStartedAt])
}

model PatientDirectMessage {'''
    if '@@index([status, nextRetryAt])' not in src:
        if index_anchor not in src:
            fail('schema anchor missing: CareReminderOccurrence formLink index')
        src = src.replace(index_anchor, index_replacement, 1)

    models = '''

// ============================================================================
// care-reminder-worker-v7 — heartbeat + per-round metrics
// ============================================================================

model CareReminderWorkerHeartbeat {
  instanceId      String   @id
  startedAt       DateTime @default(now())
  heartbeatAt     DateTime
  stoppedAt       DateTime?
  lastRunAt       DateTime?
  lastSucceededAt DateTime?
  lastFailedAt    DateTime?
  lastRunId       String?
  lastSummary     Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([heartbeatAt])
}

model CareReminderWorkerRun {
  id              String   @id @default(uuid())
  instanceId      String
  status          String
  startedAt       DateTime @default(now())
  heartbeatAt     DateTime?
  finishedAt      DateTime?
  generated       Int      @default(0)
  dispatched      Int      @default(0)
  dispatchFailed  Int      @default(0)
  retried         Int      @default(0)
  retryScheduled  Int      @default(0)
  recoveredStuck  Int      @default(0)
  recoveredAsSent Int      @default(0)
  missed          Int      @default(0)
  escalated       Int      @default(0)
  error           String?
  createdAt       DateTime @default(now())

  @@index([status, startedAt])
  @@index([finishedAt])
  @@index([instanceId, startedAt])
}
'''
    if 'model CareReminderWorkerHeartbeat {' not in src:
        src = src.rstrip() + models + '\n'

    if src != original:
        backup(SCHEMA)
        SCHEMA.write_text(src, encoding='utf-8')
        print('[ok] patched apps/api/prisma/schema.prisma')
    else:
        print('[skip] schema already contains worker v7 fields/models')


def main() -> None:
    if not OVERLAY.exists():
        fail(f'missing {OVERLAY}; unzip and rsync the bundle into repository root first')
    patch_schema()
    for rel in FILES:
        copy_overlay(rel)
    print(f'[ok] backup directory: {BACKUP}')
    print('[next] cd apps/api && npx prisma migrate dev && npx prisma generate && npm run build')


if __name__ == '__main__':
    main()
