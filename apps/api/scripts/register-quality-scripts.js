#!/usr/bin/env node
/*
 * Safely adds release-hardening npm scripts to apps/api/package.json.
 * This script merges into the existing package.json instead of replacing it.
 */

const fs = require('fs');
const path = require('path');

const apiRoot = path.resolve(__dirname, '..');
const packagePath = path.join(apiRoot, 'package.json');

const additions = {
  doctor: 'node scripts/doctor.js',
  'demo:init': 'node scripts/demo-init.js',
  smoke: 'node scripts/smoke.js',
  // gateway-promote-pipeline acceptance gate
  'smoke:gateway': 'node scripts/smoke-gateway.js',
  // 一次性同时跑业务流 + 网关流，作为每次 patch 之后固定的质量门槛
  'smoke:all': 'node scripts/smoke.js && node scripts/smoke-gateway.js',
  'seed:all': 'node prisma/seed-all.js',
  'quality:register': 'node scripts/register-quality-scripts.js',
};

function readPackageJson() {
  if (!fs.existsSync(packagePath)) {
    return {
      name: 'chronic-care-api',
      version: '0.0.0',
      private: true,
      scripts: {},
    };
  }

  return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
}

const pkg = readPackageJson();
pkg.scripts = pkg.scripts || {};

for (const [key, value] of Object.entries(additions)) {
  pkg.scripts[key] = value;
}

fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log('Updated apps/api/package.json scripts:');
for (const key of Object.keys(additions)) {
  console.log(`- ${key}: ${pkg.scripts[key]}`);
}
