#!/usr/bin/env node
const fs = require('fs');

function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`missing ${path}; run from repository root`);
  }
  return fs.readFileSync(path, 'utf8');
}

function expect(ok, message) {
  if (!ok) throw new Error(message);
  console.log(`[ok] ${message}`);
}

const worker = read('apps/api/src/care-reminders/care-reminder-worker.service.ts');
const controller = read('apps/api/src/care-reminders/care-reminders.controller.ts');
const smoke = read('apps/api/scripts/smoke-care-reminders.js');

expect(
  worker.includes('async dispatchOccurrenceNow(id: string)'),
  'worker exposes exact-occurrence targeted dispatch',
);
expect(
  worker.includes("const primaryAttempt = await this.outbound.attemptDispatch({"),
  'worker uses canonical outbound-attempt primitive',
);
expect(
  !worker.includes('const fb = await this.outbound.create({'),
  'WeChat → SMS fallback does not create a second outbound case row',
);
expect(
  controller.includes('const refreshed = await this.worker.dispatchOccurrenceNow(id);'),
  'send-now controller invokes targeted dispatch',
);
expect(
  !controller.includes("// Easiest path: just invoke runOnce()"),
  'send-now controller no longer invokes the global worker pass',
);

const writableCount = (controller.match(/assertPatientWritableToUser/g) || []).length;
expect(
  writableCount >= 10,
  `care-reminders mutation routes enforce write scope (found ${writableCount})`,
);
expect(
  smoke.includes("'6. PENDING occurrence selected for targeted send-now'"),
  'smoke selects an unconsumed PENDING occurrence',
);
expect(
  smoke.includes("fixture: 'synthetic-fallback'"),
  'smoke can create a future targeted-send fixture after horizon exhaustion',
);
expect(
  smoke.includes("'17a. nurse2 → demo-patient-001 schedules → 403/404'") &&
    smoke.includes("'17b. nurse2 → create cross-tenant schedule → 403/404'"),
  'smoke accepts anti-enumeration 404 for cross-tenant access',
);

console.log('\n[done] care-reminders v3.3.4 static assertions passed.');
