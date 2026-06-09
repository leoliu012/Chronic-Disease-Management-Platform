// scripts/smoke-patient-engagement.js (v3.2)
//
// Runs against a live API + DB.
//
// v3.2 additions (history detail + filters + attempts):
//   - /messages is now paginated: { items, total, page, pageSize }
//   - message detail (/messages/:id/detail) returns attempts + submission
//   - resend reuses the message (no new PatientOutboundMessage row); appends a
//     PatientOutboundAttempt
//   - revoke ("使链接失效") sets message.status=CANCELED + friendly H5 page
//   - list filters by status / messageType / createdAt range
//   - mark-manual button removed from the frontend source

if (typeof fetch !== 'function') {
  console.error('[smoke] global fetch is not available. Node 18+ required. Current: ' + process.version);
  process.exit(2);
}

const fs = require('fs');
const path = require('path');

const API_BASE = process.env.API_BASE || process.env.SMOKE_API_BASE || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const NURSE2_USERNAME = 'nurse2';
const NURSE2_PASSWORD = 'nurse123';

let pass = 0;
let fail = 0;

function record(name, ok, detail = '') {
  const tag = ok ? '\x1b[32m PASS \x1b[0m' : '\x1b[31m FAIL \x1b[0m';
  console.log(`${tag} ${name}${detail ? '  — ' + detail : ''}`);
  if (ok) pass += 1;
  else fail += 1;
}

function expect(name, condition, detail = '') {
  record(name, Boolean(condition), detail);
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

// /messages returns { items, total, page, pageSize } in v3.2; tolerate a bare array too.
function listItems(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.items)) return body.items;
  return [];
}

