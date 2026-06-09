#!/usr/bin/env node
/*
 * HTTP + DB smoke for clinical disposition v5.
 * Start API first: npm run start:dev
 * Run from apps/api: node prisma/smoke-clinical-disposition-v5.js
 */
const crypto = require('crypto');
const { PrismaClient, TaskStatus } = require('@prisma/client');
const prisma = new PrismaClient();
const BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const suffix = crypto.randomBytes(4).toString('hex');
const patientId = `disp-smoke-${suffix}`;
let pass = 0;

function ok(condition, message, detail = '') {
  if (!condition) throw new Error(`${message}${detail ? ` — ${detail}` : ''}`);
  pass += 1;
  console.log(` PASS  ${message}${detail ? ` — ${detail}` : ''}`);
}

async function request(method, route, token, body) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: response.status, data };
}

async function login() {
  const result = await request('POST', '/auth/login', null, { username: 'admin', password: 'admin123' });
  ok([200, 201].includes(result.status), 'login ADMIN', `status=${result.status}`);
  ok(Boolean(result.data?.accessToken), 'login returns access token');
  return result.data.accessToken;
}

async function cleanup() {
  // Break episode/task circular references before removing temporary smoke data.
  await prisma.task.updateMany({ where: { patientId }, data: { openRiskEpisodeKey: null, riskEpisodeId: null } });
  await prisma.riskEpisode.updateMany({ where: { patientId }, data: { openTaskId: null } });
  await prisma.riskAlert.updateMany({ where: { patientId }, data: { riskEpisodeId: null } });
  await prisma.taskProcessingEvent.deleteMany({ where: { patientId } });
  await prisma.hospitalVisitFeedback.deleteMany({ where: { patientId } });
  await prisma.hospitalVisitReminder.deleteMany({ where: { patientId } });
  await prisma.careReminderOccurrence.deleteMany({ where: { patientId } });
  await prisma.careReminderSchedule.deleteMany({ where: { patientId } });
  await prisma.patientOutboundAttempt.deleteMany({ where: { patientId } });
  await prisma.patientOutboundMessage.deleteMany({ where: { patientId } });
  await prisma.patientFormLink.deleteMany({ where: { patientId } });
  await prisma.medicationCheckIn.deleteMany({ where: { patientId } });
  await prisma.medicationRecord.deleteMany({ where: { patientId } });
  await prisma.questionnaireResult.deleteMany({ where: { patientId } });
  await prisma.vitalRecord.deleteMany({ where: { patientId } });
  await prisma.followUpRecord.deleteMany({ where: { patientId } });
  await prisma.riskAlert.deleteMany({ where: { patientId } });
  await prisma.task.deleteMany({ where: { patientId } });
  await prisma.riskEpisode.deleteMany({ where: { patientId } });
  await prisma.diseaseProfile.deleteMany({ where: { patientId } });
  await prisma.patient.deleteMany({ where: { id: patientId } });
}

async function postVital(token, value) {
  return request('POST', `/patients/${patientId}/vital-records`, token, {
    type: 'SYSTOLIC_BP', value, unit: 'mmHg', measuredAt: new Date().toISOString(), dataSource: 'NURSE_INPUT',
  });
}

