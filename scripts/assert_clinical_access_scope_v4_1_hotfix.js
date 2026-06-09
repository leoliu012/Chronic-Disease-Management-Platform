#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = fs.existsSync(path.join(packageRoot, 'apps'))
  ? packageRoot
  : path.join(packageRoot, 'files');
function read(rel) { return fs.readFileSync(path.join(repoRoot, rel), 'utf8'); }
function must(rel, needles) {
  const text = read(rel);
  for (const needle of needles) {
    if (!text.includes(needle)) throw new Error(`[fail] ${rel} missing: ${needle}`);
  }
  console.log(`[ok] ${rel}`);
}
must('apps/api/src/patient-app/patient-app.service.ts', [
  'hospitalTenantId: user.hospitalTenantId',
  'process.env.LOCAL_HOSPITAL_TENANT_ID',
]);
must('apps/api/src/chronic-leads/chronic-leads.service.ts', [
  'private readonly followupPlanGenerator: FollowupPlanGeneratorService',
  'const hospitalTenantId = await this.assertLocalLeadPoolUser(user);',
  'resolveConfiguredOrSingleLocalHospitalTenant',
  'hospitalTenantId,',
  'assigneeId: null,',
  '本地数据库存在多个启用医院',
]);
must('apps/api/src/chronic-leads/chronic-leads.module.ts', [
  "import { FollowUpsModule } from '../follow-ups/follow-ups.module';",
  'imports: [PrismaModule, FollowUpsModule]',
]);
must('apps/api/src/chronic-leads/chronic-leads.controller.ts', [
  '@Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)',
  'this.chronicLeadsService.findAll(query, user)',
]);
console.log('[done] clinical-access-scope v4.1 hotfix static assertions passed.');
