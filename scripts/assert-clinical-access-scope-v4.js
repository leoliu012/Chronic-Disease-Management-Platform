#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const legacyId = ['nurse', '001'].join('-');
const failures = [];

function walk(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target).flatMap((name) => walk(path.join(target, name)));
}
function rel(file) { return path.relative(root, file).replace(/\\/g, '/'); }
function text(file) { return fs.readFileSync(file, 'utf8'); }
function mustContain(file, fragment, label = fragment) {
  const value = text(path.join(root, file));
  if (!value.includes(fragment)) failures.push(`${file}: missing ${label}`);
}

const scanFiles = [
  ...walk(path.join(root, 'apps/api/src')),
  ...walk(path.join(root, 'apps/web/src')),
  path.join(root, 'apps/api/prisma/seed-all.js'),
  ...walk(path.join(root, 'scripts')).filter((file) => !file.endsWith('assert-clinical-access-scope-v4.js')),
].filter((file) => /\.(ts|tsx|js|py)$/.test(file));

for (const file of scanFiles) {
  const value = text(file);
  if (value.includes(legacyId)) failures.push(`${rel(file)}: contains historical fixed demo nurse ID`);
  if (/const\s+nurseId\s*=/.test(value) && !rel(file).endsWith('seed-all.js')) failures.push(`${rel(file)}: frontend/runtime fixed nurseId constant`);
  if (/\?(?:[^`'"\s]*&)?nurseId=/.test(value)) failures.push(`${rel(file)}: nurseId query-string impersonation remains`);
  if (/query\.nurseId/.test(value) && !rel(file).endsWith('clinical-access-scope.guard.ts')) failures.push(`${rel(file)}: backend still trusts query.nurseId`);
}

mustContain('apps/api/src/app.module.ts', 'useClass: ClinicalAccessScopeGuard', 'global ClinicalAccessScopeGuard');
mustContain('apps/api/src/security/clinical-access-scope.service.ts', 'assertPatientVisible(user: RequestUser', 'assertPatientVisible');
mustContain('apps/api/src/security/clinical-access-scope.service.ts', 'assertPatientWritable(user: RequestUser', 'assertPatientWritable');
mustContain('apps/api/src/security/clinical-access-scope.service.ts', 'assertTaskVisible(user: RequestUser', 'assertTaskVisible');
mustContain('apps/api/src/security/clinical-access-scope.service.ts', 'assertAlertVisible(user: RequestUser', 'assertAlertVisible');
mustContain('apps/api/src/security/clinical-access-scope.service.ts', 'async buildPatientScope(', 'buildPatientScope');
mustContain('apps/api/src/security/clinical-access-scope.service.ts', 'async buildTaskScope(', 'buildTaskScope');
mustContain('apps/api/src/security/clinical-access-scope.guard.ts', 'const bodyPatientId', 'body object-level authorization');
mustContain('apps/api/src/patients/patients.service.ts', 'responsibleNurseId: dto.responsibleNurseId || undefined', 'unassigned queue behavior');
mustContain('apps/api/src/nurse-dashboard/nurse-dashboard.service.ts', 'pendingAllocationPatients', 'pending allocation queue');
mustContain('apps/api/src/patient-engagement/patient-engagement-tenant.service.ts', 'ClinicalAccessScopeService', 'patient engagement delegates to central ACL');
mustContain('apps/api/prisma/seed-all.js', "id: 'demo-care-nurse-a'", 'renamed demo nurse ID');

mustContain(
  'apps/api/src/his-integration/his-integration.service.ts',
  'where: await this.access.buildPatientScope(user, hospitalTenantId)',
  'HIS export must be scoped by the authenticated user',
);
mustContain(
  'apps/api/src/his-integration/his-integration.service.ts',
  'const patientScope = await this.access.buildPatientScope(user);',
  'HIS barcode lookup must be scoped by the authenticated user',
);
mustContain(
  'apps/api/src/his-integration/his-integration.service.ts',
  'lookupPatientByBarcodeForPatientSelfBind',
  'explicit patient-self HIS boundary',
);
mustContain(
  'apps/api/src/security/clinical-access-scope.service.ts',
  "action: 'ADMIN_TENANT_SCOPE_SELECTED'",
  'audited explicit admin tenant switch',
);
mustContain(
  'apps/api/src/patients/patients.controller.ts',
  "@Query('hospitalTenantId') hospitalTenantId?: string",
  'patient list explicit admin tenant selector',
);
mustContain(
  'apps/api/src/patient-app/patient-app.service.ts',
  'await this.access.assertPatientWritable(user, existing.patientId)',
  'binding-review object-level write authorization',
);
mustContain(
  'apps/api/src/patient-app/patient-app.service.ts',
  "reason: 'NEED_STRONGER_IDENTITY_PROOF'",
  'public identity lookup anti-enumeration proof requirement',
);
mustContain(
  'apps/api/src/chronic-leads/chronic-leads.service.ts',
  'resolveConfiguredOrSingleLocalHospitalTenant',
  'local-deployment ChronicLead hospital resolver',
);
mustContain(
  'apps/api/src/chronic-leads/chronic-leads.service.ts',
  '本地数据库存在多个启用医院',
  'ambiguous ChronicLead pool fail-closed guard',
);
mustContain(
  'apps/api/src/chronic-leads/chronic-leads.service.ts',
  'assigneeId: null',
  'new enrollment tasks stay unassigned until explicit allocation',
);
mustContain(
  'apps/api/src/chronic-leads/chronic-leads.module.ts',
  'imports: [PrismaModule, FollowUpsModule]',
  'FollowUpsModule dependency restored',
);
const chronicLeadsController = text(path.join(root, 'apps/api/src/chronic-leads/chronic-leads.controller.ts'));
if (!chronicLeadsController.includes('UserRole.NURSE') || !chronicLeadsController.includes('UserRole.DOCTOR')) {
  failures.push('apps/api/src/chronic-leads/chronic-leads.controller.ts: local-deployment lead workflow must allow nurse and doctor roles');
}
const integrationsController = text(path.join(root, 'apps/api/src/integrations/integrations.controller.ts'));
if (integrationsController.includes('UserRole.MANAGER')) {
  failures.push('apps/api/src/integrations/integrations.controller.ts: Global integration metadata endpoints must remain ADMIN-only until tenant mapping exists');
}

if (failures.length) {
  console.error('clinical-access-scope-v4 static assertion FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`[ok] checked ${scanFiles.length} runtime source files`);
console.log('[ok] historical fixed demo nurse ID is absent from runtime/web/seed source');
console.log('[ok] central clinical scope + global object-level guard are wired');
console.log('[ok] HIS lookup/export are scoped; integration metadata remains ADMIN-only');
console.log('[ok] local-deployment ChronicLead pool is pinned or single-hospital fail-closed');
console.log('[ok] pending-allocation queue and patient-engagement delegation are present');