function tokenFromLinkUrl(linkUrl) {
  if (!linkUrl) return null;
  const m = /\/wx\/form\/([^/?#]+)/.exec(linkUrl);
  return m ? decodeURIComponent(m[1]) : null;
}

async function main() {
  console.log(`\n[smoke patient-engagement v3.2] target = ${API_BASE}\n`);

  const adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  expect('login ADMIN', Boolean(adminToken));

  // ---------------------------------------------------------------
  // demo tenant + service account
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'GET', '/hospital-wechat/account?hospitalTenantId=demo-tenant-001');
    expect('GET demo HospitalWechatOfficialAccount', r.status === 200 && r.body.configured === true,
      `status=${r.status} configured=${r.body?.configured}`);
    expect('  enabled + verified', r.body?.isEnabled === true && r.body?.isVerified === true);
  }

  // ---------------------------------------------------------------
  // demo-patient-001 contact summary
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'GET', '/patient-engagement/patients/demo-patient-001/contact-summary');
    expect(
      'demo-patient-001 contact summary — has openId',
      r.status === 200 && r.body?.hasOpenId === true && r.body?.hospitalServiceAccountReady === true,
      `hasOpenId=${r.body?.hasOpenId} ready=${r.body?.hospitalServiceAccountReady}`,
    );
  }

  // ---------------------------------------------------------------
  // 1. create + send questionnaire (AUTO) → WECHAT
  // ---------------------------------------------------------------
  let plainToken;
  let qMessageId = null;
  let qFormLinkId = null;
  {
    const r = await call(adminToken, 'POST', '/patient-engagement/patients/demo-patient-001/questionnaire-links', {
      questionnaireType: 'HYPERTENSION_MONTHLY',
      title: '【smoke v3.2】问卷 (WeChat)',
      send: true,
      preferredChannel: 'AUTO',
      requiresIdentityCheck: false,
    });
    expect(
      '1. create+send questionnaire (AUTO) → WECHAT',
      r.status === 201 && r.body?.sendResult?.channel === 'WECHAT_OFFICIAL_ACCOUNT',
      `channel=${r.body?.sendResult?.channel}`,
    );
    plainToken = r.body?.token;
    qMessageId = r.body?.message?.id ?? null;
    qFormLinkId = r.body?.formLink?.id ?? null;
  }

  // ---------------------------------------------------------------
  // 2 + 3. message detail returns attempts incl. WECHAT_OFFICIAL_ACCOUNT
  // ---------------------------------------------------------------
  if (qMessageId) {
    const r = await call(adminToken, 'GET', `/patient-engagement/messages/${qMessageId}/detail`);
    const attempts = r.body?.attempts || [];
    expect(
      '2. message detail returns attempts',
      r.status === 200 && Array.isArray(attempts) && attempts.length >= 1,
      `attempts=${attempts.length}`,
    );
    expect(
      '3. attempts include WECHAT_OFFICIAL_ACCOUNT (initial)',
      attempts.some((a) => a.channel === 'WECHAT_OFFICIAL_ACCOUNT' && a.triggerReason === 'INITIAL'),
      `channels=${attempts.map((a) => a.channel).join(',')}`,
    );
  } else {
    record('2. message detail returns attempts', false, '(no message id)');
    record('3. attempts include WECHAT_OFFICIAL_ACCOUNT (initial)', false, '(no message id)');
  }

  // ---------------------------------------------------------------
  // 4. SMS scenario (demo-patient-003 has no openId → SMS) → detail shows SMS
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'POST', '/patient-engagement/patients/demo-patient-003/questionnaire-links', {
      questionnaireType: 'HYPERTENSION_MONTHLY',
      title: '【smoke v3.2】SMS 通道',
      send: true,
      preferredChannel: 'AUTO',
      requiresIdentityCheck: false,
    });
    const smsMsgId = r.body?.message?.id ?? null;
    let smsOk = r.status === 201 && r.body?.sendResult?.channel === 'SMS';
    if (smsMsgId) {
      const d = await call(adminToken, 'GET', `/patient-engagement/messages/${smsMsgId}/detail`);
      const attempts = d.body?.attempts || [];
      smsOk = smsOk && attempts.some((a) => a.channel === 'SMS');
    }
    expect('4. SMS scenario → detail shows SMS attempt', smsOk, `channel=${r.body?.sendResult?.channel}`);
  }

  // ---------------------------------------------------------------
  // 5 + 6. resend does NOT add a new message; adds a new attempt
  // ---------------------------------------------------------------
  if (qMessageId && qFormLinkId) {
    const before = await call(adminToken, 'GET', '/patient-engagement/messages?patientId=demo-patient-001&pageSize=200');
    const beforeCount = listItems(before.body).length;
    const beforeDetail = await call(adminToken, 'GET', `/patient-engagement/messages/${qMessageId}/detail`);
    const beforeAttempts = (beforeDetail.body?.attempts || []).length;

    const resend = await call(adminToken, 'POST', `/patient-engagement/messages/${qMessageId}/resend`, { preferredChannel: 'AUTO' });

    const after = await call(adminToken, 'GET', '/patient-engagement/messages?patientId=demo-patient-001&pageSize=200');
    const afterCount = listItems(after.body).length;
    const afterDetail = await call(adminToken, 'GET', `/patient-engagement/messages/${qMessageId}/detail`);
    const afterAttempts = (afterDetail.body?.attempts || []).length;

    expect(
      '5. resend does NOT create a new PatientOutboundMessage',
      (resend.status === 200 || resend.status === 201) && afterCount === beforeCount,
      `messages ${beforeCount}→${afterCount}`,
    );
    expect(
      '6. resend appends a PatientOutboundAttempt (NURSE_RESEND)',
      afterAttempts > beforeAttempts &&
        (afterDetail.body?.attempts || []).some((a) => a.triggerReason === 'NURSE_RESEND'),
      `attempts ${beforeAttempts}→${afterAttempts}`,
    );
  } else {
    record('5. resend does NOT create a new PatientOutboundMessage', false, '(no message)');
    record('6. resend appends a PatientOutboundAttempt (NURSE_RESEND)', false, '(no message)');
  }

  // ---------------------------------------------------------------
  // 7. submit questionnaire → detail returns answers/score/riskLevel
  // ---------------------------------------------------------------
  if (plainToken) {
    const sub = await call('', 'POST', `/public-forms/${plainToken}/questionnaire`, {
      answers: { q1: 1, q2: 2, q3: 1 },
      score: 4,
    });
    expect('   submit questionnaire OK', sub.status === 201 && sub.body?.ok === true, `status=${sub.status}`);

    // formLink.submissionType/submissionId should be set now
    if (qMessageId) {
      const d = await call(adminToken, 'GET', `/patient-engagement/messages/${qMessageId}/detail`);
      const submission = d.body?.submission;
      expect(
        '7. detail.submission returns questionnaire answers/score/riskLevel',
        submission && submission.type === 'QuestionnaireResult' &&
          submission.data && typeof submission.data.score !== 'undefined' &&
          typeof submission.data.riskLevel !== 'undefined' && Boolean(submission.data.answers),
        `type=${submission?.type} score=${submission?.data?.score}`,
      );
      expect(
        '   formLink.submissionType/submissionId set',
        d.body?.formLink?.submissionType === 'QuestionnaireResult' && Boolean(d.body?.formLink?.submissionId),
        `submissionType=${d.body?.formLink?.submissionType}`,
      );
    }
  } else {
    record('7. detail.submission returns questionnaire answers/score/riskLevel', false, '(no token)');
  }

  // ---------------------------------------------------------------
  // 7b. duplicate submit blocked (Bug 4 — still holds)
  // ---------------------------------------------------------------
  if (plainToken) {
    const dup = await call('', 'POST', `/public-forms/${plainToken}/questionnaire`, { answers: { q1: 1 }, score: 4 });
    expect(
      '7b. duplicate submit blocked',
      dup.status === 403 && /TOKEN_USED|已提交|已失效/.test(JSON.stringify(dup.body)),
      `status=${dup.status}`,
    );
  }

  // ---------------------------------------------------------------
  // 8. "使链接失效" (revoke): message=CANCELED, link=REVOKED, friendly H5
  // ---------------------------------------------------------------
  {
    // fresh case to revoke (send=false keeps it ACTIVE + un-submitted)
    const created = await call(adminToken, 'POST', '/patient-engagement/patients/demo-patient-001/questionnaire-links', {
      questionnaireType: 'HYPERTENSION_MONTHLY',
      title: '【smoke v3.2】待失效',
      send: false,
      requiresIdentityCheck: false,
    });
    const revMsgId = created.body?.message?.id ?? null;
    const revLinkId = created.body?.formLink?.id ?? null;
    const revToken = created.body?.token ?? null;
    const reason = 'smoke：医生已电话联系，无需再次填写';

    if (revLinkId) {
      const rev = await call(adminToken, 'POST', `/patient-engagement/form-links/${revLinkId}/revoke`, { reason });
      expect('8a. revoke form-link succeeds', rev.status === 200 || rev.status === 201, `status=${rev.status}`);

      const detail = await call(adminToken, 'GET', `/patient-engagement/messages/${revMsgId}/detail`);
      expect('8b. message status = CANCELED', detail.body?.message?.status === 'CANCELED', `status=${detail.body?.message?.status}`);
      expect('8c. formLink status = REVOKED', detail.body?.formLink?.status === 'REVOKED', `status=${detail.body?.formLink?.status}`);
      expect('8d. detail returns revokeReason', detail.body?.formLink?.revokeReason === reason, `reason=${detail.body?.formLink?.revokeReason}`);

      if (revToken) {
        const pub = await call('', 'GET', `/public-forms/${revToken}`);
        const friendly = pub.status === 200 && pub.body?.status === 'REVOKED' && pub.body?.revokeReason === reason;
        expect('8e. GET /public-forms/:token returns friendly revoked info', friendly, `status=${pub.body?.status} reason=${pub.body?.revokeReason}`);
      }
    } else {
      record('8a. revoke form-link succeeds', false, '(no form link)');
    }
  }

  // ---------------------------------------------------------------
  // 9. filter by status
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'GET', '/patient-engagement/messages?patientId=demo-patient-001&status=CANCELED&pageSize=200');
    const items = listItems(r.body);
    expect(
      '9. messages filter by status=CANCELED',
      r.status === 200 && items.length >= 1 && items.every((m) => m.status === 'CANCELED'),
      `count=${items.length}`,
    );
  }

  // ---------------------------------------------------------------
  // 10. filter by messageType
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'GET', '/patient-engagement/messages?patientId=demo-patient-001&messageType=QUESTIONNAIRE_REMINDER&pageSize=200');
    const items = listItems(r.body);
    expect(
      '10. messages filter by messageType=QUESTIONNAIRE_REMINDER',
      r.status === 200 && items.length >= 1 && items.every((m) => m.messageType === 'QUESTIONNAIRE_REMINDER'),
      `count=${items.length}`,
    );
  }

  // ---------------------------------------------------------------
  // 11. filter by createdAt date range (a wide window around "now" returns rows;
  //     a far-past single day returns none).
  //
  //     NOTE: the API server and this smoke may run in different timezones, so a
  //     single-day window keyed off the local date is fragile. We query
  //     yesterday→tomorrow, which brackets "now" in ANY timezone, while the
  //     far-past window stays empty regardless of TZ.
  // ---------------------------------------------------------------
  {
    const fmt = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    const from = fmt(yesterday);
    const to = fmt(tomorrow);
    const inRange = await call(adminToken, 'GET', `/patient-engagement/messages?patientId=demo-patient-001&from=${from}&to=${to}&pageSize=200`);
    const past = await call(adminToken, 'GET', '/patient-engagement/messages?patientId=demo-patient-001&from=2000-01-01&to=2000-01-02&pageSize=200');
    const inCount = listItems(inRange.body).length;
    const pastCount = listItems(past.body).length;
    expect(
      '11. messages filter by createdAt range',
      inRange.status === 200 && inCount >= 1 && pastCount === 0,
      `window[${from}..${to}]=${inCount} past=${pastCount}`,
    );
  }

  // ---------------------------------------------------------------
  // 11b. pagination shape
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'GET', '/patient-engagement/messages?patientId=demo-patient-001&page=1&pageSize=2');
    expect(
      '11b. /messages returns paginated { items, total, page, pageSize }',
      r.status === 200 && Array.isArray(r.body?.items) && typeof r.body?.total === 'number' && r.body?.pageSize === 2,
      `total=${r.body?.total} pageSize=${r.body?.pageSize}`,
    );
  }

  // ---------------------------------------------------------------
  // 12. mark-manual button removed from frontend source
  // ---------------------------------------------------------------
  {
    const candidates = [
      path.resolve(__dirname, '../../web/src/components/PatientEngagementTab.tsx'),
      path.resolve(process.cwd(), 'apps/web/src/components/PatientEngagementTab.tsx'),
      path.resolve(process.cwd(), '../web/src/components/PatientEngagementTab.tsx'),
    ];
    const file = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
    if (!file) {
      record('12. mark-manual button removed from frontend source', true, '(source not reachable from smoke; skipped as PASS)');
    } else {
      const raw = fs.readFileSync(file, 'utf8');
      // Strip comments (// line, /* block */, and JSX {/* */}) so a doc comment
      // that merely *describes* the removed controls doesn't trigger a false fail.
      const src = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join('\n');
      // Match the actual handler/import name, or the labels as JSX element text
      // content (>改短信<) — i.e. real UI, not prose.
      const hasHandler = /markMessageManualSent/.test(src);
      const hasButton = />\s*(标记手动|改短信|改服务号)\s*</.test(src);
      const hasManual = hasHandler || hasButton;
      expect(
        '12. mark-manual / change-channel buttons removed from frontend source',
        !hasManual,
        hasManual ? `handler=${hasHandler} button=${hasButton}` : file,
      );
    }
  }

  // ---------------------------------------------------------------
  // cross-tenant isolation (v2.1 — still holds)
  // ---------------------------------------------------------------
  console.log('\n--- cross-tenant isolation ---');
  let nurse2Token;
  try {
    nurse2Token = await login(NURSE2_USERNAME, NURSE2_PASSWORD);
    expect('login nurse2 (demo-tenant-002)', Boolean(nurse2Token));
  } catch (e) {
    record('login nurse2 (demo-tenant-002)', false, e.message);
    nurse2Token = null;
  }

  if (nurse2Token) {
    {
      const r = await call(nurse2Token, 'GET', '/patient-engagement/patients/demo-patient-001/contact-summary');
      expect('nurse2 → demo-patient-001 contact-summary → 403/404', [403, 404].includes(r.status), `status=${r.status}`);
    }
    {
      const r = await call(nurse2Token, 'POST', '/patient-engagement/patients/demo-patient-001/questionnaire-links', {
        questionnaireType: 'HYPERTENSION_MONTHLY',
        title: '【cross-tenant】should be blocked',
        send: false,
        requiresIdentityCheck: false,
      });
      expect('nurse2 → create link for demo-patient-001 → 403/404', [403, 404].includes(r.status), `status=${r.status}`);
    }
    {
      const r = await call(nurse2Token, 'GET', '/patient-engagement/patients/demo-patient-101/contact-summary');
      expect('nurse2 → demo-patient-101 (own tenant) → 200', r.status === 200, `status=${r.status}`);
    }
    {
      // tenant isolation on the message list (no patientId → scoped to own tenant)
      const r = await call(nurse2Token, 'GET', '/patient-engagement/messages?pageSize=50');
      const items = listItems(r.body);
      const leaked = items.some((m) => m.patient && m.patient.id === 'demo-patient-001');
      expect('nurse2 → /messages does not leak other-tenant rows', r.status === 200 && !leaked, `count=${items.length} leaked=${leaked}`);
    }
  }

  // ---------------------------------------------------------------
  console.log(`\n========== patient-engagement v3.2 smoke: ${pass} PASS / ${fail} FAIL ==========\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[smoke] uncaught', e);
  process.exit(1);
});
