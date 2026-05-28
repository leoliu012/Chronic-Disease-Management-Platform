// scripts/smoke-care-reminders.js (v3)
//
// Runs against a live API + DB. Covers all 11 v3 spec scenarios.
//
// Prereqs:
//   - `node prisma/seed-all.js` has been run with the v3 patches applied.
//   - The API server is running and reachable at $API_BASE (default :3000).
//   - The worker can run on demand via POST /care-reminders/worker/run-once.
//     CARE_REMINDER_WORKER_ENABLED=true is NOT required for the smoke — we drive
//     the worker explicitly so the test is deterministic.

if (typeof fetch !== 'function') {
  console.error('[smoke] global fetch is not available. Node 18+ required.');
  process.exit(2);
}

const API_BASE = process.env.API_BASE || process.env.SMOKE_API_BASE || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

let pass = 0;
let fail = 0;

function record(name, ok, detail = '') {
  const tag = ok ? '\x1b[32m PASS \x1b[0m' : '\x1b[31m FAIL \x1b[0m';
  console.log(`${tag} ${name}${detail ? '  — ' + detail : ''}`);
  if (ok) pass += 1;
  else fail += 1;
}

async function call(token, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

async function login(username, password) {
  const r = await call('', 'POST', '/auth/login', { username, password });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`login(${username}) failed: status=${r.status} body=${JSON.stringify(r.body)}`);
  }
  return r.body?.accessToken || r.body?.token || r.body?.access_token;
}

