#!/usr/bin/env node
/* Static wiring checks. Run from repository root. */
const fs = require('fs');
function read(path) { return fs.readFileSync(path, 'utf8'); }
function expect(condition, message) { if (!condition) throw new Error(message); console.log(`[ok] ${message}`); }
function contains(path, pattern) { const text = read(path); return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text); }

const schema = 'apps/api/prisma/schema.prisma';
const disposition = 'apps/api/src/clinical-disposition/clinical-disposition.service.ts';
const workItems = 'apps/api/src/work-items/work-items.service.ts';
const timeline = 'apps/api/src/patient-timeline/patient-timeline.service.ts';
const detail = 'apps/web/src/pages/PatientDetailPage.tsx';
const taskPanel = 'apps/web/src/components/PatientTaskSidePanel.tsx';
const phone = 'apps/web/src/pages/TaskFollowUpPage.tsx';

expect(contains(schema, 'model RiskEpisode {') && contains(schema, 'openRiskEpisodeKey String? @unique'), 'RiskEpisode schema + DB-level one-open-task token exist');
expect(contains(disposition, 'signalRisk(') && contains(disposition, 'openRiskEpisodeKey: episode.id'), 'central disposition service owns risk aggregation and open task token');
expect(contains(disposition, 'data: { status: taskStatus, openRiskEpisodeKey: null }'), 'closing a risk episode clears open task token');
expect(contains(workItems, "itemType: 'RISK_ALERT_ONLY'") && contains(workItems, "itemType: 'GATEWAY_CONFLICT'") && contains(workItems, "itemType: 'CARE_REMINDER_ESCALATION'"), 'work-items projects alert-only, gateway-conflict, and overdue-reminder sources');
expect(!contains(workItems, 'alertOnlyCount: 0'), 'work-items no longer hard-codes alertOnlyCount=0');
for (const path of [
  'apps/api/src/vital-records/vital-records.service.ts',
  'apps/api/src/questionnaires/questionnaires.service.ts',
  'apps/api/src/medications/medications.service.ts',
  'apps/api/src/patient-engagement/public-form.controller.ts',
]) expect(contains(path, 'this.disposition.signalRisk'), `${path} routes risk signals through ClinicalDispositionService`);
expect(contains(detail, "keepEpisodeOpenForVisit ? 'in-progress' : 'resolve'"), 'urgent-visit action leaves episode IN_PROGRESS until final disposition');
expect(!contains(detail, 'syncRelatedTasksOnRiskResolve') && !contains(taskPanel, 'syncRelatedAlert') && !contains(phone, 'syncRelatedAlert'), 'frontend no longer offers optional risk-sync switches');
for (const type of ['RISK_EPISODE', 'PATIENT_OUTBOUND_MESSAGE', 'PATIENT_OUTBOUND_ATTEMPT', 'CARE_REMINDER_OCCURRENCE', 'HOSPITAL_VISIT_FEEDBACK']) {
  expect(contains(timeline, `'${type}'`), `timeline includes ${type}`);
}
console.log('[done] clinical disposition v5 static assertions passed.');
