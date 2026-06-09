#!/usr/bin/env node
/* HTTP black-box smoke. Start API on localhost:3000 first. */
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();
const BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const suffix = crypto.randomBytes(4).toString('hex');
const cleanupPatientIds = [];
const cleanupTaskIds = [];
const cleanupBindingRequestIds = [];

async function request(method, route, token, body) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { data = await res.text(); }
  return { status: res.status, data };
}
function expect(condition, message) { if (!condition) throw new Error(message); }
async function login(username, password) {
  const res = await request('POST', '/auth/login', null, { username, password });
  expect(res.status === 201 || res.status === 200, `login ${username}: expected 2xx, got ${res.status}`);
  expect(res.data?.accessToken, `login ${username}: missing token`);
  return res.data;
}
async function expectHidden(method, route, token, body) {
  const res = await request(method, route, token, body);
  expect(res.status === 403 || res.status === 404, `${method} ${route}: expected 403/404, got ${res.status}`);
}
async function cleanup() {
  if (cleanupBindingRequestIds.length) await prisma.patientBindingRequest.deleteMany({ where: { id: { in: cleanupBindingRequestIds } } });
  if (cleanupTaskIds.length) await prisma.task.deleteMany({ where: { id: { in: cleanupTaskIds } } });
  if (cleanupPatientIds.length) await prisma.patient.deleteMany({ where: { id: { in: cleanupPatientIds } } });
}

