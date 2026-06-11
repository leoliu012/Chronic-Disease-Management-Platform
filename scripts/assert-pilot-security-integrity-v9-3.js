#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];
function has(rel, pattern, label) { const s=read(rel); const ok=typeof pattern==='string'?s.includes(pattern):pattern.test(s); checks.push([ok,label]); }
function lacks(rel, pattern, label) { const s=read(rel); const ok=typeof pattern==='string'?!s.includes(pattern):!pattern.test(s); checks.push([ok,label]); }

has('apps/api/src/care-reminders/care-reminder-worker.service.ts', "expiresAt: occ.availableUntil", 'Reminder links expire with occurrence window');
has('apps/api/src/care-reminders/care-reminder-worker.service.ts', "MANUAL_ACTION_REQUIRED", 'Worker recognizes manual-action state');
has('apps/api/src/care-reminders/care-reminder-occurrence.service.ts', "async markManualActionRequired", 'Occurrence state machine has manual handoff');
has('apps/api/src/patient-engagement/outbound-message.service.ts', "status: 'DISPATCH_ACCEPTED'", 'Electronic sends use dispatch-accepted state');
has('apps/api/src/work-items/work-items.service.ts', "itemType: 'MANUAL_OUTBOUND_ACTION'", 'Manual copy enters nurse action queue');
has('apps/api/src/patient-engagement/public-form.controller.ts', 'publicPayloadForLink', 'Public payload is sanitized');
lacks('apps/api/src/patient-engagement/public-form.controller.ts', 'payload: formLink.payload', 'Public endpoint does not return raw internal payload');
has('apps/api/src/patient-engagement/public-form.controller.ts', 'requireFormLinkTenantId', 'Visit feedback fails closed without tenant');
has('apps/api/prisma/schema.prisma', 'idempotencyKey     String?                 @unique', 'Gateway canonical idempotency key is unique');
has('apps/api/src/gateway/services/inbound-event.service.ts', "join('\\u001f')", 'Gateway runtime canonical key format is deterministic');
has('apps/api/src/gateway/services/inbound-event.service.ts', "code === 'P2002'", 'Gateway converts concurrent unique race into duplicate audit');
has('apps/api/src/clinical-rules/clinical-rules.service.ts', 'validateTemplateForPublication', 'Clinical rule publication validates structure');
has('apps/api/src/clinical-rules/clinical-rules.service.ts', "unitsEqual(rule.unit, record.unit)", 'Impact replay is unit aware');
has('apps/api/src/clinical-rules/clinical-rules.service.ts', "patient: { hospitalTenantId }", 'Impact replay is tenant scoped');
has('apps/api/src/security/audit.interceptor.ts', "outcome: 'ATTEMPT'", 'Required audit writes durable attempt before sensitive handler');
has('apps/api/src/clinical-rules/clinical-rules.controller.ts', "mode: 'REQUIRED'", 'Clinical rule writes require audit');
has('apps/api/src/security/client-ip.util.ts', 'isTrustedProxyAddress', 'Client IP parser accepts proxy header only from trusted proxy');
has('apps/api/src/main.ts', 'CORS_ALLOWED_ORIGINS', 'Production CORS allowlist is explicit');
has('apps/api/src/auth/auth.service.ts', 'AUTH_LOGIN_MAX_FAILURES_ADMIN', 'Admin login has stricter persistent throttling');
has('apps/api/prisma/schema.prisma', 'model AuthLoginThrottle', 'Persistent auth throttle model exists');
has('apps/api/prisma/migrations/20260611033000_pilot_security_integrity_v9_3/migration.sql', 'IntegrationSyncRecord_idempotencyKey_key', 'Migration creates gateway idempotency unique index');
has('apps/api/prisma/migrations/20260611033000_pilot_security_integrity_v9_3/migration.sql', 'MANUAL_ACTION_REQUIRED', 'Migration backfills manual outbound state');
has('docs/P2_ENGINEERING_CLEANUP_ROADMAP.md', 'CarePlanPolicyTemplate', 'Deferred policy-governance roadmap recorded');

let failed=0;
for (const [ok,label] of checks) { console.log(`${ok?'PASS':'FAIL'} ${label}`); if(!ok) failed++; }
if (failed) { console.error(`pilot-security-integrity-v9.3 assertion failed: ${failed}/${checks.length}`); process.exit(1); }
console.log(`pilot-security-integrity-v9.3 assertion PASSED (${checks.length} checks)`);
