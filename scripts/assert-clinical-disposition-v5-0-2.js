#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modulePath = path.join(root, 'apps/api/src/patient-app/patient-app.module.ts');
const source = fs.readFileSync(modulePath, 'utf8');

function expect(condition, message) {
  if (!condition) {
    console.error(`[fail] ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[ok] ${message}`);
}

expect(
  source.includes("import { ClinicalDispositionModule } from '../clinical-disposition/clinical-disposition.module';"),
  'PatientAppModule imports ClinicalDispositionModule',
);
expect(
  /imports:\s*\[[\s\S]*ClinicalDispositionModule[\s\S]*\]/m.test(source),
  'PatientAppModule registers ClinicalDispositionModule in @Module imports',
);
for (const provider of ['VitalRecordsService', 'MedicationsService', 'QuestionnairesService']) {
  expect(source.includes(provider), `PatientAppModule still provides ${provider}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log('[done] clinical disposition v5.0.2 DI assertions passed.');