async function main() {
  try {
  const nurse = await login('nurse', 'nurse123');
  const admin = await login('admin', 'admin123');
  const nurse2 = await login('nurse2', 'nurse123');
  expect(nurse.user.id !== nurse2.user.id, 'demo nurses must have distinct identities');
  expect(nurse.user.hospitalTenantId && nurse2.user.hospitalTenantId, 'demo nurses must have hospitalTenantId');
  expect(nurse.user.hospitalTenantId !== nurse2.user.hospitalTenantId, 'demo nurses must belong to different hospitals');

  await expectHidden('GET', '/patients/demo-patient-101', nurse.accessToken);
  await expectHidden('POST', '/patients/demo-patient-101/medications', nurse.accessToken, {});
  await expectHidden('POST', '/encounter-records', nurse.accessToken, {
    patientId: 'demo-patient-101', visitType: 'OUTPATIENT', visitTime: new Date().toISOString(),
  });

  const hospitalBPatient = await prisma.patient.findUnique({
    where: { id: 'demo-patient-101' },
    select: { hospitalPatientId: true },
  });
  expect(hospitalBPatient?.hospitalPatientId, 'hospital B smoke patient must have hospitalPatientId');
  const forgedHisLookup = await request(
    'GET',
    `/his/patients/barcode/${encodeURIComponent(hospitalBPatient.hospitalPatientId)}`,
    nurse.accessToken,
  );
  expect(forgedHisLookup.status === 200, `scoped HIS lookup expected 200 staged response, got ${forgedHisLookup.status}`);
  expect(forgedHisLookup.data?.interfaceStatus !== 'MATCHED_LOCAL_PATIENT', 'HIS barcode lookup leaked hospital B local patient');

  const crossTenantBinding = await prisma.patientBindingRequest.create({
    data: {
      demoOpenId: `acl-smoke-${suffix}`,
      patientId: 'demo-patient-101',
      hospitalPatientId: hospitalBPatient.hospitalPatientId,
      phone: '13800000101',
    },
  });
  cleanupBindingRequestIds.push(crossTenantBinding.id);
  const bindingList = await request('GET', '/patient-binding-requests', nurse.accessToken);
  expect(bindingList.status === 200, `binding list expected 200, got ${bindingList.status}`);
  expect(!(bindingList.data || []).some((item) => item.id === crossTenantBinding.id), 'binding review list leaked hospital B request');
  await expectHidden('PATCH', `/patient-binding-requests/${crossTenantBinding.id}/approve`, nurse.accessToken);

  await expectHidden('GET', '/chronic-leads', nurse.accessToken);
  const weakIdentityLookup = await request('POST', '/patient-app/identity/lookup', null, {
    demoOpenId: `acl-smoke-openid-${suffix}`,
    phone: '13800000001',
  });
  expect(weakIdentityLookup.status === 201 || weakIdentityLookup.status === 200, `weak public identity lookup expected 2xx, got ${weakIdentityLookup.status}`);
  expect(weakIdentityLookup.data?.reason === 'NEED_STRONGER_IDENTITY_PROOF', 'single-field public identity lookup was not rejected');

  const forgedDash = await request('GET', `/nurse-dashboard?nurseId=${encodeURIComponent(nurse2.user.id)}`, nurse.accessToken);
  expect(forgedDash.status === 200, `forged dashboard query should be ignored, got ${forgedDash.status}`);
  expect(forgedDash.data?.nurseId === nurse.user.id, 'dashboard used forged nurseId instead of authenticated user');
  expect(!(forgedDash.data?.myPatients || []).some((patient) => patient.id === 'demo-patient-101'), 'dashboard leaked hospital B patient');

  const forgedItems = await request('GET', `/work-items?nurseId=${encodeURIComponent(nurse2.user.id)}`, nurse.accessToken);
  expect(forgedItems.status === 200, `forged work-items query should be ignored, got ${forgedItems.status}`);
  expect(!(forgedItems.data?.items || []).some((item) => item.patient?.id === 'demo-patient-101'), 'work-items leaked hospital B patient');

  const tamperedCreate = await request('POST', '/patients', nurse.accessToken, {
    name: `访问域测试患者-${suffix}`,
    phone: '13900000000',
    hospitalTenantId: nurse2.user.hospitalTenantId,
    responsibleNurseId: nurse2.user.id,
  });
  expect(tamperedCreate.status === 201, `nurse create patient expected 201, got ${tamperedCreate.status}: ${JSON.stringify(tamperedCreate.data)}`);
  expect(tamperedCreate.data.hospitalTenantId === nurse.user.hospitalTenantId, 'non-admin forged hospitalTenantId was not ignored');
  expect(tamperedCreate.data.responsibleNurseId == null, 'new patient silently received a fallback/forged nurse');
  const unassignedId = tamperedCreate.data.id;
  cleanupPatientIds.push(unassignedId);
  const visiblePending = await request('GET', `/patients/${unassignedId}`, nurse.accessToken);
  expect(visiblePending.status === 200, 'same-hospital unassigned queue patient should be visible to nurse');
  await expectHidden('POST', `/patients/${unassignedId}/tasks`, nurse.accessToken, { title: 'must reject', type: 'ACL_SMOKE' });

  const adminPatientsDefault = await request('GET', '/patients', admin.accessToken);
  expect(adminPatientsDefault.status === 200, `admin default patient list expected 200, got ${adminPatientsDefault.status}`);
  expect(!(adminPatientsDefault.data || []).some((patient) => patient.id === 'demo-patient-101'), 'admin default list silently mixed hospital B patients');
  const adminPatientsTenantB = await request('GET', `/patients?hospitalTenantId=${encodeURIComponent(nurse2.user.hospitalTenantId)}`, admin.accessToken);
  expect(adminPatientsTenantB.status === 200, `admin explicit tenant list expected 200, got ${adminPatientsTenantB.status}`);
  expect((adminPatientsTenantB.data || []).some((patient) => patient.id === 'demo-patient-101'), 'admin explicit tenant selection did not expose hospital B patient');
  const tenantSwitchAuditCount = await prisma.auditLog.count({ where: { operatorId: admin.user.id, action: 'ADMIN_TENANT_SCOPE_SELECTED', targetType: 'HospitalTenant', targetId: nurse2.user.hospitalTenantId } });
  expect(tenantSwitchAuditCount > 0, 'admin explicit tenant switch did not create audit record');

  const adminRead = await request('GET', '/patients/demo-patient-101', admin.accessToken);
  expect(adminRead.status === 200, `admin cross-tenant read expected 200, got ${adminRead.status}`);
  const adminTask = await request('POST', '/patients/demo-patient-101/tasks', admin.accessToken, { title: `ACL smoke ${suffix}`, type: 'ACL_SMOKE' });
  expect(adminTask.status === 201, `admin cross-tenant write expected 201, got ${adminTask.status}: ${JSON.stringify(adminTask.data)}`);
  cleanupTaskIds.push(adminTask.data.id);
  const auditCount = await prisma.auditLog.count({ where: { operatorId: admin.user.id, action: 'ADMIN_CROSS_TENANT_WRITE', targetType: 'Patient', targetId: 'demo-patient-101' } });
  expect(auditCount > 0, 'admin cross-tenant write did not create audit record');

  console.log('[ok] hospital A nurse cannot read/write hospital B patient');
  console.log('[ok] HIS lookup and binding-review surfaces do not leak hospital B patient data');
  console.log('[ok] unmapped ChronicLead staff surface fails closed and public identity lookup requires two factors');
  console.log('[ok] forged nurseId query is ignored by dashboard and work-items');
  console.log('[ok] forged hospital/assignee values are ignored; new patient enters pending allocation queue');
  console.log('[ok] nurse can read but cannot modify an unassigned queue patient');
  console.log('[ok] admin list defaults to own hospital; explicit tenant switch and cross-tenant writes are audited');
} finally {
  await cleanup();
}
}

main()
  .catch((error) => { console.error('[err]', error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
