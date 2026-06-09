#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`[PASS] ${message}`);
  }
}

const interceptor = read('apps/api/src/security/audit.interceptor.ts');
assert(!interceptor.includes('matchAuditRoute'), 'AuditInterceptor no longer contains route regex matcher');
assert(interceptor.includes('AUDIT_METADATA_KEY'), 'AuditInterceptor reads decorator metadata');
assert(interceptor.includes('getAllAndOverride<AuditPolicy>'), 'AuditInterceptor resolves method/class policy');
assert(interceptor.includes("outcome: 'FAILURE'"), 'AuditInterceptor records failed route executions');

const decorator = read('apps/api/src/security/audit.decorator.ts');
assert(decorator.includes('export const Audit ='), '@Audit decorator exists');
assert(decorator.includes('resolveAuditDetails'), 'audit detail extraction is allow-listed');
assert(decorator.includes('looksSensitive'), 'audit details reject sensitive field names');

const guard = read('apps/api/src/security/clinical-access-scope.guard.ts');
assert(guard.includes('CLINICAL_ACCESS_DENIED'), 'scope guard writes denied-access audit events');
assert(guard.includes('${policy.action}_DENIED'), 'decorated denied requests retain business action');

const actionFiles = {
  VIEW_PATIENT_DETAIL: 'apps/api/src/patients/patients.controller.ts',
  VIEW_MEDICAL_RECORDS: 'apps/api/src/patients/patients.controller.ts',
  VIEW_EXAM_REPORTS: 'apps/api/src/patients/patients.controller.ts',
  VIEW_HOSPITAL_PRESCRIPTIONS: 'apps/api/src/patients/patients.controller.ts',
  EXPORT_PATIENT_DATA: 'apps/api/src/his-integration/his-integration.controller.ts',
  CREATE_MEDICATION_PLAN: 'apps/api/src/medications/medications.controller.ts',
  UPDATE_MEDICATION_PLAN: 'apps/api/src/medications/medications.controller.ts',
  DEACTIVATE_MEDICATION_PLAN: 'apps/api/src/medications/medications.controller.ts',
  CREATE_VITAL_MONITORING_PLAN: 'apps/api/src/vital-monitoring-plans/vital-monitoring-plans.controller.ts',
  UPDATE_VITAL_MONITORING_PLAN: 'apps/api/src/vital-monitoring-plans/vital-monitoring-plans.controller.ts',
  DEACTIVATE_VITAL_MONITORING_PLAN: 'apps/api/src/vital-monitoring-plans/vital-monitoring-plans.controller.ts',
  SEND_PATIENT_QUESTIONNAIRE: 'apps/api/src/patient-engagement/admin-patient-engagement.controller.ts',
  REVOKE_PATIENT_H5_LINK: 'apps/api/src/patient-engagement/admin-patient-engagement.controller.ts',
  START_TASK_PROCESSING: 'apps/api/src/tasks/tasks.controller.ts',
  COMPLETE_TASK_PROCESSING: 'apps/api/src/tasks/tasks.controller.ts',
  CLOSE_RISK_EPISODE_RESOLVED: 'apps/api/src/risk-alerts/risk-alerts.controller.ts',
  UPDATE_VITAL_THRESHOLD_RULE: 'apps/api/src/clinical-rules/clinical-rules.controller.ts',
  ISSUE_GATEWAY_API_KEY: 'apps/api/src/gateway/controllers/gateway-admin.controller.ts',
  REVOKE_GATEWAY_API_KEY: 'apps/api/src/gateway/controllers/gateway-admin.controller.ts',
};

for (const [action, file] of Object.entries(actionFiles)) {
  assert(read(file).includes(`action: '${action}'`), `${action} is declared with @Audit`);
}

const appModule = read('apps/api/src/app.module.ts');
assert(appModule.includes('HealthModule'), 'HealthModule registered');
assert(appModule.includes('AdminOpsModule'), 'AdminOpsModule registered');

const healthController = read('apps/api/src/health/health.controller.ts');
assert(healthController.includes("@Get('live')"), 'GET /health/live exists');
assert(healthController.includes("@Get('ready')"), 'GET /health/ready exists');
assert(healthController.includes('@Public()'), 'health endpoints are public');

const opsController = read('apps/api/src/admin-ops/admin-ops.controller.ts');
for (const route of ['summary', 'reminder-worker', 'gateway', 'data-integrity']) {
  assert(opsController.includes(`@Get('${route}')`), `GET /admin/ops/${route} exists`);
}
assert(opsController.includes('@Roles(UserRole.ADMIN)'), 'ops endpoints are admin-only');

const opsPage = read('apps/web/src/pages/AdminOpsPage.tsx');
assert(opsPage.includes('系统健康 / 运维中心'), 'admin ops page title exists');
assert(opsPage.includes('提醒 Worker'), 'admin ops page includes reminder worker section');
assert(opsPage.includes('数据完整性'), 'admin ops page includes data integrity section');

const app = read('apps/web/src/App.tsx');
assert(app.includes("to: '/admin/ops'"), 'admin ops sidebar entry exists');
assert(app.includes('path="/admin/ops"'), 'admin ops route exists');

if (process.exitCode) {
  console.error('\n[FAIL] audit-ops-v8 assertions failed');
  process.exit(process.exitCode);
}
console.log('\n[PASS] audit-ops-v8 static assertions succeeded');
