#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const failures = [];

function read(relative) {
  const absolute = path.join(ROOT, relative);
  if (!fs.existsSync(absolute)) {
    failures.push(`missing file: ${relative}`);
    return '';
  }
  return fs.readFileSync(absolute, 'utf8');
}

function expect(relative, pattern, description) {
  const content = read(relative);
  const ok = typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content);
  if (!ok) failures.push(`${relative}: ${description}`);
}

const schema = 'apps/api/prisma/schema.prisma';
const migration = 'apps/api/prisma/migrations/20260610143000_patient_level_stratified_management_v9/migration.sql';
const disposition = 'apps/api/src/clinical-disposition/clinical-disposition.service.ts';
const clinicalRules = 'apps/api/src/clinical-rules/clinical-rules.service.ts';
const carePlans = 'apps/api/src/care-plans/care-plans.service.ts';
const workItems = 'apps/api/src/work-items/work-items.service.ts';
const dashboard = 'apps/web/src/pages/NurseDashboardPage.tsx';
const rulesPage = 'apps/web/src/pages/ClinicalRulesPage.tsx';
const publicForms = 'apps/api/src/patient-engagement/public-form.controller.ts';
const medications = 'apps/api/src/medications/medications.service.ts';
const engagementTab = 'apps/web/src/components/PatientEngagementTab.tsx';
const reminderWorker = 'apps/api/src/care-reminders/care-reminder-worker.service.ts';
const visitReminders = 'apps/api/src/hospital-visit-reminders/hospital-visit-reminders.service.ts';
const vitalMonitoring = 'apps/api/src/vital-monitoring-plans/vital-monitoring-plans.service.ts';
const seedAll = 'apps/api/prisma/seed-all.js';

expect(schema, 'enum ClinicalRuleLifecycleStatus', 'missing versioned rule lifecycle enum');
expect(schema, 'model ClinicalRuleApproval', 'missing rule approval records');
expect(schema, 'model CarePlan', 'missing patient-level CarePlan');
expect(schema, 'activeKey           String?  @unique', 'missing idempotent active CarePlan key');
expect(schema, 'model PatientRiskStratification', 'missing immutable stratification snapshots');
expect(schema, 'model NextBestAction', 'missing next-best-action proposals');
expect(schema, 'ruleSnapshot       Json?', 'RiskAlert does not retain rule snapshot');
expect(schema, 'inputSnapshot      Json?', 'RiskAlert does not retain evaluated input');
expect(schema, 'rawScore           Int?', 'QuestionnaireResult does not preserve the compact H5 raw score');
expect(schema, 'matchedConditions  Json?', 'RiskAlert does not retain matched conditions');
expect(schema, 'manualReviewStatus  String    @default("NOT_REQUIRED")', 'PatientFormLink lacks explicit manual-review state');
expect(schema, '@@index([manualReviewStatus, manualReviewDueAt])', 'PatientFormLink manual-review queue lacks SLA index');

expect(migration, '"rawScore" INTEGER', 'migration does not add QuestionnaireResult.rawScore');
expect(migration, '"activeKey" TEXT,', 'migration does not create active-key columns');
expect(migration, 'CREATE UNIQUE INDEX "DiseaseRuleTemplate_one_effective_per_disease_key"', 'migration does not enforce one effective rule version per disease');
expect(migration, 'ROW_NUMBER() OVER', 'legacy active rule normalization is not deterministic');
expect(migration, 'demo_questionnaire_defaults', 'migration does not repair known pre-v9 placeholder questionnaire bands');
expect(migration, 'CREATE UNIQUE INDEX "CarePlan_activeKey_key"', 'migration does not deduplicate active CarePlans');
expect(migration, 'CREATE UNIQUE INDEX "NextBestAction_activeKey_key"', 'migration does not deduplicate live recommendations');
expect(migration, '"missedFollowUpDueWithinMinutes" INTEGER NOT NULL DEFAULT 1440', 'migration does not persist missed-measurement task SLA');
expect(migration, '"followUpDueWithinHours" INTEGER NOT NULL DEFAULT 48', 'migration does not persist referral-reminder task SLA');
expect(migration, '"retryDueWithinHours" INTEGER NOT NULL DEFAULT 24', 'migration does not persist failed-referral retry SLA');
expect(migration, '"escalationTaskDueWithinMinutes" INTEGER NOT NULL DEFAULT 1440', 'migration does not persist reminder-escalation task SLA');
expect(migration, `"manualReviewStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED'`, 'migration does not add explicit H5 submission review state');
expect(migration, 'PatientFormLink_manualReviewStatus_manualReviewDueAt_idx', 'migration does not index the H5 submission review queue');

