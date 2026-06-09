#!/usr/bin/env node
/*
 * Static assertions for trial-stabilization-v8.1.
 * Run from repository root:
 *   node scripts/assert-trial-stabilization-v8-1.js
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error(`missing ${relative}`);
  return fs.readFileSync(absolute, 'utf8');
}

function must(relative, needle, label) {
  const source = read(relative);
  if (!source.includes(needle)) throw new Error(`${label}: expected snippet not found in ${relative}`);
  console.log(`[PASS] ${label}`);
}

function main() {
  must(
    'apps/api/prisma/schema.prisma',
    '  expiredLinks    Int      @default(0)',
    'Worker run schema persists expiredLinks',
  );
  must(
    'apps/api/src/care-reminders/care-reminder-worker.service.ts',
    'summary.expiredLinks = await this.expireStaleFormLinks();',
    'Worker leader round runs H5 expiry housekeeping',
  );
  must(
    'apps/api/src/care-reminders/care-reminder-worker.service.ts',
    "status: 'ACTIVE',\n        expiresAt: { lte: now },",
    'H5 housekeeping targets only ACTIVE links past expiry',
  );
  must(
    'apps/api/src/care-reminders/care-reminder-worker.service.ts',
    'expiredLinks: summary.expiredLinks,',
    'Worker run persists H5 expiry housekeeping metric',
  );
  must(
    'apps/api/src/admin-ops/admin-ops.service.ts',
    'expiredLinks: metrics24h._sum.expiredLinks ?? 0,',
    'Admin ops aggregates 24h H5 expiry housekeeping metric',
  );
  must(
    'apps/web/src/pages/AdminOpsPage.tsx',
    'label="自动收敛过期链接"',
    'Admin ops page displays automatic H5 expiry convergence',
  );
  must(
    'apps/web/src/pages/AdminOpsPage.tsx',
    'label="待分配患者"',
    'Admin ops page treats unassigned patients as a queue state',
  );
  must(
    'apps/api/prisma/seed-all.js',
    "where: { id: 'demo-med-101' }",
    'Seed creates demo-med-101 medication master',
  );
  must(
    'apps/api/prisma/seed-all.js',
    'sourceId: demoMedication101.id,',
    'Seed binds demo-care-sched-101-med to medication master',
  );
  must(
    'apps/api/prisma/migrations/20260609170000_trial_stabilization_v8_1/migration.sql',
    'ADD COLUMN "expiredLinks" INTEGER NOT NULL DEFAULT 0;',
    'Additive migration exists',
  );
  for (const relative of [
    'apps/api/prisma/repair-trial-stabilization-v8-1.js',
    'apps/api/prisma/check-trial-stabilization-v8-1.js',
    'apps/api/prisma/smoke-trial-stabilization-v8-1.js',
  ]) {
    if (!fs.existsSync(path.join(root, relative))) throw new Error(`missing ${relative}`);
  }
  console.log('[PASS] repair / check / smoke scripts installed');
  console.log('\n[PASS] trial-stabilization-v8.1 static assertions succeeded');
}

try {
  main();
} catch (error) {
  console.error('\n[FAIL]', error.message || error);
  process.exitCode = 1;
}
