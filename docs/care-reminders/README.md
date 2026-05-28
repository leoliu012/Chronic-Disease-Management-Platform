# Care Reminders v3 — 慢病长期提醒引擎

## What this module does

Patient-Engagement v2.1 (single-shot H5 link delivery) is the "底座". Care
Reminders v3 is the scheduling/lifecycle layer on top:

```
CareReminderSchedule        ← long-running plan (med daily 08:00, BP nightly 20:00)
   ↓ worker every 5 min
CareReminderOccurrence      ← one row per firing, unique(scheduleId, dueAt)
   ↓ dispatch (via v2.1 OutboundMessageService)
PatientFormLink             ← H5 token deliverable (existing)
   ↓ patient opens H5
PublicFormController        ← submit handler (existing)
   ↓ writes business row AND in same tx
CareReminderOccurrence.status = COMPLETED
```

If the patient doesn't show up within `availableUntil`, the occurrence is
marked `MISSED`. If `schedule.escalationAfterMinutes` is set, a nurse Task is
created (idempotent — exactly one Task per MISSED occurrence).

## Data model

### `CareReminderSchedule`

Long-running plan. Created from:

- A medication record (`sourceType=MEDICATION`, `sourceId=demo-med-001`)
- A vital monitoring plan (`sourceType=VITAL`)
- An ad-hoc nurse intent (`sourceType=MANUAL_MESSAGE`)

Key fields:

- `scheduledTimes: ["08:00","20:00"]` — wall clock in tenant timezone.
- `scheduledDays: ["MON","WED","FRI"] | null` — null = every day.
- `checkInWindowBeforeMinutes / checkInWindowAfterMinutes` — how long the H5
  link is valid around `dueAt`.
- `escalationAfterMinutes` — if a missed occurrence stays uncompleted this long,
  open a nurse Task. `null` = no escalation.
- `isActive=false + pausedAt=now` — paused; worker stops generating future
  occurrences. Already-PENDING rows are left alone (cancel them individually).

### `CareReminderOccurrence`

One row per firing. The `@@unique([scheduleId, dueAt])` index is the idempotency
key — re-running the worker for the same horizon is a `createMany({ skipDuplicates: true })`
no-op.

Status machine:

```
            ┌─────────────────────────────────────────────┐
            │                                             │
PENDING → SENDING → SENT → CLICKED → COMPLETED             ESCALATED
            │        │       │                              ↑
            │        │       └── form submitted in tx ──────┤
            │        │                                      │
            │        └──→ availableUntil expired ──→ MISSED ┘
            │                                       (+task)
            └─→ send failed → PENDING (retry next pass)
PENDING / SENT / CLICKED → CANCELED (manual)
```

Every transition uses `updateMany` with a status guard, so concurrent worker
passes can't double-send or double-escalate.

### `PatientDirectMessage`

Semantic envelope for nurse → patient ad-hoc messages. Dispatch still goes
through `OutboundMessageService` + a child `PatientFormLink` of type
`GENERAL_MESSAGE`. Adds: sender, priority (NORMAL/IMPORTANT/URGENT), `requiresAck`.

If `requiresAck=true`, the H5 shows a 我已知晓 button; submitting it sets
`status=ACKNOWLEDGED`.

## Worker

`CareReminderWorkerService` — follows the project convention (no `@nestjs/schedule`):
`setInterval` + `OnApplicationBootstrap` / `OnApplicationShutdown`. Disabled by
default; set `CARE_REMINDER_WORKER_ENABLED=true` in `.env` to enable.

Three passes per tick:

1. **passGenerate** — for every active schedule, materialize PENDING occurrences
   out to `CARE_REMINDER_WORKER_HORIZON_DAYS` days (default 3) in tenant timezone.
2. **passDispatch** — for PENDING occurrences inside the reminder window
   (`availableFrom <= now <= availableUntil`):
   - atomic PENDING → SENDING claim
   - create `PatientFormLink` + `PatientOutboundMessage`
   - dispatch (WeChat → SMS fallback inherits from v2.1)
   - on success: SENDING → SENT; on failure: SENDING → PENDING (retry next pass)
3. **passMissed** — for occurrences past `availableUntil` not in {COMPLETED,
   CANCELED}: mark MISSED. For MISSED + `schedule.escalationAfterMinutes` not
   null + escalation deadline passed: create nurse Task, then atomically attach
   via `markEscalated`. If the atomic claim loses a race, delete the orphan task.

## Tenant isolation

Same model as v2.1:
- Every endpoint calls `PatientEngagementTenantService.assertPatientVisibleToUser`.
- Writes additionally call `assertWriteAllowed` (blocks MANAGER from writing).
- ADMIN can cross-tenant; DOCTOR/NURSE/MANAGER are pinned to their own.

Smoke covers this via the demo-tenant-002 / nurse2 fixtures introduced in v2.1.

## Multi-instance safety

**Not implemented.** This worker assumes a single Nest replica. If you run >1
replicas, only one should set `CARE_REMINDER_WORKER_ENABLED=true`. The
idempotency key on `CareReminderOccurrence` would prevent duplicate occurrences
if two workers raced, but you'd still have two dispatch attempts per firing.
Future hardening: PG advisory lock for leader election, or move dispatch to a
Bull/Redis queue.

## Limitations / TODO

- `SmsService` is still mock-only (carried over from v2.1).
- "Calendar exceptions" (skip a date, one-off shift) not supported — the only
  way to skip a day right now is to pause the schedule or cancel the occurrence.
- No weekly/monthly recurrence math beyond `scheduledDays`; everything fires
  per-day by default.
- The state field is a string. If you find yourself adding more states, promote
  it to a Prisma enum.
