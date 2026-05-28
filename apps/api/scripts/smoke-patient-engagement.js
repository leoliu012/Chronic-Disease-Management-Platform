// scripts/smoke-patient-engagement.js (v2.1)
//
// Runs against a live API + DB.
//
// v2.1 additions:
//   - uses global fetch (no node-fetch dep)
//   - actually tests cross-tenant isolation via nurse-002 / demo-patient-101

if (typeof fetch !== 'function') {
  console.error('[smoke] global fetch is not available. Node 18+ required. Current: ' + process.version);
  process.exit(2);
}

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

async function main() {
  console.log(`\n[smoke] target = ${API_BASE}\n`);

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
  // create + send questionnaire (AUTO) → WECHAT
  // ---------------------------------------------------------------
  let plainToken;
  {
    const r = await call(adminToken, 'POST', '/patient-engagement/patients/demo-patient-001/questionnaire-links', {
      questionnaireType: 'HYPERTENSION_MONTHLY',
      title: '【smoke】月度高血压问卷',
      send: true,
      preferredChannel: 'AUTO',
      requiresIdentityCheck: false,
    });
    expect(
      'create+send questionnaire (AUTO) → WECHAT',
      r.status === 201 && r.body?.sendResult?.channel === 'WECHAT_OFFICIAL_ACCOUNT',
      `channel=${r.body?.sendResult?.channel}`,
    );
    plainToken = r.body?.token;
  }

  // ---------------------------------------------------------------
  // GET public form returns hospital block
  // ---------------------------------------------------------------
  if (plainToken) {
    const r = await call('', 'GET', `/public-forms/${plainToken}`);
    expect(
      'GET /public-forms/:token returns hospital block',
      r.status === 200 && r.body?.hospital?.displayName,
      `hospital=${JSON.stringify(r.body?.hospital)}`,
    );
  }

  // ---------------------------------------------------------------
  // submit questionnaire → ok
  // ---------------------------------------------------------------
  if (plainToken) {
    const r = await call('', 'POST', `/public-forms/${plainToken}/questionnaire`, {
      answers: { q1: 1, q2: 2, q3: 1 },
      score: 4,
    });
    expect('submit questionnaire', r.status === 201 && r.body?.ok === true, `status=${r.status}`);
  }

  // ---------------------------------------------------------------
  // duplicate submit blocked (Bug 4)
  // ---------------------------------------------------------------
  if (plainToken) {
    const r = await call('', 'POST', `/public-forms/${plainToken}/questionnaire`, {
      answers: { q1: 1, q2: 2, q3: 1 },
      score: 4,
    });
    expect(
      'duplicate submit blocked',
      r.status === 403 && /TOKEN_USED|已提交|已失效/.test(JSON.stringify(r.body)),
      `status=${r.status}`,
    );
  }

  // ---------------------------------------------------------------
  // demo-patient-003 — AUTO fallback to SMS
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'POST', '/patient-engagement/patients/demo-patient-003/questionnaire-links', {
      questionnaireType: 'HYPERTENSION_MONTHLY',
      title: '【smoke】SMS 兜底测试',
      send: true,
      preferredChannel: 'AUTO',
      requiresIdentityCheck: false,
    });
    expect(
      'demo-patient-003 AUTO → SMS fallback',
      r.status === 201 && r.body?.sendResult?.channel === 'SMS',
      `channel=${r.body?.sendResult?.channel}`,
    );
  }

  // ---------------------------------------------------------------
  // send=false → MANUAL_COPY message (Bug 3)
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'POST', '/patient-engagement/patients/demo-patient-001/questionnaire-links', {
      questionnaireType: 'HYPERTENSION_MONTHLY',
      title: '【smoke】MANUAL_COPY 检查',
      send: false,
      requiresIdentityCheck: false,
    });
    const m = r.body?.message;
    expect(
      'send=false → MANUAL_COPY message exists',
      r.status === 201 && m?.channel === 'MANUAL_COPY' && m?.status === 'PENDING',
      `channel=${m?.channel} status=${m?.status}`,
    );
    if (r.body?.formLink?.id) {
      const list = await call(adminToken, 'GET',
        '/patient-engagement/messages?patientId=demo-patient-001&channel=MANUAL_COPY');
      const found = (list.body || []).find((x) => x.formLinkId === r.body.formLink.id);
      expect(
        'MANUAL_COPY message visible in /messages with linkUrl',
        Boolean(found && found.linkUrl && /\/wx\/form\//.test(found.linkUrl)),
      );
    }
  }

  // ---------------------------------------------------------------
  // v2.1 — cross-tenant isolation (Problem 6)
  // ---------------------------------------------------------------
  console.log('\n--- cross-tenant isolation (v2.1) ---');
  let nurse2Token;
  try {
    nurse2Token = await login(NURSE2_USERNAME, NURSE2_PASSWORD);
    expect('login nurse2 (demo-tenant-002)', Boolean(nurse2Token));
  } catch (e) {
    record('login nurse2 (demo-tenant-002)', false, e.message + ' — did you re-run seed-all.js after applying v2.1 patch?');
    nurse2Token = null;
  }

  if (nurse2Token) {
    // nurse2 reading demo-patient-001 (other tenant) → 403
    {
      const r = await call(nurse2Token, 'GET', '/patient-engagement/patients/demo-patient-001/contact-summary');
      expect(
        'nurse2 → demo-patient-001 contact-summary → 403',
        r.status === 403,
        `status=${r.status}`,
      );
    }
    // nurse2 creating a link on demo-patient-001 → 403
    {
      const r = await call(nurse2Token, 'POST', '/patient-engagement/patients/demo-patient-001/questionnaire-links', {
        questionnaireType: 'HYPERTENSION_MONTHLY',
        title: '【cross-tenant】should be blocked',
        send: false,
        requiresIdentityCheck: false,
      });
      expect(
        'nurse2 → create link for demo-patient-001 → 403',
        r.status === 403,
        `status=${r.status}`,
      );
    }
    // nurse2 reading her own demo-patient-101 → 200
    {
      const r = await call(nurse2Token, 'GET', '/patient-engagement/patients/demo-patient-101/contact-summary');
      expect(
        'nurse2 → demo-patient-101 (own tenant) → 200',
        r.status === 200,
        `status=${r.status}`,
      );
    }
    // nurse2 reading hospital-wechat config (any tenant) — non-ADMIN should be
    // restricted to own tenant; she should be able to see her own.
    {
      const r = await call(nurse2Token, 'GET', '/hospital-wechat/account');
      expect(
        'nurse2 → GET /hospital-wechat/account (own tenant)',
        r.status === 200 && r.body?.hospitalTenantId === 'demo-tenant-002',
        `tenant=${r.body?.hospitalTenantId}`,
      );
    }
    // nurse2 trying to upsert (write) → 403 (NURSE is read-only on accounts)
    {
      const r = await call(nurse2Token, 'POST', '/hospital-wechat/account', {
        appId: 'wx_attempt_hack',
        appSecret: 'hax',
        isEnabled: true,
      });
      expect(
        'nurse2 → POST /hospital-wechat/account → 403 (NURSE write blocked)',
        r.status === 403 || r.status === 401,
        `status=${r.status}`,
      );
    }
  }

  // ---------------------------------------------------------------
  // summary
  // ---------------------------------------------------------------
  console.log(`\n========== smoke summary: ${pass} PASS / ${fail} FAIL ==========\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[smoke] uncaught', e);
  process.exit(1);
});