expect(disposition, 'ruleSnapshot: this.asJson(input.ruleTrace?.ruleSnapshot)', 'alerts are not persisting structured rule snapshots');
expect(disposition, 'matchedConditions: this.asJson(input.ruleTrace?.matchedConditions)', 'alerts are not persisting matched conditions');

expect(clinicalRules, 'ClinicalRuleLifecycleStatus.PHYSICIAN_REVIEW', 'missing physician-review lifecycle');
expect(clinicalRules, 'required: highRiskVital || highRiskQuestionnaire ? 2 : 1', 'high-risk rules do not require two approvals');
expect(clinicalRules, 'async estimateImpact', 'historical replay / affected-patient estimation is absent');
expect(clinicalRules, 'async simulateTemplate', 'rule simulation endpoint support is absent');
expect(clinicalRules, 'evaluateQuestionnaire', 'questionnaire scoring is not routed through versioned DB rules');
expect(clinicalRules, 'questionnaireAliases', 'legacy H5 questionnaire identifiers are not mapped to governed canonical types');
expect(clinicalRules, 'update: {},', 'default seeding can still mutate an existing released rule version');

expect(carePlans, 'async ensurePilotPlans', 'pilot patients are not auto-enrolled idempotently');
expect(carePlans, 'carePlans: { none: {} }', 'auto-enrollment can silently replace a paused or completed CarePlan');
expect(carePlans, "'BP_MEASUREMENT_MISSING_7D'", 'missing seven-day blood-pressure gap detection');
expect(carePlans, "'MEDICATION_ADHERENCE_LT_70'", 'missing 30-day adherence scoring');
expect(carePlans, "item.resultType === 'MedicationCheckIn'", 'adherence numerator does not distinguish completed untaken doses from taken doses');
expect(carePlans, 'takenCheckInIds.has(item.resultId)', 'adherence numerator is not based on MedicationCheckIn.taken');
expect(carePlans, "'GLUCOSE_ABNORMAL_THREE_CONSECUTIVE'", 'missing repeated abnormal glucose detection');
expect(carePlans, "'REFERRAL_CONFIRMATION_OVERDUE_7D'", 'missing referral loop timeout detection');
expect(carePlans, "'RECENT_ACUTE_ENCOUNTER_30D'", 'missing hospitalization / emergency visit signal');
expect(carePlans, 'CREATE_TASK_FROM_NEXT_BEST_ACTION', 'recommendations cannot be accepted into the durable Task workflow');

expect(workItems, "'CRITICAL_RISK'", 'today queue lacks critical-risk bucket');
expect(workItems, "'FAILED_CONTACT_RETRY'", 'today queue lacks failed-contact retry bucket');
expect(workItems, "'REFERRAL_CONFIRMATION'", 'today queue lacks referral confirmation bucket');
expect(workItems, "'SUBMISSION_REVIEW'", 'today queue lacks manual-review bucket');
expect(workItems, "'GATEWAY_CONFLICT'", 'today queue lacks gateway conflict bucket');
expect(workItems, "'CARE_PLAN_RECOMMENDATION'", 'patient-level recommendations are not projected to the workbench');
expect(workItems, "'PATIENT_SUBMISSION_REVIEW'", 'explicit H5 submission review rows are not projected to the workbench');
expect(workItems, "manualReviewStatus: 'PENDING'", 'workbench does not query the explicit H5 review queue');
expect(workItems, 'async reviewPatientSubmission', 'workbench cannot close an H5 manual-review item');
expect(workItems, 'mostRecentEvidence', 'workbench rows lack evidence summaries');
expect(workItems, 'slaRemainingSeconds', 'workbench rows lack SLA countdown');
expect(workItems, 'assigneeNameById', 'workbench exposes raw assignee IDs instead of resolving staff display names');

