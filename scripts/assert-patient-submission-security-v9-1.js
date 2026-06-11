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
  const label = condition ? 'PASS' : 'FAIL';
  console.log(`${label.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failed += 1;
}

function includes(rel, needle) {
  return read(rel).includes(needle);
}

const dto = 'apps/api/src/patient-engagement/dto/submit-public.dto.ts';
const publicController = 'apps/api/src/patient-engagement/public-form.controller.ts';
const rules = 'apps/api/src/clinical-rules/clinical-rules.service.ts';
const formLink = 'apps/api/src/patient-engagement/form-link.service.ts';
const reminderWorker = 'apps/api/src/care-reminders/care-reminder-worker.service.ts';
const carePlans = 'apps/api/src/care-plans/care-plans.service.ts';
const schema = 'apps/api/prisma/schema.prisma';
const migration = 'apps/api/prisma/migrations/20260610213000_patient_submission_security_v9_1/migration.sql';
const publicPage = 'apps/web/src/pages/PublicFormPage.tsx';

console.log('\npatient-submission-security-v9.1 static assertion\n');

ok('public questionnaire DTO does not accept client score', !includes(dto, 'score?: number'));
ok('questionnaire controller ignores dto.score', !includes(publicController, 'dto.score'));
ok('questionnaire uses issued server scoring snapshot', includes(publicController, 'evaluateIssuedQuestionnaireSubmission'));
ok('questionnaire rule validates unknown answers', includes(rules, '问卷包含未知字段'));
ok('questionnaire rule validates required answers', includes(rules, '问卷必填项未填写'));
ok('questionnaire mappings must cover every allowed answer', includes(rules, 'pointsByValue 必须覆盖每一个允许答案'));
ok('old questionnaire links fail closed', includes(rules, 'QUESTIONNAIRE_LINK_REISSUE_REQUIRED'));

ok('vital controller resolves server-authoritative link context', includes(publicController, 'resolvePublicVitalSubmissionContext'));
ok('vital controller saves receivedAt', includes(publicController, 'receivedAt'));
ok('vital rules reject incompatible units', includes(rules, 'VITAL_UNIT_MISMATCH'));
ok('vital records schema has receivedAt', includes(schema, 'receivedAt  DateTime   @default(now())'));

ok('sensitive H5 forms use centralized identity policy', includes(formLink, 'IDENTITY_REQUIRED_FORM_TYPES'));
ok('worker no longer disables identity checks', !includes(reminderWorker, 'requiresIdentityCheck: false'));
ok('migration upgrades active sensitive links', includes(migration, 'UPDATE "PatientFormLink"'));

ok('submission linking no longer swallows schema errors', !includes(publicController, 'columns may not exist'));
ok('occurrence completion no longer swallows schema errors', !includes(publicController, 'table may not exist'));

ok('care-plan manual recalc requires write access', includes(carePlans, 'async recalculateByPatient(patientId: string, user: RequestUser) {\n    await this.access.assertPatientWritable(user, patientId);'));
ok('system care-plan refresh has explicit actor', includes(carePlans, "actorId: 'SYSTEM_CARE_PLAN_REFRESH'"));
ok('active NBA SLA preserves earlier deadline', includes(carePlans, 'dueAt: earlierOf(existing.dueAt, calculatedDueAt)'));
ok('NBA schema stores first proposed timestamp', includes(schema, 'firstProposedAt       DateTime @default(now())'));
ok('public questionnaire page does not submit score', !includes(publicPage, '\n            score,'));

if (failed) {
  console.error(`\n${failed} assertion(s) failed.\n`);
  process.exit(1);
}
console.log('\nAll patient-submission-security-v9.1 assertions passed.\n');
