#!/usr/bin/env node
/*
 * audit-ops-v8 HTTP + DB smoke
 *
 * Run from apps/api while the API is running:
 *   node prisma/smoke-audit-ops-v8.js
 *
 * Optional:
 *   API_BASE_URL=http://localhost:3001 ADMIN_USERNAME=admin ADMIN_PASSWORD=admin123 node prisma/smoke-audit-ops-v8.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD || 'admin123';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const raw = await response.text();
  let body = raw;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    // Keep text body for diagnostics.
  }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${raw}`);
  }
  return body;
}

async function main() {
  const startedAt = new Date();

  const live = await request('/health/live');
  assert(live.status === 'UP', 'health/live should be UP');
  console.log('[PASS] GET /health/live');

  const ready = await request('/health/ready');
  assert(ready.status === 'UP', 'health/ready should be UP');
  assert(ready.dependencies?.db?.status === 'UP', 'database readiness should be UP');
  assert(ready.dependencies?.redis?.status === 'UP', 'redis readiness should be UP');
  console.log('[PASS] GET /health/ready (DB + Redis)');

  const login = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert(login.accessToken, 'admin login should return accessToken');
  const headers = { Authorization: `Bearer ${login.accessToken}` };
  console.log('[PASS] admin login');

  for (const path of [
    '/admin/ops/summary',
    '/admin/ops/reminder-worker',
    '/admin/ops/gateway',
    '/admin/ops/data-integrity',
  ]) {
    const body = await request(path, { headers });
    assert(body && typeof body === 'object', `${path} should return JSON`);
    console.log(`[PASS] GET ${path}`);
  }

  const patients = await request('/patients', { headers });
  const patientRows = Array.isArray(patients) ? patients : patients.items || [];
  assert(Array.isArray(patientRows), 'GET /patients should return a patient list');
  console.log(`[PASS] GET /patients (${patientRows.length} row(s))`);

  if (patientRows.length) {
    const patientId = patientRows[0].id;
    await request(`/patients/${encodeURIComponent(patientId)}`, { headers });
    const event = await prisma.auditLog.findFirst({
      where: {
        action: 'VIEW_PATIENT_DETAIL',
        targetType: 'Patient',
        targetId: patientId,
        createdAt: { gte: startedAt },
      },
      orderBy: { createdAt: 'desc' },
    });
    assert(event, 'VIEW_PATIENT_DETAIL audit event should be persisted');
    assert(event.afterData?.outcome === 'SUCCESS', 'patient detail audit should record SUCCESS');
    console.log('[PASS] @Audit VIEW_PATIENT_DETAIL persisted');
  } else {
    console.log('[SKIP] no patient rows available for detail audit smoke');
  }

  const listAudit = await prisma.auditLog.findFirst({
    where: {
      action: 'VIEW_PATIENT_LIST',
      createdAt: { gte: startedAt },
    },
    orderBy: { createdAt: 'desc' },
  });
  assert(listAudit, 'VIEW_PATIENT_LIST audit event should be persisted');
  console.log('[PASS] @Audit VIEW_PATIENT_LIST persisted');

  console.log('\n[PASS] audit-ops-v8 smoke succeeded');
}

main()
  .catch((error) => {
    console.error(`\n[FAIL] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