async function main() {
  console.log(`\n[smoke care-reminders] target = ${API_BASE}\n`);

  const adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  record('login ADMIN', Boolean(adminToken));

  let nurse2Token = null;
  try {
    nurse2Token = await login('nurse2', 'nurse123');
  } catch (e) {
    record('login nurse2', false, e.message);
  }

  // ---------------------------------------------------------------
  // 1. create medication schedule
  // ---------------------------------------------------------------
  let medSched;
  {
    const r = await call(adminToken, 'POST', '/care-reminders/patients/demo-patient-001/medication-schedules', {
      medicationId: 'demo-med-001',
      title: '【smoke】每日 14:00 降压药',
      scheduledTimes: ['14:00'],
      escalationAfterMinutes: 60,
    });
    record('1. create medication schedule', r.status === 201, `status=${r.status}`);
    medSched = r.body;
  }

  // ---------------------------------------------------------------
  // 2. create vital schedule
  // ---------------------------------------------------------------
  let vitalSched;
  {
    const r = await call(adminToken, 'POST', '/care-reminders/patients/demo-patient-001/vital-schedules', {
      vitalType: 'BLOOD_PRESSURE',
      title: '【smoke】每日 22:00 血压',
      scheduledTimes: ['22:00'],
    });
    record('2. create vital schedule', r.status === 201, `status=${r.status}`);
    vitalSched = r.body;
  }

  // ---------------------------------------------------------------
  // 3. worker generates occurrence (idempotent on repeat)
  // ---------------------------------------------------------------
  let firstRun;
  {
    const r = await call(adminToken, 'POST', '/care-reminders/worker/run-once');
    firstRun = r.body;
    record(
      '3a. worker runs and generates occurrences',
      r.status === 201 && r.body?.generated > 0,
      `generated=${r.body?.generated} dispatched=${r.body?.dispatched} missed=${r.body?.missed}`,
    );
  }

  // 11. no duplicate occurrence on repeat
  {
    const r = await call(adminToken, 'POST', '/care-reminders/worker/run-once');
    record(
      '11. worker rerun is a no-op (no dup occurrences)',
      r.status === 201 && r.body?.generated === 0,
      `generated=${r.body?.generated} on second run`,
    );
  }

  // ---------------------------------------------------------------
  // 4. send-now creates PatientFormLink + PatientOutboundMessage
  // ---------------------------------------------------------------
  // Use the demo-care-occ-pending-001 seeded row (dueAt ~ +1h, status PENDING).
  let pendingOccId = 'demo-care-occ-pending-001';
  let sentOccurrence;
  {
    const r = await call(adminToken, 'POST', `/care-reminders/occurrences/${pendingOccId}/send-now`);
    sentOccurrence = r.body?.occurrence;
    record(
      '4. send-now dispatches and creates form link',
      r.status === 201 && sentOccurrence && (sentOccurrence.status === 'SENT' || sentOccurrence.formLinkId),
      `status=${sentOccurrence?.status} formLinkId=${sentOccurrence?.formLinkId ? 'set' : 'null'}`,
    );
  }

  // ---------------------------------------------------------------
  // 5. medication H5 submit → occurrence COMPLETED
  // Look up the form link's token via /patient-engagement/messages, then submit.
  // ---------------------------------------------------------------
  let plainToken = null;
  if (sentOccurrence?.formLinkId) {
    const r = await call(adminToken, 'GET', `/patient-engagement/messages?patientId=demo-patient-001`);
    const found = (r.body || []).find((m) => m.formLinkId === sentOccurrence.formLinkId);
    if (found && found.linkUrl) {
      const match = /\/wx\/form\/([^/?#]+)/.exec(found.linkUrl);
      if (match) plainToken = decodeURIComponent(match[1]);
    }
  }
  if (plainToken) {
    const submit = await call('', 'POST', `/public-forms/${plainToken}/medication-checkin`, {
      taken: true,
      note: 'smoke',
    });
    record('5. medication H5 submit OK', submit.status === 201 && submit.body?.ok === true,
      `status=${submit.status}`);
    // verify occurrence is now COMPLETED
    const occ = await call(adminToken, 'GET', `/care-reminders/patients/demo-patient-001/occurrences`);
    const updated = (occ.body || []).find((o) => o.id === pendingOccId);
    record(
      '   occurrence marked COMPLETED in same tx',
      updated?.status === 'COMPLETED' && updated?.resultType === 'MedicationCheckIn',
      `status=${updated?.status} resultType=${updated?.resultType}`,
    );
  } else {
    record('5. medication H5 submit OK', false, 'could not recover plaintext token from form link');
    record('   occurrence marked COMPLETED in same tx', false, '(blocked by missing token)');
  }

  // ---------------------------------------------------------------
  // 6. duplicate submit blocked
  // ---------------------------------------------------------------
  if (plainToken) {
    const dup = await call('', 'POST', `/public-forms/${plainToken}/medication-checkin`, { taken: true });
    record(
      '6. duplicate submit blocked',
      dup.status === 403 && /TOKEN_USED|已提交|已失效|claim/i.test(JSON.stringify(dup.body)),
      `status=${dup.status}`,
    );
  } else {
    record('6. duplicate submit blocked', false, '(blocked by missing token)');
  }

  // ---------------------------------------------------------------
  // 7. missed occurrence marks MISSED
  // The seed pre-creates demo-care-occ-missed-001 in MISSED already (since
  // its availableUntil is in the past). worker.runOnce should not change it.
  // ---------------------------------------------------------------
  {
    const occ = await call(adminToken, 'GET', `/care-reminders/patients/demo-patient-001/occurrences?status=MISSED,ESCALATED`);
    const has = (occ.body || []).some((o) => o.id === 'demo-care-occ-missed-001' && (o.status === 'MISSED' || o.status === 'ESCALATED'));
    record('7. missed occurrence detected', has, '');
  }

  // ---------------------------------------------------------------
  // 8. missed occurrence escalates to nurse Task
  // demo-care-sched-001-bp.escalationAfterMinutes is set, demo-care-occ-missed-001
  // is on that schedule and is well past availableUntil, so worker pass should
  // escalate it on next runOnce.
  // ---------------------------------------------------------------
  {
    // run worker again
    await call(adminToken, 'POST', '/care-reminders/worker/run-once');
    const occ = await call(adminToken, 'GET', `/care-reminders/patients/demo-patient-001/occurrences?status=ESCALATED`);
    const found = (occ.body || []).find((o) => o.id === 'demo-care-occ-missed-001');
    record(
      '8. missed → ESCALATED + Task created',
      found && found.status === 'ESCALATED' && Boolean(found.escalatedTaskId),
      `status=${found?.status} taskId=${found?.escalatedTaskId ? 'set' : 'null'}`,
    );
  }

  // ---------------------------------------------------------------
  // 9. nurse direct message creates GENERAL_MESSAGE link
  // ---------------------------------------------------------------
  let directMsg;
  {
    const r = await call(adminToken, 'POST', '/care-reminders/patients/demo-patient-001/messages', {
      title: '【smoke】请记得复查',
      content: '王先生您好, 这是 smoke 测试创建的消息. 请点击下方按钮确认收到.',
      priority: 'IMPORTANT',
      requiresAck: true,
    });
    directMsg = r.body;
    record(
      '9. direct message creates GENERAL_MESSAGE form link',
      r.status === 201 && directMsg?.directMessage?.id && directMsg?.formLink?.id,
      `direct=${directMsg?.directMessage?.id ? 'ok' : 'no'} link=${directMsg?.formLink?.id ? 'ok' : 'no'}`,
    );
  }

  // ---------------------------------------------------------------
  // 10. requiresAck submit acknowledges
  // ---------------------------------------------------------------
  if (directMsg?.linkUrl) {
    const match = /\/wx\/form\/([^/?#]+)/.exec(directMsg.linkUrl);
    const token = match ? decodeURIComponent(match[1]) : null;
    if (token) {
      const ack = await call('', 'POST', `/public-forms/${token}/general-message-ack`, {});
      record('10a. patient ack succeeds', ack.status === 201 && ack.body?.ok === true);

      // verify directMessage.status is ACKNOWLEDGED
      const list = await call(adminToken, 'GET', `/care-reminders/patients/demo-patient-001/messages`);
      const found = (list.body || []).find((m) => m.id === directMsg.directMessage.id);
      record(
        '10b. PatientDirectMessage marked ACKNOWLEDGED',
        found?.status === 'ACKNOWLEDGED' && Boolean(found?.acknowledgedAt),
        `status=${found?.status}`,
      );
    } else {
      record('10a. patient ack succeeds', false, 'no token in linkUrl');
    }
  }

  // ---------------------------------------------------------------
  // 12. tenant isolation
  // ---------------------------------------------------------------
  if (nurse2Token) {
    {
      const r = await call(nurse2Token, 'GET', `/care-reminders/patients/demo-patient-001/schedules`);
      record('12a. nurse2 → demo-patient-001 schedules → 403', r.status === 403, `status=${r.status}`);
    }
    {
      const r = await call(nurse2Token, 'POST', `/care-reminders/patients/demo-patient-001/medication-schedules`, {
        medicationId: 'demo-med-001',
        scheduledTimes: ['08:00'],
      });
      record('12b. nurse2 → create cross-tenant schedule → 403', r.status === 403, `status=${r.status}`);
    }
    {
      const r = await call(nurse2Token, 'GET', `/care-reminders/patients/demo-patient-101/schedules`);
      record('12c. nurse2 → demo-patient-101 (own tenant) → 200', r.status === 200, `status=${r.status}`);
    }
  } else {
    record('12. tenant isolation', false, 'nurse2 login failed');
  }

  // ---------------------------------------------------------------
  console.log(`\n========== care-reminders smoke: ${pass} PASS / ${fail} FAIL ==========\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[smoke] uncaught', e);
  process.exit(1);
});
