#!/usr/bin/env node
/*
 * Gateway pipeline smoke test for gateway-promote-pipeline.
 *
 * Run while the API server is already running:
 *   npm run smoke:gateway
 *
 * 这个脚本模拟「医院真实试点」最核心的一条链路：
 *
 *   1. HIS / LIS 通过 POST /gateway/his/events/lab-result 推一条异常检验
 *   2. 网关写入 IntegrationSyncRecord (audit 层) 且 promotionStatus=PENDING
 *   3. 管理员调用 POST /gateway/promote/:recordId 把审计层数据 promote
 *   4. Promote 流程会：
 *        a) 找到本地 Patient (按 hospitalPatientId)
 *        b) 通过 VitalRecordsService.create 写 VitalRecord
 *        c) 触发规则引擎，自动生成 RiskAlert + Task
 *   5. 该患者的 vital-records / risk-alerts / tasks 端点立刻可见这条新数据
 *
 * 这是上线评审最关键的一条 acceptance path，任何 patch 之后都该跑一次。
 */

const baseUrl = (process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const gatewayApiKey = process.env.GATEWAY_API_KEY || 'dev_gateway_key_change_in_prod';

if (typeof fetch !== 'function') {
  console.error('Node.js 18+ is required because this smoke test uses global fetch.');
  process.exit(1);
}

const results = [];
function ok(label, detail = '') {
  results.push({ ok: true, label, detail });
  console.log(`✅ ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label, detail = '') {
  results.push({ ok: false, label, detail });
  console.error(`❌ ${label}${detail ? ` — ${detail}` : ''}`);
}

async function request(label, method, path, options = {}) {
  const expected = options.expectedStatuses || [200, 201];
  const headers = { ...(options.headers || {}) };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  let text = '';
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    text = await response.text();
  } catch (error) {
    throw new Error(`${label} could not connect to ${baseUrl}: ${error.message || error}`);
  }

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!expected.includes(response.status)) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`${label} returned HTTP ${response.status}: ${message}`);
  }

  return data;
}

async function login(username, password) {
  const data = await request(`Login ${username}`, 'POST', '/auth/login', {
    body: { username, password },
  });
  if (!data?.accessToken) {
    throw new Error(`Login ${username} did not return accessToken`);
  }
  ok(`Login ${username}`, data.user?.role || 'role missing');
  return data.accessToken;
}

async function main() {
  console.log(`\nRunning gateway-promote smoke test against ${baseUrl}`);
  console.log('================================');

  const adminToken = await login('admin', 'admin123');

  // 选择 seed 里已有的 demo 患者作为接收上游事件的目标，避免新建 Patient 把演示数据搞乱
  const hospitalPatientId = process.env.SMOKE_HOSPITAL_PATIENT_ID || 'MZ20260519001';
  const patients = await request('GET /patients', 'GET', '/patients', { token: adminToken });
  const target = Array.isArray(patients)
    ? patients.find((p) => p.hospitalPatientId === hospitalPatientId)
    : null;
  if (!target) {
    throw new Error(`Demo patient ${hospitalPatientId} not found. Run "node prisma/seed-all.js" first.`);
  }
  ok('Demo patient resolved', `${target.name} / ${hospitalPatientId}`);

  // ----------------------------------------------------------------------
  // 1. 推一条异常 LIS 检验结果到网关
  // ----------------------------------------------------------------------
  const eventId = `smoke-lis-${Date.now()}`;
  const labBody = {
    eventId,
    patient: { hospitalPatientId },
    itemCode: 'SBP',
    itemName: '收缩压（外部 LIS）',
    value: 196,
    unit: 'mmHg',
    abnormalFlag: 'H',
    reportedAt: new Date().toISOString(),
  };
  const ingest = await request(
    'POST /gateway/his/events/lab-result',
    'POST',
    '/gateway/his/events/lab-result',
    {
      body: labBody,
      headers: { 'X-Gateway-Api-Key': gatewayApiKey },
      expectedStatuses: [200, 201],
    },
  );
  if (!ingest?.recordId) {
    throw new Error(`Gateway ingest did not return recordId: ${JSON.stringify(ingest)}`);
  }
  ok('Gateway ingest', `record=${ingest.recordId} status=${ingest.status}`);

  // ----------------------------------------------------------------------
  // 2. 在 PENDING 队列里能看到这条事件
  // ----------------------------------------------------------------------
  const queue = await request(
    'GET /gateway/promote/queue?status=PENDING',
    'GET',
    '/gateway/promote/queue?status=PENDING&limit=200',
    { token: adminToken },
  );
  const inQueue = Array.isArray(queue?.items) && queue.items.some((r) => r.id === ingest.recordId);
  if (!inQueue) {
    throw new Error('Newly ingested record is not visible in PENDING queue.');
  }
  ok('PENDING queue contains the record', `${queue.items.length} total in queue`);

  // ----------------------------------------------------------------------
  // 3. promote 这条事件
  // ----------------------------------------------------------------------
  const promote = await request(
    `POST /gateway/promote/${ingest.recordId}`,
    'POST',
    `/gateway/promote/${ingest.recordId}`,
    { token: adminToken, body: {}, expectedStatuses: [200, 201] },
  );
  if (promote?.outcome !== 'PROMOTED') {
    throw new Error(`Promote outcome was ${promote?.outcome}, expected PROMOTED. message=${promote?.message}`);
  }
  if (promote.localTargetType !== 'VitalRecord' || !promote.localTargetId) {
    throw new Error(`Promote did not produce a VitalRecord: ${JSON.stringify(promote)}`);
  }
  ok('Promote outcome', `VitalRecord=${promote.localTargetId}`);

  if (!promote.generatedRiskAlertId || !promote.generatedTaskId) {
    throw new Error(
      `Promote did not trigger RiskAlert/Task even though value=${labBody.value} mmHg is extreme. ` +
      `Did the clinical-rules seed run? promote=${JSON.stringify(promote)}`,
    );
  }
  ok('Rule engine produced alert + task', `alert=${promote.generatedRiskAlertId} task=${promote.generatedTaskId}`);

  // ----------------------------------------------------------------------
  // 4. 患者端点能看到这条 VitalRecord / RiskAlert / Task
  // ----------------------------------------------------------------------
  const vitals = await request(
    'GET /patients/:id/vital-records',
    'GET',
    `/patients/${target.id}/vital-records`,
    { token: adminToken },
  );
  if (!Array.isArray(vitals) || !vitals.some((v) => v.id === promote.localTargetId)) {
    throw new Error('Promoted VitalRecord is not visible on patient detail endpoint.');
  }
  ok('VitalRecord visible on patient detail');

  const alerts = await request(
    'GET /patients/:id/risk-alerts',
    'GET',
    `/patients/${target.id}/risk-alerts`,
    { token: adminToken },
  );
  if (!Array.isArray(alerts) || !alerts.some((a) => a.id === promote.generatedRiskAlertId)) {
    throw new Error('Generated RiskAlert is not visible on patient detail endpoint.');
  }
  ok('RiskAlert visible on patient detail');

  const tasks = await request(
    'GET /patients/:id/tasks',
    'GET',
    `/patients/${target.id}/tasks`,
    { token: adminToken },
  );
  if (!Array.isArray(tasks) || !tasks.some((t) => t.id === promote.generatedTaskId)) {
    throw new Error('Generated Task is not visible on patient task list.');
  }
  ok('Task visible on patient task list');

  // ----------------------------------------------------------------------
  // 5. 幂等：再 promote 一次应返回 ALREADY_PROMOTED
  // ----------------------------------------------------------------------
  const repromote = await request(
    `POST /gateway/promote/${ingest.recordId} (idempotent)`,
    'POST',
    `/gateway/promote/${ingest.recordId}`,
    { token: adminToken, body: {}, expectedStatuses: [200, 201] },
  );
  if (repromote?.outcome !== 'ALREADY_PROMOTED') {
    throw new Error(`Repromote outcome was ${repromote?.outcome}, expected ALREADY_PROMOTED.`);
  }
  ok('Re-promote is idempotent', 'returns ALREADY_PROMOTED');

  // ----------------------------------------------------------------------
  // 6. 冲突路径：同一个院内号 + 不同姓名/身份证的 PATIENT 事件，应进入 CONFLICT
  // ----------------------------------------------------------------------
  const conflictPatientEventId = `smoke-patient-conflict-${Date.now()}`;
  const conflictBody = {
    eventId: conflictPatientEventId,
    patient: {
      hospitalPatientId,
      idCardNo: '999999199912319999', // 与 demo 不同
    },
    name: '冲突测试假名',
  };
  const conflictIngest = await request(
    'POST /gateway/his/events/patient-updated (conflict)',
    'POST',
    '/gateway/his/events/patient-updated',
    {
      body: conflictBody,
      headers: { 'X-Gateway-Api-Key': gatewayApiKey },
      expectedStatuses: [200, 201],
    },
  );
  const conflictPromote = await request(
    `POST /gateway/promote/${conflictIngest.recordId}`,
    'POST',
    `/gateway/promote/${conflictIngest.recordId}`,
    { token: adminToken, body: {}, expectedStatuses: [200, 201] },
  );
  if (conflictPromote?.outcome !== 'CONFLICT') {
    throw new Error(`Conflict promote outcome was ${conflictPromote?.outcome}, expected CONFLICT.`);
  }
  ok('Conflict path lands in CONFLICT queue', conflictPromote.message || '');

  console.log('================================');
  if (results.some((r) => !r.ok)) process.exit(1);
  console.log('✅ Gateway smoke test passed.');
}

main().catch((error) => {
  fail('Gateway smoke test failed', error.message || String(error));
  console.log('\nHints:');
  console.log('- Make sure the API server is running: npm run start:dev');
  console.log('- Initialize the demo database first: npm run demo:init');
  console.log('- Set GATEWAY_API_KEY in apps/api/.env (default: dev_gateway_key_change_in_prod)');
  console.log('- Check API_BASE_URL if your API is not on http://localhost:3000');
  process.exit(1);
});