async function main() {
  console.log(`\n[smoke clinical-disposition v5] target=${BASE}\n`);
  await cleanup();
  try {
    const token = await login();
    const tenant = await prisma.hospitalTenant.findUnique({ where: { id: 'demo-tenant-001' } });
    ok(Boolean(tenant), 'demo tenant exists');
    const nurse = await prisma.user.findFirst({ where: { username: 'nurse' } });
    ok(Boolean(nurse), 'demo nurse exists');
    await prisma.patient.create({
      data: { id: patientId, name: `处置主链路 smoke ${suffix}`, hospitalTenantId: tenant.id, responsibleNurseId: nurse.id },
    });

    const high1 = await postVital(token, 165);
    ok(high1.status === 201, 'first HIGH BP signal accepted', `status=${high1.status}`);
    const firstTaskId = high1.data?.generatedTask?.id;
    const firstEpisodeId = high1.data?.generatedTask?.riskEpisodeId;
    ok(Boolean(firstTaskId && firstEpisodeId), 'first signal creates episode-backed task');

    const high2 = await postVital(token, 170);
    ok(high2.status === 201, 'repeated HIGH BP signal accepted', `status=${high2.status}`);
    ok(high2.data?.generatedTask?.id === firstTaskId, 'repeated HIGH signal reuses the same open task');

    const veryHigh = await postVital(token, 185);
    ok(veryHigh.status === 201, 'VERY_HIGH BP signal accepted', `status=${veryHigh.status}`);
    ok(veryHigh.data?.generatedTask?.id === firstTaskId, 'severity escalation keeps the original task');

    const episode = await prisma.riskEpisode.findUnique({ where: { id: firstEpisodeId } });
    const episodeTasks = await prisma.task.findMany({ where: { riskEpisodeId: firstEpisodeId, status: { in: ['PENDING', 'IN_PROGRESS'] } } });
    const episodeAlerts = await prisma.riskAlert.findMany({ where: { riskEpisodeId: firstEpisodeId } });
    ok(episode?.triggerCount === 3, 'episode accumulates repeated evidence', `triggerCount=${episode?.triggerCount}`);
    ok(episode?.peakRiskLevel === 'VERY_HIGH', 'episode peak risk escalates to VERY_HIGH', `peak=${episode?.peakRiskLevel}`);
    ok(episodeTasks.length === 1, 'episode has exactly one open disposition task', `openTasks=${episodeTasks.length}`);
    ok(episodeTasks[0].priority === 0, 'existing task priority escalates to urgent', `priority=${episodeTasks[0].priority}`);
    ok(episodeAlerts.length === 3, 'each signal remains traceable as evidence alert', `alerts=${episodeAlerts.length}`);

    const manual = await request('POST', `/patients/${patientId}/risk-alerts`, token, {
      riskType: 'MANUAL_SMOKE', riskLevel: 'HIGH', title: '人工风险信号 smoke', triggerRule: `manual-${suffix}`,
    });
    ok(manual.status === 201, 'manual signal accepted without auto task', `status=${manual.status}`);
    const manualAlertId = manual.data?.id;

    let items = await request('GET', `/patients/${patientId}/work-items`, token);
    ok(items.status === 200, 'work-items projection loads', `status=${items.status}`);
    ok(items.data?.items?.filter((item) => item.episodeId === firstEpisodeId).length === 1, 'risk episode appears exactly once in workbench');
    ok(items.data?.items?.some((item) => item.itemType === 'RISK_ALERT_ONLY' && item.alertId === manualAlertId), 'open alert without task appears as RISK_ALERT_ONLY');

    const createManualTask = await request('POST', `/patients/${patientId}/tasks`, token, {
      title: '人工风险信号处置', type: 'RISK_ALERT_FOLLOW_UP', relatedAlertId: manualAlertId,
    });
    ok(createManualTask.status === 201, 'creating task from alert-only projection succeeds', `status=${createManualTask.status}`);
    const manualTaskId = createManualTask.data?.id;
    items = await request('GET', `/patients/${patientId}/work-items`, token);
    ok(!items.data?.items?.some((item) => item.itemType === 'RISK_ALERT_ONLY' && item.alertId === manualAlertId), 'alert-only row disappears after task creation');
    ok(items.data?.items?.some((item) => item.taskId === manualTaskId), 'created disposition task replaces alert-only row');

    const closeManual = await request('PATCH', `/tasks/${manualTaskId}/status`, token, {
      status: 'DONE', relatedAlertHandlingNote: 'smoke：人工风险已完成电话核实并记录最终处置。',
    });
    ok(closeManual.status === 200, 'closing risk task succeeds with disposition result', `status=${closeManual.status}`);
    const manualClosedAlert = await prisma.riskAlert.findUnique({ where: { id: manualAlertId } });
    ok(manualClosedAlert?.status === 'RESOLVED', 'closing task synchronizes related alert');

    const closeBp = await request('PATCH', `/tasks/${firstTaskId}/status`, token, {
      status: 'DONE', relatedAlertHandlingNote: 'smoke：连续异常血压已完成复核，已安排复测和就医指导。',
    });
    ok(closeBp.status === 200, 'closing episode main task succeeds', `status=${closeBp.status}`);
    const closedEpisode = await prisma.riskEpisode.findUnique({ where: { id: firstEpisodeId } });
    const remainingOpenTasks = await prisma.task.count({ where: { riskEpisodeId: firstEpisodeId, status: { in: ['PENDING', 'IN_PROGRESS'] } } });
    const remainingOpenAlerts = await prisma.riskAlert.count({ where: { riskEpisodeId: firstEpisodeId, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
    ok(closedEpisode?.status === 'RESOLVED' && closedEpisode.openTaskId == null && closedEpisode.openKey == null, 'episode closes and releases open keys');
    ok(remainingOpenTasks === 0 && remainingOpenAlerts === 0, 'episode closure closes tasks and alerts together');

    const timeline = await request('GET', `/patients/${patientId}/timeline`, token);
    ok(timeline.status === 200, 'patient timeline loads', `status=${timeline.status}`);
    const types = new Set((timeline.data?.timeline || []).map((item) => item.type));
    ok(types.has('RISK_EPISODE') && types.has('RISK_ALERT') && types.has('TASK'), 'timeline traces episode, alert, and task');

    console.log(`\n========== clinical-disposition v5 smoke: ${pass} PASS / 0 FAIL ==========`);
  } finally {
    await cleanup();
  }
}

main()
  .catch((error) => { console.error('\n FAIL ', error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