expect(dashboard, '护士今日行动队列', 'homepage was not converted to the nurse action queue');
expect(dashboard, '风险原因', 'queue UI lacks risk-reason column');
expect(dashboard, '最近证据', 'queue UI lacks evidence column');
expect(dashboard, '剩余 SLA', 'queue UI lacks SLA column');
expect(dashboard, '/care-plans/next-best-actions/', 'queue UI cannot convert a recommendation into a task');
expect(dashboard, '/work-items/submissions/', 'queue UI cannot close an H5 manual-review item');

expect(rulesPage, '克隆为新草稿', 'rules UI does not prevent direct editing of effective rules');
expect(rulesPage, '提交医生审核', 'rules UI lacks physician-review action');
expect(rulesPage, '激活生效', 'rules UI lacks explicit activation');

expect(publicForms, 'questionnaireRuleSnapshot?.questionnaireTemplateId', 'H5 questionnaire submission does not bind to its issued rule snapshot');
expect(publicForms, 'prepareQuestionnaireLinkPayload({ questionnaireType })', 'pre-v9 H5 questionnaire links do not receive a compatible governed snapshot during submission');
expect(publicForms, 'this.scaleQuestionnaireScore(rawScore, questionnaireRuleSnapshot)', 'H5 demo score is not scaled to the governed questionnaire scoring range');
expect(publicForms, 'this.evaluateConfiguredVital(patient', 'H5 vital submissions bypass effective DB rules');
expect(publicForms, 'ruleTrace: evaluation.ruleTrace', 'H5 vital alerts do not persist rule trace snapshots');
expect(publicForms, "manualReviewStatus: 'PENDING'", 'H5 clinical submissions do not enter the explicit manual-review queue');
expect(publicForms, 'PATIENT_SUBMISSION_REVIEW_SLA_HOURS', 'H5 submission review SLA is not configurable and persisted');
expect(publicForms, 'below 70% over 30 days', 'H5 single missed-dose submissions still create an immediate clinical alert');
expect(medications, 'below 70% over 30 days', 'staff medication check-ins still create an immediate single-dose clinical alert');
expect(engagementTab, 'HYPERTENSION_MONTHLY', 'new H5 questionnaire links are not issued with governed canonical types');
expect('apps/api/src/patient-engagement/form-link.service.ts', 'prepareQuestionnaireLinkPayload', 'questionnaire links do not persist their issued rule snapshot');
expect('apps/api/src/care-plans/care-plan-refresh.worker.ts', "CARE_PLAN_REFRESH_WORKER_ENABLED !== 'true'", 'CarePlan refresh worker is not opt-in');
expect(reminderWorker, 'occ.schedule.escalationTaskDueWithinMinutes', 'reminder escalation task SLA is still hard-coded in worker code');
expect(visitReminders, 'reminder.followUpDueWithinHours', 'referral reminder task SLA is still hard-coded in service code');
expect(publicForms, 'reminder.retryDueWithinHours', 'failed-referral retry SLA is still hard-coded in H5 feedback code');
expect(vitalMonitoring, 'plan.missedFollowUpDueWithinMinutes', 'missed-measurement task SLA is still hard-coded in service code');
expect(seedAll, 'ClinicalRuleLifecycleStatus', 'unified demo seed is unaware of governed release lifecycle');
expect(seedAll, 'questionnaireRuleDefaults', 'unified demo seed still writes placeholder questionnaire bands');
expect(seedAll, 'update: {},', 'unified demo seed still mutates released rule rows on rerun');

if (failures.length) {
  console.error('patient-level-stratified-management-v9 assertion FAILED');
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log('patient-level-stratified-management-v9 assertion PASSED');
console.log('Verified: schema, migration, rule traceability, lifecycle workflow, pilot CarePlans, stratification signals, action queue, and UI entry points.');
