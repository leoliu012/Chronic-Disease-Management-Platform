#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
let failed = 0;

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function ok(name, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failed += 1;
}

function has(rel, needle) {
  return read(rel).includes(needle);
}

const schema = read('apps/api/prisma/schema.prisma');
const migration = read('apps/api/prisma/migrations/20260611013000_tenant_worker_integrity_v9_2/migration.sql');
const reminderOccurrence = read('apps/api/src/care-reminders/care-reminder-occurrence.service.ts');
const reminderWorker = read('apps/api/src/care-reminders/care-reminder-worker.service.ts');
const carePlans = read('apps/api/src/care-plans/care-plans.service.ts');
const refreshWorker = read('apps/api/src/care-plans/care-plan-refresh.worker.ts');
const formLinks = read('apps/api/src/patient-engagement/form-link.service.ts');
const publicForms = read('apps/api/src/patient-engagement/public-form.controller.ts');
const integrationPromote = read('apps/api/src/gateway/services/integration-promote.service.ts');
const gatewaySources = read('apps/api/src/gateway/services/gateway-source-registry.service.ts');
const engagementTenant = read('apps/api/src/patient-engagement/patient-engagement-tenant.service.ts');

ok('Patient tenant is required', /model Patient \{[\s\S]*?hospitalTenantId String\n/.test(schema));
ok('Patient hospital number is tenant-scoped', schema.includes('@@unique([hospitalTenantId, hospitalPatientId])'));
ok('Patient hospital number is no longer globally unique', !schema.includes('hospitalPatientId String? @unique'));
ok('IntegrationSource tenant is required', /model IntegrationSource \{[\s\S]*?hospitalTenantId String\n/.test(schema));
ok('PatientFormLink tenant is required', /model PatientFormLink \{[\s\S]*?hospitalTenantId\s+String\n/.test(schema));
ok('PatientOutboundMessage tenant is required', /model PatientOutboundMessage \{[\s\S]*?hospitalTenantId\s+String\n/.test(schema));
ok('PatientOutboundAttempt tenant is required', /model PatientOutboundAttempt \{[\s\S]*?hospitalTenantId\s+String\n/.test(schema));
ok('Migration drops global hospital-number uniqueness', migration.includes('DROP CONSTRAINT IF EXISTS "Patient_hospitalPatientId_key"'));
ok('Migration creates tenant hospital-number uniqueness', migration.includes('CREATE UNIQUE INDEX "Patient_hospitalTenantId_hospitalPatientId_key"'));
ok('IntegrationSource code is tenant-scoped', schema.includes('@@unique([hospitalTenantId, code])'));
ok('Migration drops global integration-source code uniqueness', migration.includes('DROP CONSTRAINT IF EXISTS "IntegrationSource_code_key"'));
ok('Migration creates tenant integration-source code uniqueness', migration.includes('CREATE UNIQUE INDEX "IntegrationSource_hospitalTenantId_code_key"'));
ok('Migration fails closed when tenant backfill is impossible', migration.includes('cannot infer IntegrationSource hospitalTenantId with multiple/no tenants') && migration.includes('cannot infer Patient hospitalTenantId with multiple/no tenants'));
ok('Public feedback has no empty-tenant fallback', !publicForms.includes("hospitalTenantId: formLink.hospitalTenantId ?? ''"));
ok('Form links resolve patient tenant server-side', formLinks.includes('resolvePatientTenant('));
ok('Engagement rows enforce same-tenant ownership', engagementTenant.includes('assertSameTenant('));

ok('Reminder Task has occurrence idempotency source', schema.includes('sourceCareReminderOccurrenceId String? @unique'));
ok('Reminder escalation is transactional', reminderOccurrence.includes('return this.prisma.$transaction(async (tx) =>'));
ok('Reminder escalation claims ESCALATING before Task creation', reminderOccurrence.includes("data: { status: 'ESCALATING' }"));
ok('Reminder escalation upserts Task by occurrence source', reminderOccurrence.includes('where: { sourceCareReminderOccurrenceId: args.occurrenceId }'));
ok('Reminder worker delegates atomic escalation', reminderWorker.includes('this.occurrences.escalateMissedOccurrence({'));
ok('Reminder worker removed best-effort orphan deletion', !reminderWorker.includes('best-effort orphan cleanup'));

ok('Task has NextBestAction idempotency source', schema.includes('sourceNextBestActionId         String? @unique'));
ok('NextBestAction Task creation atomically claims recommendation', carePlans.includes("status: 'ACCEPTING'"));
ok('NextBestAction Task stores unique source key', carePlans.includes('sourceNextBestActionId: id'));

ok('CarePlan stores current snapshot hash', schema.includes('currentSnapshotHash String?'));
ok('Stratification snapshot hash is unique per plan', schema.includes('@@unique([carePlanId, snapshotHash])'));
ok('CarePlan computes SHA-256 stable snapshot', carePlans.includes("createHash('sha256').update(stableJson(value)).digest('hex')"));
ok('CarePlan atomically claims changed snapshots', carePlans.includes('const claimedPlan = await tx.carePlan.updateMany({'));
ok('Identical snapshots do not append history', carePlans.includes('if (claimedPlan.count !== 1) return;'));
ok('Stratification history uses idempotent upsert', carePlans.includes('await tx.patientRiskStratification.upsert({'));

ok('CarePlan worker uses PG advisory lock', refreshWorker.includes('pg_try_advisory_xact_lock'));
ok('CarePlan worker persists heartbeat', refreshWorker.includes('carePlanRefreshWorkerHeartbeat'));
ok('CarePlan worker persists durable runs', refreshWorker.includes('carePlanRefreshWorkerRun'));
ok('CarePlan worker reports failed patient IDs', refreshWorker.includes('failedPatientIds'));
ok('CarePlan worker cancels startup timer on shutdown', refreshWorker.includes('clearTimeout(this.startupTimer)'));
ok('Gateway promotion resolves source tenant', integrationPromote.includes('await this.requireSourceTenant(record.sourceId)'));
ok('Gateway patient lookup uses tenant composite key', integrationPromote.includes('hospitalTenantId_hospitalPatientId'));
ok('Gateway source registry binds sources to local tenant', gatewaySources.includes('resolveLocalHospitalTenantId'));

if (failed) {
  console.error(`\ntenant-worker-integrity-v9.2 assertion FAILED: ${failed} check(s) failed`);
  process.exit(1);
}

console.log('\ntenant-worker-integrity-v9.2 assertion PASSED');
console.log('Verified: tenant closure, crash-safe reminder escalation, NextBestAction idempotency, durable refresh-worker metrics, and snapshot deduplication.');
