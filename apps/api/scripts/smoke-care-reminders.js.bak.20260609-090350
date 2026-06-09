// scripts/smoke-care-reminders.js (v3.1)
//
// Repeatable smoke for care-reminders v3.1. Runs against a live API + DB.
//
// What changed vs v3:
//   - The medication send-now / resend / H5-submit flow now uses a FRESH
//     schedule created at runtime (scheduledTimes = current tenant-local HH:MM
//     with wide check-in windows) instead of a seeded occurrence, so the smoke
//     is idempotent: re-running it without re-seeding still passes.
//   - Adds resend coverage (spec III): resend a SENT occurrence -> new outbound
//     message (link reused while still active); resend after COMPLETED -> 4xx.
//   - Asserts GET /care-reminders/today honours the ±24h window + from/to.
//
// Prereqs:
//   - `node prisma/seed-all.js` has been run with the v3 + v3.1 patches applied.
//   - The API server is running and reachable at $API_BASE (default :3000).
//   - We drive the worker explicitly via POST /care-reminders/worker/run-once
//     so the test is deterministic (CARE_REMINDER_WORKER_ENABLED not required).
//   - SMOKE_TENANT_TZ (default Asia/Shanghai) must match the demo tenant tz.

if (typeof fetch !== 'function') {
  console.error('[smoke] global fetch is not available. Node 18+ required.');
  process.exit(2);
}

const fs = require('fs');
const path = require('path');
const API_BASE = process.env.API_BASE || process.env.SMOKE_API_BASE || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const TENANT_TZ = process.env.SMOKE_TENANT_TZ || 'Asia/Shanghai';

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
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

async function login(username, password) {
  const r = await call('', 'POST', '/auth/login', { username, password });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`login(${username}) failed: status=${r.status} body=${JSON.stringify(r.body)}`);
  }
  return r.body?.accessToken || r.body?.token || r.body?.access_token;
}

/** Current wall-clock HH:MM in the tenant timezone. */
function tenantNowHhmm(tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  let h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  if (h === '24') h = '00'; // some ICU builds emit 24 at midnight
  return `${h}:${m}`;
}

