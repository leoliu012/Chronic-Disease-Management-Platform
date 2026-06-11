# P2 Engineering Cleanup Roadmap

This roadmap is intentionally separate from the v9.3 P1 security patch. Complete it after the pilot-security regression suite is stable.

## P2-1 Reminder dispatch architecture

The Reminder Worker still holds a PostgreSQL transaction-scoped advisory lock across a full delivery round, including external WeChat and SMS provider calls. Instrument round duration, database connection usage, idle-in-transaction duration, and provider latency first. Then migrate to a session-level lock on a dedicated connection, a lease table, or a transactional outbox plus queue worker.

## P2-2 Govern patient-level stratification policy

Move the CarePlan scoring windows, adherence thresholds, priority weights, doctor-escalation flags, and SLA hours out of TypeScript constants into versioned, approved policy entities:

- `CarePlanPolicyTemplate`
- `CarePlanPolicyVersion`
- `CarePlanPolicyApproval`
- `CarePlanPolicyTestCase`

Use the same Draft → Physician Review → Published → Effective → Deactivated lifecycle as clinical rules.

## P2-3 Model care teams and handoff

Replace free-text `CarePlan.owningTeamId` usage with:

- `CareTeam`
- `CareTeamMember`
- `CareTeamPatientAssignment`
- `ShiftHandover`

Support unclaimed queues, reassignment, handoff notes, and batch assignment.

## P2-4 Convert operational strings into state machines

Migrate high-risk free-text states into Prisma enums and centralized transition services. Prioritize:

- `PatientFormLink.status`
- `PatientOutboundMessage.status`
- `CareReminderOccurrence.status`
- `NextBestAction.status`
- `CarePlan.status`
- `manualReviewStatus`

Preserve migration compatibility for legacy rows.

## P2-5 Split oversized frontend components

Split `PatientDetailPage.tsx` into patient header, disease profile, vital monitoring, medication, risk episode, CarePlan, timeline, and engagement sections. Split `PublicFormPage.tsx` by form type. Introduce generated API types or Zod schemas for shared contracts.

## P2-6 Establish a clean release baseline

Keep runtime source, migrations, required smoke scripts, and formal documentation in the release branch. Move historical patch overlays into an archive branch or external artifact store. Remove tracked `.DS_Store`, local source dumps, and obsolete apply documents after confirming they are not required for rollback.
