#!/usr/bin/env node
/*
 * Release hardening doctor check for the Chronic Care API.
 * Run from apps/api:
 *   npm run doctor
 * or:
 *   node scripts/doctor.js
 */

const fs = require('fs');
const path = require('path');

const apiRoot = path.resolve(__dirname, '..');

function loadDotEnv() {
  const envPath = path.join(apiRoot, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

const checks = [];
function pass(label, detail = '') {
  checks.push({ ok: true, label, detail, level: 'PASS' });
}
function warn(label, detail = '') {
  checks.push({ ok: true, label, detail, level: 'WARN' });
}
function fail(label, detail = '') {
  checks.push({ ok: false, label, detail, level: 'FAIL' });
}

async function main() {
  loadDotEnv();

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= 18) {
    pass('Node.js version', process.version);
  } else {
    fail('Node.js version', `Expected Node.js 18+, got ${process.version}`);
  }

  if (process.env.DATABASE_URL) {
    pass('DATABASE_URL is configured');
  } else {
    fail('DATABASE_URL is missing', 'Set it in apps/api/.env or shell environment.');
  }

  if (process.env.JWT_SECRET) {
    if (process.env.JWT_SECRET === 'dev_secret_change_later') {
      warn('JWT_SECRET is using the demo value', 'OK for local demo; change before any real deployment.');
    } else {
      pass('JWT_SECRET is configured');
    }
  } else {
    fail('JWT_SECRET is missing', 'Auth/RBAC login cannot safely sign tokens.');
  }

  if (process.env.GATEWAY_API_KEY) {
    if (process.env.GATEWAY_API_KEY === 'dev_gateway_key_change_in_prod') {
      warn('GATEWAY_API_KEY is using the demo value', 'OK for local demo; change before any real deployment.');
    } else {
      pass('GATEWAY_API_KEY is configured');
    }
  } else {
    fail('GATEWAY_API_KEY is missing', 'FHIR/HIS REST endpoints will reject all requests (fail-closed).');
  }

  let PrismaClient;
  try {
    ({ PrismaClient } = require('@prisma/client'));
    pass('Prisma Client can be loaded');
  } catch (error) {
    fail('Prisma Client cannot be loaded', 'Run: npx prisma generate');
    printResults();
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    pass('Database connection succeeded');

    const requiredTables = [
      'Patient',
      'DiseaseProfile',
      'VitalRecord',
      'RiskAlert',
      'Task',
      'MedicationRecord',
      'QuestionnaireResult',
      'VitalMonitoringPlan',
      'AuditLog',
      'User',
      'PatientBindingRequest',
      'PatientSession',
      'DiseaseRuleTemplate',
      'VitalThresholdRule',
      'FollowUpPolicy',
      'QuestionnaireTemplate',
      'IntegrationSource',
      'IntegrationSyncBatch',
      'IntegrationSyncRecord',
      'IntegrationFieldMapping',
      'EncounterRecord',
      'MedicalRecordSummary',
      'HospitalMedicationOrder',
    ];

    const rows = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${requiredTables.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')})`,
    );
    const found = new Set(rows.map((row) => row.table_name));
    const missing = requiredTables.filter((table) => !found.has(table));

    if (missing.length === 0) {
      pass('Critical database tables exist', `${requiredTables.length} tables checked`);
    } else {
      fail('Critical database tables are missing', missing.join(', '));
    }

    // gateway-promote-pipeline columns
    try {
      const cols = await prisma.$queryRawUnsafe(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='IntegrationSyncRecord' AND column_name IN ('promotionStatus','promotionMessage','promotedAt')`,
      );
      const colNames = cols.map((c) => c.column_name);
      const missingCols = ['promotionStatus', 'promotionMessage', 'promotedAt'].filter((c) => !colNames.includes(c));
      if (missingCols.length === 0) {
        pass('Gateway promote columns exist', 'IntegrationSyncRecord.{promotionStatus, promotionMessage, promotedAt}');
      } else {
        fail('Gateway promote columns missing', `Run "npx prisma migrate dev". Missing: ${missingCols.join(', ')}`);
      }
    } catch (error) {
      fail('Could not introspect IntegrationSyncRecord columns', describePrismaError(error));
    }

    try {
      const cols = await prisma.$queryRawUnsafe(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='IntegrationSource' AND column_name='autoPromote'`,
      );
      if (cols.length === 1) {
        pass('IntegrationSource.autoPromote column exists');
      } else {
        fail('IntegrationSource.autoPromote column missing', 'Run "npx prisma migrate dev".');
      }
    } catch (error) {
      fail('Could not introspect IntegrationSource columns', describePrismaError(error));
    }

    try {
      const userCount = await prisma.user.count();
      userCount > 0 ? pass('Demo/auth users exist', `${userCount} users`) : warn('No users found', 'Run: node prisma/seed-all.js');
    } catch (error) {
      fail('Cannot query User table', describePrismaError(error));
    }

    try {
      const patientCount = await prisma.patient.count();
      patientCount > 0 ? pass('Demo patients exist', `${patientCount} patients`) : warn('No patients found', 'Run: node prisma/seed-all.js');
    } catch (error) {
      fail('Cannot query Patient table', describePrismaError(error));
    }

    try {
      const ruleCount = await prisma.diseaseRuleTemplate.count();
      ruleCount > 0 ? pass('Clinical rule templates exist', `${ruleCount} templates`) : warn('No clinical rules found', 'Run: node prisma/seed-all.js');
    } catch (error) {
      fail('Cannot query DiseaseRuleTemplate table', describePrismaError(error));
    }

    try {
      const sourceCount = await prisma.integrationSource.count();
      sourceCount > 0 ? pass('Integration sources exist', `${sourceCount} sources`) : warn('No integration sources found', 'Run: node prisma/seed-all.js');
    } catch (error) {
      fail('Cannot query IntegrationSource table', describePrismaError(error));
    }

    // gateway sources should be auto-upserted by GatewaySourceRegistry on module init,
    // but we can warn here if they're missing — that means the api process never started.
    try {
      const gatewayCodes = [
        'GATEWAY_FHIR_REST',
        'GATEWAY_HIS_EVENT_REST',
        'GATEWAY_HL7_MLLP',
        'GATEWAY_INTERMEDIATE_DB',
      ];
      const existing = await prisma.integrationSource.findMany({
        where: { code: { in: gatewayCodes } },
        select: { code: true },
      });
      const seen = new Set(existing.map((s) => s.code));
      const missing = gatewayCodes.filter((c) => !seen.has(c));
      if (missing.length === 0) {
        pass('Gateway IntegrationSource rows seeded', `${gatewayCodes.length} channels registered`);
      } else {
        warn('Some gateway IntegrationSource rows missing', `Start the API at least once. Missing: ${missing.join(', ')}`);
      }
    } catch (error) {
      warn('Could not check gateway IntegrationSource rows', describePrismaError(error));
    }
  } catch (error) {
    fail('Database connection failed', error.message || String(error));
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }

  printResults();
  if (checks.some((check) => !check.ok)) process.exit(1);
}

function describePrismaError(error) {
  if (error && typeof error === 'object' && error.code) {
    return `${error.code}${error.meta?.table ? ` (${error.meta.table})` : ''}`;
  }
  return error?.message || String(error);
}

function printResults() {
  console.log('\nChronic Care API doctor check');
  console.log('================================');
  for (const check of checks) {
    const icon = check.level === 'PASS' ? '✅' : check.level === 'WARN' ? '⚠️ ' : '❌';
    console.log(`${icon} [${check.level}] ${check.label}${check.detail ? ` — ${check.detail}` : ''}`);
  }
  console.log('================================');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