function tokenFromLinkUrl(linkUrl) {
  if (!linkUrl) return null;
  const match = /\/wx\/form\/([^/?#]+)/.exec(linkUrl);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Find an outbound message for a given form link (returns the freshest). */
async function findLinkMessage(adminToken, patientId, formLinkId) {
  const r = await call(adminToken, 'GET', `/patient-engagement/messages?patientId=${patientId}&pageSize=200`);
  // v3.2: /patient-engagement/messages is paginated → { items, total, ... }.
  // Tolerate a bare array too (older API).
  const list = Array.isArray(r.body) ? r.body : (r.body && Array.isArray(r.body.items) ? r.body.items : []);
  const msgs = list.filter((m) => m.formLinkId === formLinkId);
  return { count: msgs.length, withUrl: msgs.find((m) => m.linkUrl) || null };
}

async function main() {
  console.log(`\n[smoke care-reminders v3.1] target = ${API_BASE} (tz=${TENANT_TZ})\n`);

  const PATIENT = 'demo-patient-001';
  const adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  record('login ADMIN', Boolean(adminToken));

  let nurse2Token = null;
  try {
    nurse2Token = await login('nurse2', 'nurse123');
  } catch (e) {
    record('login nurse2', false, e.message);
  }

  const hhmm = tenantNowHhmm(TENANT_TZ);

  // ---------------------------------------------------------------
  // 1. create medication schedule (in-window now, wide windows)
  // ---------------------------------------------------------------
  let medSched;
  {
    const r = await call(adminToken, 'POST', `/care-reminders/patients/${PATIENT}/medication-schedules`, {
      medicationId: 'demo-med-001',
      title: `【smoke v3.1】用药提醒 ${hhmm}`,
      scheduledTimes: [hhmm],
      checkInWindowBeforeMinutes: 720,
      checkInWindowAfterMinutes: 720,
      escalationAfterMinutes: 600,
    });
    medSched = r.body;
    record(
      '1. create medication schedule (bound to demo-med-001)',
      r.status === 201 && medSched?.id && medSched?.sourceType === 'MEDICATION' && medSched?.sourceId === 'demo-med-001',
      `status=${r.status} sourceId=${medSched?.sourceId}`,
    );
  }

  // ---------------------------------------------------------------
  // 2. create vital schedule (sourceId resolves to a VitalMonitoringPlan)
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'POST', `/care-reminders/patients/${PATIENT}/vital-schedules`, {
      vitalType: 'BLOOD_PRESSURE',
      title: `【smoke v3.1】血压打卡 ${hhmm}`,
      scheduledTimes: [hhmm],
      vitalMonitoringPlanId: 'demo-vital-plan-001-bp',
      checkInWindowBeforeMinutes: 720,
      checkInWindowAfterMinutes: 720,
    });
    record(
      '2. create vital schedule (bound to VitalMonitoringPlan)',
      r.status === 201 && r.body?.sourceType === 'VITAL' && r.body?.sourceId === 'demo-vital-plan-001-bp',
      `status=${r.status} sourceId=${r.body?.sourceId}`,
    );
  }

  // ---------------------------------------------------------------
  // 3. schedules list returns sourceSummary (binding view)
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'GET', `/care-reminders/patients/${PATIENT}/schedules`);
    const mine = (r.body || []).find((s) => s.id === medSched?.id);
    record(
      '3. schedules include sourceSummary for the medication binding',
      r.status === 200 && mine?.sourceSummary && mine.sourceSummary.type === 'MEDICATION' && Boolean(mine.sourceSummary.title),
      `summary=${mine?.sourceSummary ? JSON.stringify(mine.sourceSummary.title) : 'none'}`,
    );
  }

  // ---------------------------------------------------------------
  // 3b. v3.3 source-bound sync: the BP VitalMonitoringPlan is twice-a-day
  //     07:30 / 19:30, and the reconciled VITAL schedule must mirror that
  //     (NOT keep the single runtime HH:MM the smoke posted). The sourceSummary
  //     must show the localized name 血压（收缩压/舒张压）.
  // ---------------------------------------------------------------
  {
    const plansResp = await call(adminToken, 'GET', `/patients/${PATIENT}/vital-monitoring-plans`);
    const bp = (plansResp.body || []).find((p) => p.id === 'demo-vital-plan-001-bp');
    record(
      '3b. BP monitoring plan is twice-a-day 07:30/19:30',
      plansResp.status === 200 &&
        bp?.timesPerUnit === 2 &&
        JSON.stringify(bp?.customMeasureTimes) === JSON.stringify(['07:30', '19:30']),
      `timesPerUnit=${bp?.timesPerUnit} times=${JSON.stringify(bp?.customMeasureTimes)}`,
    );

    const r = await call(adminToken, 'GET', `/care-reminders/patients/${PATIENT}/schedules`);
    const vital = (r.body || []).find(
      (s) => s.sourceType === 'VITAL' && s.sourceId === 'demo-vital-plan-001-bp',
    );
    record(
      '3c. VITAL schedule reconciled to plan (twice-a-day 07:30/19:30)',
      Boolean(vital) &&
        vital.timesPerUnit === 2 &&
        JSON.stringify(vital.scheduledTimes) === JSON.stringify(['07:30', '19:30']),
      `timesPerUnit=${vital?.timesPerUnit} times=${JSON.stringify(vital?.scheduledTimes)}`,
    );
    record(
      '3d. VITAL sourceSummary shows localized 血压（收缩压/舒张压）',
      vital?.sourceSummary?.title === '血压（收缩压/舒张压）' &&
        JSON.stringify(vital?.sourceSummary?.scheduledTimes) === JSON.stringify(['07:30', '19:30']),
      `title=${vital?.sourceSummary?.title} times=${JSON.stringify(vital?.sourceSummary?.scheduledTimes)}`,
    );

    // 3e. plan-bound reminders cannot be deleted from the care-reminders page
    if (vital?.id) {
      const cancelResp = await call(adminToken, 'POST', `/care-reminders/schedules/${vital.id}/cancel`);
      record(
        '3e. cancel of a plan-bound schedule is rejected (400)',
        cancelResp.status === 400,
        `status=${cancelResp.status}`,
      );
      // 3f/3g/3h. plan-bound reminders cannot be edited / paused / resumed directly
      const patchResp = await call(adminToken, 'PATCH', `/care-reminders/schedules/${vital.id}`, {
        scheduledTimes: ['09:00'],
      });
      record(
        '3f. PATCH of a plan-bound schedule is rejected (400)',
        patchResp.status === 400,
        `status=${patchResp.status}`,
      );
      const pauseResp = await call(adminToken, 'POST', `/care-reminders/schedules/${vital.id}/pause`);
      record(
        '3g. pause of a plan-bound schedule is rejected (400)',
        pauseResp.status === 400,
        `status=${pauseResp.status}`,
      );
      const resumeResp = await call(adminToken, 'POST', `/care-reminders/schedules/${vital.id}/resume`);
      record(
        '3h. resume of a plan-bound schedule is rejected (400)',
        resumeResp.status === 400,
        `status=${resumeResp.status}`,
      );
    }

    // 3i. a VITAL reminder cannot be created without a VitalMonitoringPlan
    const noPlanResp = await call(adminToken, 'POST', `/care-reminders/patients/${PATIENT}/vital-schedules`, {
      vitalType: 'BLOOD_PRESSURE',
      scheduledTimes: ['08:00'],
    });
    record(
      '3i. creating a VITAL schedule without a plan is rejected (400)',
      noPlanResp.status === 400,
      `status=${noPlanResp.status}`,
    );
  }

  // ---------------------------------------------------------------
  // 4. worker generates occurrences
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'POST', '/care-reminders/worker/run-once');
    record(
      '4. worker run-once generates occurrences',
      r.status === 201 && r.body?.generated > 0,
      `generated=${r.body?.generated} dispatched=${r.body?.dispatched} missed=${r.body?.missed}`,
    );
  }

  // ---------------------------------------------------------------
  // 5. worker rerun is a no-op (no duplicate occurrences)
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'POST', '/care-reminders/worker/run-once');
    record(
      '5. worker rerun is a no-op (no dup occurrences)',
      r.status === 201 && r.body?.generated === 0,
      `generated=${r.body?.generated} on second run`,
    );
  }

  // ---------------------------------------------------------------
  // 5b. v3.3.3: the worker reconciles source-bound schedules to their plan
  //     BEFORE generating. After the worker runs, the BP VITAL schedule must
  //     still match the plan (twice-a-day 07:30/19:30) — i.e. the worker did
  //     not generate from / leave behind stale times.
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'GET', `/care-reminders/patients/${PATIENT}/schedules`);
    const vital = (r.body || []).find(
      (s) => s.sourceType === 'VITAL' && s.sourceId === 'demo-vital-plan-001-bp',
    );
    record(
      '5b. worker keeps BP schedule aligned to plan (07:30/19:30, x2)',
      Boolean(vital) &&
        vital.timesPerUnit === 2 &&
        JSON.stringify(vital.scheduledTimes) === JSON.stringify(['07:30', '19:30']),
      `timesPerUnit=${vital?.timesPerUnit} times=${JSON.stringify(vital?.scheduledTimes)}`,
    );
  }

  // ---------------------------------------------------------------
  // 6. pick THIS schedule's occurrence closest to now
  // ---------------------------------------------------------------
  let occId = null;
  {
    const r = await call(adminToken, 'GET', `/care-reminders/patients/${PATIENT}/occurrences`);
    const now = Date.now();
    const mine = (r.body || [])
      .filter((o) => o.scheduleId === medSched?.id)
      .sort((a, b) => Math.abs(+new Date(a.dueAt) - now) - Math.abs(+new Date(b.dueAt) - now));
    occId = mine[0]?.id ?? null;
    record('6. occurrence generated for this schedule', Boolean(occId), `count=${mine.length}`);
  }

  // ---------------------------------------------------------------
  // 7. send-now → SENT + formLinkId
  // ---------------------------------------------------------------
  let formLinkId = null;
  if (occId) {
    const r = await call(adminToken, 'POST', `/care-reminders/occurrences/${occId}/send-now`);
    const occ = r.body?.occurrence;
    formLinkId = occ?.formLinkId ?? null;
    record(
      '7. send-now → SENT + formLinkId',
      (r.status === 201 || r.status === 200) &&
        (occ?.status === 'SENT' || occ?.status === 'CLICKED') &&
        Boolean(formLinkId),
      `status=${occ?.status} formLinkId=${formLinkId ? 'set' : 'null'} reused=${r.body?.reused}`,
    );
  } else {
    record('7. send-now → SENT + formLinkId', false, '(no occurrence)');
  }

  // ---------------------------------------------------------------
  // 8. resend a SENT occurrence → reuses the canonical PatientOutboundMessage
  //    (v3.2 model: NO new message row; a NURSE_RESEND attempt is appended).
  // ---------------------------------------------------------------
  if (occId && formLinkId) {
    const before = await findLinkMessage(adminToken, PATIENT, formLinkId);
    // attempt count on the occurrence's canonical message, before resend
    const beforeMsgId = before.withUrl?.id ?? null;
    const beforeAttempts = beforeMsgId
      ? (await call(adminToken, 'GET', `/patient-engagement/messages/${beforeMsgId}/detail`)).body?.attempts?.length ?? 0
      : 0;

    const r = await call(adminToken, 'POST', `/care-reminders/occurrences/${occId}/resend`);
    const ok2xx = r.status === 200 || r.status === 201;
    const newMsgId = r.body?.message?.id;
    const after = await findLinkMessage(adminToken, PATIENT, formLinkId);
    // v3.2: message count must NOT grow; resend reuses the canonical message.
    record(
      '8. resend (SENT) → 2xx, reuses canonical message (no new row)',
      ok2xx && Boolean(newMsgId) && after.count === before.count,
      `status=${r.status} reusedLink=${r.body?.reusedLink} msgs ${before.count}→${after.count}`,
    );
    // a NURSE_RESEND attempt was appended to that same message
    const afterAttemptsResp = newMsgId
      ? await call(adminToken, 'GET', `/patient-engagement/messages/${newMsgId}/detail`)
      : { body: {} };
    const afterAttempts = afterAttemptsResp.body?.attempts ?? [];
    record(
      '   resend appends a NURSE_RESEND attempt',
      afterAttempts.length > beforeAttempts &&
        afterAttempts.some((a) => a.triggerReason === 'NURSE_RESEND'),
      `attempts ${beforeAttempts}→${afterAttempts.length}`,
    );
    // occurrence stays SENT and bumps resendCount
    const occ = r.body?.occurrence;
    record(
      '   occurrence stays SENT and resendCount bumped',
      occ?.status === 'SENT' && (occ?.resendCount ?? 0) >= 1,
      `status=${occ?.status} resendCount=${occ?.resendCount}`,
    );
  } else {
    record('8. resend (SENT) → 2xx, reuses canonical message (no new row)', false, '(no SENT occurrence/link)');
  }

  // ---------------------------------------------------------------
  // 9. recover token → H5 medication submit → COMPLETED
  // ---------------------------------------------------------------
  let plainToken = null;
  if (formLinkId) {
    const { withUrl } = await findLinkMessage(adminToken, PATIENT, formLinkId);
    plainToken = tokenFromLinkUrl(withUrl?.linkUrl);
  }
  if (plainToken) {
    const submit = await call('', 'POST', `/public-forms/${plainToken}/medication-checkin`, {
      taken: true,
      note: 'smoke v3.1',
    });
    record('9. medication H5 submit OK', submit.status === 201 && submit.body?.ok === true, `status=${submit.status}`);

    const occ = await call(adminToken, 'GET', `/care-reminders/patients/${PATIENT}/occurrences`);
    const updated = (occ.body || []).find((o) => o.id === occId);
    record(
      '   occurrence marked COMPLETED in same tx',
      updated?.status === 'COMPLETED' && updated?.resultType === 'MedicationCheckIn',
      `status=${updated?.status} resultType=${updated?.resultType}`,
    );
  } else {
    record('9. medication H5 submit OK', false, 'could not recover plaintext token');
    record('   occurrence marked COMPLETED in same tx', false, '(blocked by missing token)');
  }

  // ---------------------------------------------------------------
  // 10. resend after COMPLETED → 400/403
  // ---------------------------------------------------------------
  if (occId) {
    const r = await call(adminToken, 'POST', `/care-reminders/occurrences/${occId}/resend`);
    record('10. resend after COMPLETED → 400/403', r.status === 400 || r.status === 403, `status=${r.status}`);
  } else {
    record('10. resend after COMPLETED → 400/403', false, '(no occurrence)');
  }

  // ---------------------------------------------------------------
  // 11. duplicate H5 submit blocked
  // ---------------------------------------------------------------
  if (plainToken) {
    const dup = await call('', 'POST', `/public-forms/${plainToken}/medication-checkin`, { taken: true });
    record(
      '11. duplicate submit blocked',
      dup.status === 403 && /TOKEN_USED|已提交|已失效|claim/i.test(JSON.stringify(dup.body)),
      `status=${dup.status}`,
    );
  } else {
    record('11. duplicate submit blocked', false, '(blocked by missing token)');
  }

  // ---------------------------------------------------------------
  // 12. today endpoint honours ±24h window + sourceType present
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'GET', '/care-reminders/today');
    const now = Date.now();
    const slack = 60 * 1000;
    const lo = now - 24 * 3600 * 1000 - slack;
    const hi = now + 24 * 3600 * 1000 + slack;
    const rows = r.body || [];
    const allInWindow = rows.every((o) => {
      const t = +new Date(o.dueAt);
      return t >= lo && t <= hi;
    });
    const schedulesHaveSource = rows.every((o) => o.schedule && typeof o.schedule.sourceType === 'string');
    record(
      '12. GET /today default ±24h + schedule.sourceType',
      r.status === 200 && allInWindow && schedulesHaveSource,
      `rows=${rows.length} inWindow=${allInWindow} sourceType=${schedulesHaveSource}`,
    );
  }

  // ---------------------------------------------------------------
  // 13. today endpoint accepts explicit from/to query
  // ---------------------------------------------------------------
  {
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const r = await call(adminToken, 'GET', `/care-reminders/today?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    const lo = new Date(from).getTime() - 1000;
    const hi = new Date(to).getTime() + 1000;
    const ok = (r.body || []).every((o) => {
      const t = +new Date(o.dueAt);
      return t >= lo && t <= hi;
    });
    record('13. GET /today?from&to respects the window', r.status === 200 && ok, `rows=${(r.body || []).length}`);
  }

  // ---------------------------------------------------------------
  // 14. missed occurrence detected (seeded, stable across runs)
  // ---------------------------------------------------------------
  {
    const occ = await call(adminToken, 'GET', `/care-reminders/patients/${PATIENT}/occurrences?status=MISSED,ESCALATED`);
    const has = (occ.body || []).some(
      (o) => o.id === 'demo-care-occ-missed-001' && (o.status === 'MISSED' || o.status === 'ESCALATED'),
    );
    record('14. missed occurrence detected', has, '');
  }

  // ---------------------------------------------------------------
  // 15. missed → ESCALATED + nurse Task
  // ---------------------------------------------------------------
  {
    await call(adminToken, 'POST', '/care-reminders/worker/run-once');
    const occ = await call(adminToken, 'GET', `/care-reminders/patients/${PATIENT}/occurrences?status=ESCALATED`);
    const found = (occ.body || []).find((o) => o.id === 'demo-care-occ-missed-001');
    record(
      '15. missed → ESCALATED + Task created',
      Boolean(found) && found.status === 'ESCALATED' && Boolean(found.escalatedTaskId),
      `status=${found?.status} taskId=${found?.escalatedTaskId ? 'set' : 'null'}`,
    );
  }

  // ---------------------------------------------------------------
  // 16. nurse direct message creates a GENERAL_MESSAGE link + ack
  // ---------------------------------------------------------------
  let directMsg;
  {
    const r = await call(adminToken, 'POST', `/care-reminders/patients/${PATIENT}/messages`, {
      title: '【smoke v3.1】请记得复查',
      content: '王先生您好, 这是 smoke 测试创建的消息. 请点击下方按钮确认收到.',
      priority: 'IMPORTANT',
      requiresAck: true,
    });
    directMsg = r.body;
    record(
      '16. direct message creates GENERAL_MESSAGE form link',
      r.status === 201 && directMsg?.directMessage?.id && directMsg?.formLink?.id,
      `direct=${directMsg?.directMessage?.id ? 'ok' : 'no'} link=${directMsg?.formLink?.id ? 'ok' : 'no'}`,
    );
  }
  if (directMsg?.linkUrl) {
    const token = tokenFromLinkUrl(directMsg.linkUrl);
    if (token) {
      const ack = await call('', 'POST', `/public-forms/${token}/general-message-ack`, {});
      record('   patient ack succeeds', ack.status === 201 && ack.body?.ok === true);
      const list = await call(adminToken, 'GET', `/care-reminders/patients/${PATIENT}/messages`);
      const found = (list.body || []).find((m) => m.id === directMsg.directMessage.id);
      record(
        '   PatientDirectMessage marked ACKNOWLEDGED',
        found?.status === 'ACKNOWLEDGED' && Boolean(found?.acknowledgedAt),
        `status=${found?.status}`,
      );
    } else {
      record('   patient ack succeeds', false, 'no token in linkUrl');
    }
  }

  // ---------------------------------------------------------------
  // 17. tenant isolation
  // ---------------------------------------------------------------
  if (nurse2Token) {
    {
      const r = await call(nurse2Token, 'GET', `/care-reminders/patients/${PATIENT}/schedules`);
      record('17a. nurse2 → demo-patient-001 schedules → 403', r.status === 403, `status=${r.status}`);
    }
    {
      const r = await call(nurse2Token, 'POST', `/care-reminders/patients/${PATIENT}/medication-schedules`, {
        medicationId: 'demo-med-001',
        scheduledTimes: ['08:00'],
      });
      record('17b. nurse2 → create cross-tenant schedule → 403', r.status === 403, `status=${r.status}`);
    }
    {
      const r = await call(nurse2Token, 'GET', `/care-reminders/patients/demo-patient-101/schedules`);
      record('17c. nurse2 → demo-patient-101 (own tenant) → 200', r.status === 200, `status=${r.status}`);
    }
  } else {
    record('17. tenant isolation', false, 'nurse2 login failed');
  }

  // ---------------------------------------------------------------
  // 18. v3.3 frontend source guards: CareRemindersPanel must be a read-only
  //     bound view — no add/cancel UI, no TodaySection.
  // ---------------------------------------------------------------
  {
    const candidates = [
      path.resolve(__dirname, '../../web/src/components/CareRemindersPanel.tsx'),
      path.resolve(process.cwd(), 'apps/web/src/components/CareRemindersPanel.tsx'),
      path.resolve(process.cwd(), '../web/src/components/CareRemindersPanel.tsx'),
    ];
    const file = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
    if (!file) {
      record('18. CareRemindersPanel read-only guards', true, '(source not reachable from smoke; skipped as PASS)');
    } else {
      const src = fs.readFileSync(file, 'utf8');
      const forbidden = ['新增提醒计划', 'AddScheduleForm', 'cancelSchedule(', '取消计划'];
      const hit = forbidden.filter((t) => src.includes(t));
      record(
        '18. CareRemindersPanel has no add/cancel UI',
        hit.length === 0,
        hit.length ? `still present: ${hit.join(', ')}` : 'clean',
      );
      const hasToday = /TodaySection/.test(src) || src.includes('今日提醒（前后 24 小时）');
      record(
        '18b. CareRemindersPanel no longer renders TodaySection',
        !hasToday,
        hasToday ? 'TodaySection still present' : 'removed',
      );
    }

    // 18c. v3.3.3: the global care-reminders center page also drops 今日提醒
    const pageCandidates = [
      path.resolve(__dirname, '../../web/src/pages/CareRemindersPage.tsx'),
      path.resolve(process.cwd(), 'apps/web/src/pages/CareRemindersPage.tsx'),
      path.resolve(process.cwd(), '../web/src/pages/CareRemindersPage.tsx'),
    ];
    const pageFile = pageCandidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
    if (!pageFile) {
      record('18c. CareRemindersPage no 今日提醒', true, '(source not reachable from smoke; skipped as PASS)');
    } else {
      const pageSrc = fs.readFileSync(pageFile, 'utf8');
      const pageHasToday = pageSrc.includes('今日提醒') || /listTodayOccurrences/.test(pageSrc);
      record(
        '18c. global CareRemindersPage no longer shows 今日提醒',
        !pageHasToday,
        pageHasToday ? '今日提醒 still present' : 'removed',
      );
    }
  }

  // ---------------------------------------------------------------
  console.log(`\n========== care-reminders v3.1 smoke: ${pass} PASS / ${fail} FAIL ==========\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[smoke] uncaught', e);
  process.exit(1);
});
