#!/usr/bin/env node
/*
 * One-command local demo initialization.
 * Run from apps/api:
 *   npm run demo:init
 */

const { spawnSync } = require('child_process');

function run(label, command) {
  console.log(`\n▶ ${label}`);
  console.log(`$ ${command}`);
  const result = spawnSync(command, {
    shell: true,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(`\n✖ ${label} failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

run('Apply Prisma migrations', 'npx prisma migrate dev');
run('Generate Prisma Client', 'npx prisma generate');
run('Seed all demo data', 'node prisma/seed-all.js');
run('Run doctor check', 'node scripts/doctor.js');

console.log('\n✅ Demo initialization completed. You can now run: npm run start:dev');
