#!/usr/bin/env node
/*
 * API smoke test for the stable demo flow.
 * Run while the API server is already running:
 *   npm run smoke
 */

const baseUrl = (process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

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
  console.log(`\nRunning smoke test against ${baseUrl}`);
  console.log('================================');

  const adminToken = await login('admin', 'admin123');
  const nurseToken = await login('nurse', 'nurse123');

  const me = await request('GET /auth/me', 'GET', '/auth/me', { token: adminToken });
  ok('GET /auth/me', me?.role || 'ok');

  const patients = await request('GET /patients', 'GET', '/patients', { token: adminToken });
  ok('GET /patients', Array.isArray(patients) ? `${patients.length} patients` : 'ok');

  const overview = await request('GET /reports/overview', 'GET', '/reports/overview', { token: adminToken });
  ok('GET /reports/overview', overview ? 'ok' : 'empty response');

  const rules = await request('GET /clinical-rules/summary', 'GET', '/clinical-rules/summary', { token: adminToken });
  ok('GET /clinical-rules/summary', Array.isArray(rules?.templates) ? `${rules.templates.length} templates` : 'ok');

  const sources = await request('GET /integrations/sources', 'GET', '/integrations/sources', { token: adminToken });
  ok('GET /integrations/sources', Array.isArray(sources) ? `${sources.length} sources` : 'ok');

  const smokeOpenId = 'smoke-openid-release-hardening-v1';
  const demoLogin = await request('POST /patient-app/demo-login', 'POST', '/patient-app/demo-login', {
    body: { demoOpenId: smokeOpenId },
  });
  ok('POST /patient-app/demo-login', demoLogin?.bindingStatus || 'ok');

  // patient-self-consent-bind: 统一入口 —— 搜索院内信息 → 签署知情同意书 → 提交绑定申请。
  const identity = {
    demoOpenId: smokeOpenId,
    phone: '13800010001',
    hospitalPatientId: 'MZ20260519001',
    idCardLast4: '0011',
  };

  const lookup = await request(
    'POST /patient-app/identity/lookup',
    'POST',
    '/patient-app/identity/lookup',
    { body: identity, expectedStatuses: [200, 201] },
  );
  ok('POST /patient-app/identity/lookup', lookup?.matchType || 'ok');

  if (lookup?.matchType && lookup.matchType !== 'NOT_FOUND' && lookup.matchType !== 'HIS_PATIENT') {
    const consent = await request(
      'POST /patient-app/consent/submit',
      'POST',
      '/patient-app/consent/submit',
      {
        body: {
          demoOpenId: smokeOpenId,
          consentAccepted: true,
          consentVersion: lookup.consentVersion || '2026-05-24-v2',
          matchType: lookup.matchType,
          chronicLeadId: lookup.chronicLead?.id,
          patientId: lookup.patient?.id,
          hospitalPatientId: identity.hospitalPatientId,
        },
        expectedStatuses: [200, 201],
      },
    );
    ok('POST /patient-app/consent/submit', consent?.consentId ? 'consent signed' : 'ok');

    const bindingRequest = await request(
      'POST /patient-app/binding-requests',
      'POST',
      '/patient-app/binding-requests',
      {
        body: {
          demoOpenId: smokeOpenId,
          phone: identity.phone,
          hospitalPatientId: identity.hospitalPatientId,
          idCardLast4: identity.idCardLast4,
          matchType: lookup.matchType,
          chronicLeadId: lookup.chronicLead?.id,
          consentId: consent?.consentId,
        },
        expectedStatuses: [200, 201],
      },
    );
    ok('POST /patient-app/binding-requests', bindingRequest?.message || 'ok');
  } else {
    ok('POST /patient-app/binding-requests', `skipped (matchType=${lookup?.matchType || 'unknown'})`);
  }

  const pendingBindings = await request('GET /patient-binding-requests', 'GET', '/patient-binding-requests?status=PENDING', {
    token: nurseToken,
  });
  ok('GET /patient-binding-requests?status=PENDING', Array.isArray(pendingBindings) ? `${pendingBindings.length} pending` : 'ok');

  console.log('================================');
  if (results.some((result) => !result.ok)) process.exit(1);
  console.log('✅ Smoke test passed.');
}

main().catch((error) => {
  fail('Smoke test failed', error.message || String(error));
  console.log('\nHints:');
  console.log('- Make sure the API server is running: npm run start:dev');
  console.log('- Initialize the demo database first: npm run demo:init');
  console.log('- Check API_BASE_URL if your API is not on http://localhost:3000');
  process.exit(1);
});

