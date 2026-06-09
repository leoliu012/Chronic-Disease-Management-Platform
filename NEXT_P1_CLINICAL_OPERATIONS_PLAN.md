# Next P1 clinical operations patches

The Worker v7 bundle intentionally stops at pilot reliability hardening. The
following items should be implemented as separate reviewable patches so the
single clinical-disposition chain remains intact.

## P1-A — Care teams, claim queues, and shift handover

Add schema models:

```text
CareTeam
CareTeamMember
CareTeamPatientAssignment
WorkItemAssignmentEvent
ShiftHandoverNote
```

Preserve the invariant:

```text
Task is the only clinical disposition work item.
```

Do not add a parallel queue table that competes with `Task`. Queue membership is
a projection from task status, assignment, SLA, risk episode, and team scope.

Required queues:

```text
MY_TASKS
TEAM_CLAIMABLE
SLA_AT_RISK
ESCALATED_REVIEW
```

Required actions:

```text
claim
reassign
bulk-assign
handover
pause-with-reason
reopen
```

Every mutation must append both `TaskProcessingEvent` and audit-log evidence.
Expand `ClinicalAccessScopeService` centrally for team scope instead of
reimplementing team predicates in every feature module.

## P1-B — Make the nurse homepage depend on `/work-items`

Add:

```http
GET /work-items/summary
GET /work-items?queue=MY_TASKS&cursor=...
GET /work-items?riskLevel=VERY_HIGH&status=OPEN
```

The nurse homepage should not independently aggregate tasks, alerts, reminder
occurrences, and gateway conflicts. It should consume the canonical projection.

Each row should include:

```text
slaRemainingSeconds
riskLevel
patientName
hospitalPatientNo
triggerReason
latestAbnormalValue
latestContactStatus
currentAssignee
repeatTriggerCount
actionUrl
```

Expose an anomaly metric:

```text
orphanCareReminderEscalationCount
```

This is the number of SLA-expired occurrences still visible through the fallback
projection but not yet attached to a durable Task.

## P1-C — Admin-only `/operations`

Create a dedicated admin operations module and page. It should consume backend
summary endpoints rather than browser-side aggregation.

Sections:

```text
Reminder Worker
Patient delivery
Clinical disposition
Gateway integration
Data quality
Audit
```

Worker v7 already supplies the first section's core data:

```text
heartbeats
latest successful run
recent rounds
PENDING / SENDING / FAILED backlog
scheduled retries
stale SENDING
manual recovery endpoint
manual replay endpoint
```

The page can be added after Worker v7 is migrated and verified.

## Stable-version evolution

After the pilot:

```text
transactional outbox
  -> BullMQ / Redis queue
  -> dedicated consumers
  -> provider idempotency keys where supported
```

Redis is already present in the local stack, so this remains a natural evolution
without changing the clinical-domain model.
