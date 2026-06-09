#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(rel) {
  const target = path.join(root, rel);
  if (!fs.existsSync(target)) throw new Error(`missing file: ${rel}`);
  return fs.readFileSync(target, 'utf8');
}

function requireText(rel, needle) {
  const value = read(rel);
  if (!value.includes(needle)) throw new Error(`${rel}: missing ${JSON.stringify(needle)}`);
}

function forbidText(rel, needle) {
  const value = read(rel);
  if (value.includes(needle)) throw new Error(`${rel}: forbidden stale text ${JSON.stringify(needle)}`);
}

requireText('apps/web/src/components/CareReminderGroupedViews.tsx', 'GroupedCareReminderSchedules');
requireText('apps/web/src/components/CareReminderGroupedViews.tsx', 'GroupedCareReminderOccurrences');
requireText('apps/web/src/components/CareReminderGroupedViews.tsx', "VITAL: { label: '指标监测'");
requireText('apps/web/src/components/CareReminderGroupedViews.tsx', "MEDICATION: { label: '用药计划'");
requireText('apps/web/src/components/CareReminderGroupedViews.tsx', "SPO2: '血氧'");
requireText('apps/web/src/components/CareRemindersPanel.tsx', '<GroupedCareReminderSchedules');
requireText('apps/web/src/components/CareRemindersPanel.tsx', '<GroupedCareReminderOccurrences');
requireText('apps/web/src/pages/CareRemindersPage.tsx', '<GroupedCareReminderOccurrences');
requireText('apps/web/src/components/PatientEngagementTab.tsx', 'function groupMessages(');
requireText('apps/web/src/components/PatientEngagementTab.tsx', "return { label: '服药提醒', hint: '按药品名称归类' };");
requireText('apps/web/src/components/PatientEngagementTab.tsx', "return { label: '指标打卡', hint: '按血压、血糖、血氧等指标归类' };");
requireText('apps/web/src/components/PatientEngagementTab.tsx', 'QuestionnaireAnswersView');
forbidText('apps/web/src/components/PatientEngagementTab.tsx', 'JSON.stringify(data.answers, null, 2)');
requireText('apps/web/src/api/patient-engagement.ts', 'payload?: Record<string, unknown> | null;');

const controller = read('apps/api/src/patient-engagement/admin-patient-engagement.controller.ts');
const payloadSelectCount = (controller.match(/payload: true/g) || []).length;
if (payloadSelectCount < 2) throw new Error(`admin-patient-engagement.controller.ts: expected >= 2 payload selects, got ${payloadSelectCount}`);

requireText('apps/web/src/patient-engagement-admin-tab.css', 'grouped-clinical-lists-v6');
requireText('apps/web/src/patient-engagement-admin-tab.css', '.pe-clinical-group-list');
requireText('apps/web/src/patient-engagement-admin-tab.css', '.pe-admin-actions-cell button.pe-admin-primary');
requireText('apps/web/src/App.tsx', "hint: '未完成提醒 / 已升级跟进'");

console.log('[ok] grouped-clinical-lists-v6 static assertions passed');
