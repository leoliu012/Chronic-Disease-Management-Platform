#!/usr/bin/env node
/*
 * Black-box + DB smoke for trial-stabilization-v8.1.
 *
 * Prerequisites:
 *   - API running on localhost:3000 (or API_BASE_URL)
 *   - migration applied + prisma generate
 *   - demo seed / repair applied
 *
 * It creates one temporary already-expired ACTIVE H5 link, triggers a Worker
 * round through the authenticated admin endpoint, verifies convergence to
 * EXPIRED, verifies persisted expiredLinks metric, and cleans up.
 */
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const API = process.env.API_BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function http(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${text}`);
  }
  return body;
}

async function login() {
  const body = await http('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert(body && body.accessToken, 'admin login response missing accessToken');
  console.log('[PASS] admin login');
  return body.accessToken;
}

async function runLeaderRound(token) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const summary = await http('/care-reminders/worker/run-once', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (summary.status === 'SUCCEEDED') {
      console.log(`[PASS] Worker leader round succeeded on attempt ${attempt}`);
      return summary;
    }
    if (summary.status !== 'SKIPPED_LOCKED' && summary.status !== 'SKIPPED_IN_FLIGHT') {
      throw new Error(`unexpected Worker run status: ${JSON.stringify(summary)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Worker did not obtain leader lock after 12 attempts');
}

async function main() {
  const token = await login();
  const patient = await prisma.patient.findUnique({
    where: { id: 'demo-patient-001' },
    select: { id: true, hospitalTenantId: true },
  });
  assert(patient, 'demo-patient-001 missing; run node prisma/seed-all.js first');

  const id = `smoke-expired-link-${crypto.randomUUID()}`;
  const tokenHash = crypto.createHash('sha256').update(id).digest('hex');
  try {
    await prisma.patientFormLink.create({
      data: {
        id,
        hospitalTenantId: patient.hospitalTenantId,
        patientId: patient.id,
        type: 'GENERIC_NOTICE',
        tokenHash,
        title: 'trial-stabilization-v8.1 temporary expired link',
        expiresAt: new Date(Date.now() - 60_000),
        status: 'ACTIVE',
        maxSubmit: 1,
      },
    });
    console.log('[PASS] created temporary expired ACTIVE H5 link');

    const summary = await runLeaderRound(token);
    assert((summary.expiredLinks || 0) >= 1, `Worker summary expiredLinks expected >=1: ${JSON.stringify(summary)}`);

    const repaired = await prisma.patientFormLink.findUnique({ where: { id } });
    assert(repaired && repaired.status === 'EXPIRED', `temporary H5 link status is ${repaired?.status || 'missing'}, expected EXPIRED`);
    console.log('[PASS] Worker converged temporary H5 link to EXPIRED');

    const latest = await prisma.careReminderWorkerRun.findFirst({
      where: { status: 'SUCCEEDED' },
      orderBy: { finishedAt: 'desc' },
      select: { expiredLinks: true },
    });
    assert(latest && latest.expiredLinks >= 1, 'persisted Worker run expiredLinks metric missing');
    console.log('[PASS] Worker run persisted expiredLinks metric');

    const ops = await http('/admin/ops/reminder-worker', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert((ops.metrics24h?.expiredLinks || 0) >= 1, 'admin ops reminder-worker missing expiredLinks metric');
    console.log('[PASS] admin ops exposes 24h expiredLinks metric');

    const integrity = await http('/admin/ops/data-integrity', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(integrity.activeLinksAlreadyExpired === 0, `ops reports ${integrity.activeLinksAlreadyExpired} expired ACTIVE links`);
    console.log('[PASS] data-integrity reports zero expired ACTIVE links');
    console.log('\n[PASS] trial-stabilization-v8.1 smoke succeeded');
  } finally {
    await prisma.patientFormLink.deleteMany({ where: { id } });
  }
}

main()
  .catch((error) => {
    console.error('\n[FAIL]', error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
