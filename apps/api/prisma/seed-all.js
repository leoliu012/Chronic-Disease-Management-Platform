#!/usr/bin/env node
/*
 * Idempotent seed orchestrator for local demo / release verification.
 * Run from apps/api:
 *   node prisma/seed-all.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const prismaDir = __dirname;
const seedFiles = [
  'seed-auth.js',
  'seed-demo.js',
  'seed-clinical-rules.js',
  'seed-integrations.js',
];

function runSeed(file) {
  const fullPath = path.join(prismaDir, file);
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  Skipping ${file}: file not found`);
    return;
  }

  console.log(`\n▶ Running ${file}`);
  const result = spawnSync(process.execPath, [fullPath], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(`\n✖ ${file} failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

for (const file of seedFiles) {
  runSeed(file);
}

console.log('\n✅ All available demo seed scripts completed.');
