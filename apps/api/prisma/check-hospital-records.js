#!/usr/bin/env node
/*
 * Diagnostic: hospital records (院内病历) + gateway audit trail
 *
 * Run from apps/api:
 *   node prisma/check-hospital-records.js
 *
 * Doesn't write anything. Verifies the full gateway → business chain:
 *
 *   IntegrationSyncBatch ─→ IntegrationSyncRecord ─→ EncounterRecord
 *                                                ├─→ MedicalRecordSummary
 *                                                ├─→ ExamReportRecord
 *                                                └─→ HospitalMedicationOrder
 *
 * If the seed's gateway flow worked, you should see:
 *   - 42 audit rows under source GATEWAY_HIS_EVENT_REST, all promotionStatus=PROMOTED
 *   - 4 distinct externalRecordType values
 *   - every audit row's localTargetId points to a real business row
 *
 * If counts look right here but UI still shows "(0)": the bug is in the API
 * route / auth / frontend cache. Open DevTools → Network and inspect the four
 * /patients/<id>/(encounter-records|medical-record-summaries|exam-reports|
 * hospital-medications) requests.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== Hospital records diagnostic (gateway-aware) ===\n');

  // ─── Total counts ─────────────────────────────────────────────────────
  const [encTotal, medTotal, examTotal, rxTotal, patientTotal, auditTotal, batchTotal] =
    await Promise.all([
      prisma.encounterRecord.count(),
      prisma.medicalRecordSummary.count(),
      prisma.examReportRecord.count(),
      prisma.hospitalMedicationOrder.count(),
      prisma.patient.count(),
      prisma.integrationSyncRecord.count(),
      prisma.integrationSyncBatch.count(),
    ]);

  console.log(`Patient total:                       ${patientTotal}`);
  console.log(`EncounterRecord (就诊记录):          ${encTotal}`);
  console.log(`MedicalRecordSummary (病历摘要):     ${medTotal}`);
  console.log(`ExamReportRecord (检查报告):         ${examTotal}`);
  console.log(`HospitalMedicationOrder (院内处方):  ${rxTotal}`);
  console.log(`IntegrationSyncBatch (审计批次):     ${batchTotal}`);
  console.log(`IntegrationSyncRecord (审计行):      ${auditTotal}`);
  console.log('');

  if (encTotal === 0 && medTotal === 0 && examTotal === 0 && rxTotal === 0) {
    console.warn('⚠ All four hospital-record tables are empty.');
    console.warn('  → The gateway-driven seed did NOT persist this data.');
    console.warn('  → Re-run:  node prisma/seed-all.js');
    console.warn('  → Look for "✗ ... FAILED" lines in the seed output.\n');
  }

  // ─── Gateway audit trail breakdown ────────────────────────────────────
  const gatewaySource = await prisma.integrationSource.findUnique({
    where: { code: 'GATEWAY_HIS_EVENT_REST' },
  });

  if (!gatewaySource) {
    console.warn('⚠ IntegrationSource code=GATEWAY_HIS_EVENT_REST not found.');
    console.warn('  → seedHospitalRecordsViaGateway() never ran, or the upsert failed.\n');
  } else {
    console.log(`Gateway source:  ${gatewaySource.name}  (autoPromote=${gatewaySource.autoPromote})`);
    const auditByType = await prisma.integrationSyncRecord.groupBy({
      by: ['externalRecordType', 'promotionStatus'],
      where: { sourceId: gatewaySource.id },
      _count: { _all: true },
    });
    if (auditByType.length === 0) {
      console.warn('  ⚠ No audit rows under this source yet.\n');
    } else {
      console.log('  externalRecordType    promotionStatus  count');
      console.log('  ' + '─'.repeat(46));
      for (const row of auditByType) {
        console.log(
          `  ${row.externalRecordType.padEnd(20)}  ${row.promotionStatus.padEnd(14)}  ${row._count._all}`,
        );
      }
      console.log('');
    }
  }

  // ─── Per-demo-patient breakdown ───────────────────────────────────────
  const demoPatientIds = [
    'demo-patient-001', 'demo-patient-002', 'demo-patient-003',
    'demo-patient-004', 'demo-patient-005', 'demo-patient-006',
    'demo-patient-007', 'demo-patient-008', 'demo-patient-009',
    'demo-patient-010',
  ];

  console.log('Per-patient breakdown (demo patients):');
  console.log('  patientId            name        enc  medrec  exam  rx');
  console.log('  ' + '─'.repeat(58));
  for (const pid of demoPatientIds) {
    const [p, enc, med, exam, rx] = await Promise.all([
      prisma.patient.findUnique({ where: { id: pid }, select: { name: true } }),
      prisma.encounterRecord.count({ where: { patientId: pid } }),
      prisma.medicalRecordSummary.count({ where: { patientId: pid } }),
      prisma.examReportRecord.count({ where: { patientId: pid } }),
      prisma.hospitalMedicationOrder.count({ where: { patientId: pid } }),
    ]);
    const name = p ? p.name : '(not in DB)';
    console.log(
      `  ${pid}  ${name.padEnd(10)}  ${String(enc).padStart(3)}  ${String(med).padStart(6)}  ${String(exam).padStart(4)}  ${String(rx).padStart(2)}`,
    );
  }
  console.log('');

  // ─── Audit-to-business linkage spot-check ─────────────────────────────
  // Pick the latest audit row of each resource type and resolve its
  // localTargetId. If the business row is missing → broken promote chain.
  const resourceTypes = ['ENCOUNTER', 'DOCUMENT', 'EXAM_REPORT', 'MEDICATION'];
  const targetTables = {
    EncounterRecord: 'encounterRecord',
    MedicalRecordSummary: 'medicalRecordSummary',
    ExamReportRecord: 'examReportRecord',
    HospitalMedicationOrder: 'hospitalMedicationOrder',
  };

  console.log('Audit → business-row linkage spot-check:');
  for (const rt of resourceTypes) {
    const audit = await prisma.integrationSyncRecord.findFirst({
      where: {
        externalRecordType: rt,
        promotionStatus: 'PROMOTED',
        localTargetId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!audit) {
      console.log(`  - ${rt.padEnd(12)}: no PROMOTED audit row found`);
      continue;
    }
    const tn = targetTables[audit.localTargetType];
    const business = tn
      ? await prisma[tn].findUnique({ where: { id: audit.localTargetId } })
      : null;
    if (business) {
      console.log(
        `  ✓ ${rt.padEnd(12)}: audit ${audit.id.slice(0, 8)}... → ${audit.localTargetType}/${audit.localTargetId.slice(0, 16)}...  OK`,
      );
    } else {
      console.warn(
        `  ✗ ${rt.padEnd(12)}: audit ${audit.id} → ${audit.localTargetType}/${audit.localTargetId}  ORPHAN`,
      );
    }
  }
  console.log('');

  // ─── FK integrity: HMO → EncounterRecord ──────────────────────────────
  const ordersWithFk = await prisma.hospitalMedicationOrder.findMany({
    where: { encounterRecordId: { not: null } },
    select: { id: true, encounterRecordId: true },
  });
  let orphanCount = 0;
  for (const order of ordersWithFk) {
    const enc = await prisma.encounterRecord.findUnique({
      where: { id: order.encounterRecordId },
      select: { id: true },
    });
    if (!enc) {
      orphanCount += 1;
      console.warn(`  ⚠ Orphan HMO ${order.id} references missing encounter ${order.encounterRecordId}`);
    }
  }
  if (orphanCount === 0) {
    console.log(`FK integrity (HMO → Encounter):       ✓ ${ordersWithFk.length} all linked`);
  } else {
    console.warn(`FK integrity (HMO → Encounter):       ✗ ${orphanCount} orphans`);
  }
  console.log('');

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error('Diagnostic failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
