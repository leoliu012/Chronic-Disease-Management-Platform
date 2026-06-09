#!/usr/bin/env python3
"""
apply_patient_engagement_seed.py
---------------------------------
Idempotent patcher for apps/api/prisma/seed-all.js.

Adds:
  * seedPatientEngagement()                  — HospitalTenant + identities + sample links/messages
  * Call inside main()                       — runs after seedClinicalDemo()

Safe to run multiple times.
"""
from __future__ import annotations

import sys
from pathlib import Path

SEED = Path("apps/api/prisma/seed-all.js")

MARKER = "// patient-engagement-wechat-h5-v1 seed"

SEED_FUNCTION = """
// patient-engagement-wechat-h5-v1 seed
//
// 创建 demo HospitalTenant, 把现有 demo users/patients 归到该 tenant,
// 给前 2 个 patient 创建 PatientWechatIdentity (服务号已关注),
// 给若干 patient 创建 PatientFormLink + PatientOutboundMessage 演示数据。
async function seedPatientEngagement() {
  const cryptoLib = require('crypto');

  function tokenHashFor(token) {
    return cryptoLib.createHash('sha256').update(token, 'utf8').digest('hex');
  }

  const tenant = await prisma.hospitalTenant.upsert({
    where: { code: 'demo-hospital' },
    update: {
      name: '某某市人民医院慢病中心',
      displayName: '某某市人民医院 · 慢病管理中心',
      isActive: true,
    },
    create: {
      id: 'demo-tenant-001',
      code: 'demo-hospital',
      name: '某某市人民医院慢病中心',
      displayName: '某某市人民医院 · 慢病管理中心',
      isActive: true,
    },
  });

  // Backfill users / patients that don't yet have a tenant.
  await prisma.user.updateMany({
    where: { hospitalTenantId: null },
    data: { hospitalTenantId: tenant.id },
  });
  await prisma.patient.updateMany({
    where: { hospitalTenantId: null },
    data: { hospitalTenantId: tenant.id },
  });

  const wechatIdentities = [
    { patientId: 'demo-patient-001', openId: 'demo-openid-wjg-001' },
    { patientId: 'demo-patient-002', openId: 'demo-openid-lxl-002' },
  ];
  for (const ident of wechatIdentities) {
    await prisma.patientWechatIdentity.upsert({
      where: { appId_openId: { appId: 'demo-platform-mp', openId: ident.openId } },
      update: { patientId: ident.patientId, isVerified: true, verifiedAt: new Date(), source: 'OFFICIAL_ACCOUNT_H5' },
      create: {
        patientId: ident.patientId,
        appId: 'demo-platform-mp',
        openId: ident.openId,
        source: 'OFFICIAL_ACCOUNT_H5',
        isVerified: true,
        verifiedAt: new Date(),
      },
    });
  }

  // Sample form links + matching outbound messages covering each state.
  const linkSeeds = [
    {
      id: 'demo-formlink-sent-001',
      patientId: 'demo-patient-003',
      type: 'QUESTIONNAIRE',
      title: '请填写本周血压管理问卷',
      status: 'ACTIVE',
      hoursToExpire: 72,
      submitCount: 0,
      tokenSeed: 'demo-formlink-sent-001-token',
      message: { channel: 'SMS', messageType: 'QUESTIONNAIRE_REMINDER', status: 'SENT', sentAtOffsetHours: -2 },
    },
    {
      id: 'demo-formlink-clicked-001',
      patientId: 'demo-patient-001',
      type: 'VITAL_RECHECK',
      title: '请提交本次血压复测',
      status: 'ACTIVE',
      hoursToExpire: 72,
      submitCount: 0,
      tokenSeed: 'demo-formlink-clicked-001-token',
      message: {
        channel: 'WECHAT_OFFICIAL_ACCOUNT',
        messageType: 'VITAL_RECHECK_REMINDER',
        status: 'CLICKED',
        sentAtOffsetHours: -6,
        clickedAtOffsetHours: -5,
      },
    },
    {
      id: 'demo-formlink-submitted-001',
      patientId: 'demo-patient-002',
      type: 'MEDICATION_CHECKIN',
      title: '请完成用药打卡',
      status: 'USED',
      hoursToExpire: 72,
      submitCount: 1,
      tokenSeed: 'demo-formlink-submitted-001-token',
      message: {
        channel: 'WECHAT_OFFICIAL_ACCOUNT',
        messageType: 'MEDICATION_REMINDER',
        status: 'SUBMITTED',
        sentAtOffsetHours: -10,
        clickedAtOffsetHours: -9,
        submittedAtOffsetHours: -9,
      },
    },
    {
      id: 'demo-formlink-failed-001',
      patientId: 'demo-patient-004',
      type: 'HOSPITAL_VISIT_CONFIRM',
      title: '请确认到院安排',
      status: 'ACTIVE',
      hoursToExpire: 72,
      submitCount: 0,
      tokenSeed: 'demo-formlink-failed-001-token',
      message: {
        channel: 'WECHAT_OFFICIAL_ACCOUNT',
        messageType: 'HOSPITAL_VISIT_REMINDER',
        status: 'FAILED',
        errorMessage: '患者尚未关注平台服务号 (没有 openId)',
        sentAtOffsetHours: -1,
      },
    },
    {
      id: 'demo-formlink-expired-001',
      patientId: 'demo-patient-005',
      type: 'QUESTIONNAIRE',
      title: '请填写慢阻肺症状问卷 (已过期)',
      status: 'EXPIRED',
      hoursToExpire: -2,
      submitCount: 0,
      tokenSeed: 'demo-formlink-expired-001-token',
      message: { channel: 'SMS', messageType: 'QUESTIONNAIRE_REMINDER', status: 'SENT', sentAtOffsetHours: -120 },
    },
  ];

  for (const seed of linkSeeds) {
    const expiresAt = new Date(Date.now() + seed.hoursToExpire * 3600 * 1000);
    const tokenHash = tokenHashFor(seed.tokenSeed);
    await prisma.patientFormLink.upsert({
      where: { id: seed.id },
      update: {
        status: seed.status,
        submitCount: seed.submitCount,
        usedAt: seed.submitCount > 0 ? new Date(Date.now() - 9 * 3600 * 1000) : null,
      },
      create: {
        id: seed.id,
        hospitalTenantId: tenant.id,
        patientId: seed.patientId,
        type: seed.type,
        tokenHash,
        title: seed.title,
        description: '演示数据：患者通过服务号 / 短信链接进入 H5 表单。',
        payload: seed.type === 'QUESTIONNAIRE'
          ? { questionnaireType: 'HYPERTENSION_FOLLOWUP' }
          : seed.type === 'VITAL_RECHECK'
            ? { vitalType: 'BLOOD_PRESSURE' }
            : seed.type === 'MEDICATION_CHECKIN'
              ? { medicationName: '苯磺酸氨氯地平', dosage: '5mg' }
              : { reason: '近期血压升高，建议门诊评估' },
        expiresAt,
        maxSubmit: 1,
        submitCount: seed.submitCount,
        status: seed.status,
        requiresIdentityCheck: seed.type !== 'QUESTIONNAIRE',
        createdBy: 'demo-care-nurse-a',
        usedAt: seed.submitCount > 0 ? new Date(Date.now() - 9 * 3600 * 1000) : null,
      },
    });

    const msg = seed.message;
    const msgId = `${seed.id}-message`;
    const sentAt = msg.sentAtOffsetHours !== undefined ? new Date(Date.now() + msg.sentAtOffsetHours * 3600 * 1000) : null;
    const clickedAt = msg.clickedAtOffsetHours !== undefined ? new Date(Date.now() + msg.clickedAtOffsetHours * 3600 * 1000) : null;
    const submittedAt = msg.submittedAtOffsetHours !== undefined ? new Date(Date.now() + msg.submittedAtOffsetHours * 3600 * 1000) : null;
    await prisma.patientOutboundMessage.upsert({
      where: { id: msgId },
      update: {
        status: msg.status,
        sentAt,
        clickedAt,
        submittedAt,
        errorMessage: msg.errorMessage ?? null,
      },
      create: {
        id: msgId,
        hospitalTenantId: tenant.id,
        patientId: seed.patientId,
        formLinkId: seed.id,
        channel: msg.channel,
        messageType: msg.messageType,
        title: seed.title,
        content: `${seed.title}\n（演示数据，dev 模式 mock 发送）`,
        linkUrl: `http://localhost:5173/wx/form/${seed.tokenSeed}`,
        status: msg.status,
        providerMessageId: msg.status === 'SENT' || msg.status === 'CLICKED' || msg.status === 'SUBMITTED' ? `demo-${msg.channel.toLowerCase()}-${seed.id}` : null,
        errorMessage: msg.errorMessage ?? null,
        sentAt,
        clickedAt,
        submittedAt,
        createdBy: 'demo-care-nurse-a',
        recipientMasked: msg.channel === 'SMS' ? '138****0003' : 'demo****-001',
      },
    });
  }

  console.log('Patient engagement demo seeded:');
  console.log(`- 1 demo HospitalTenant (${tenant.code})`);
  console.log('- 2 demo PatientWechatIdentity entries');
  console.log(`- ${linkSeeds.length} demo PatientFormLink rows (各种状态)`);
}
"""

CALL_LINE = "  await seedPatientEngagement();"
CALL_MARKER = "await seedClinicalDemo();"


def patch_seed() -> bool:
    if not SEED.exists():
        print(f"[skip] {SEED} not found.")
        return False
    src = SEED.read_text(encoding="utf-8")
    if MARKER in src:
        print("[skip] seed-all.js already patched.")
        return False
    # Insert the new function just before "async function main()".
    main_idx = src.find("async function main()")
    if main_idx == -1:
        print("[warn] couldn't locate `async function main()`; appending function at end.")
        src = src + SEED_FUNCTION + "\n"
    else:
        src = src[:main_idx] + SEED_FUNCTION + "\n" + src[main_idx:]

    # Insert the call inside main(), after seedClinicalDemo().
    call_idx = src.find(CALL_MARKER)
    if call_idx == -1:
        print("[warn] couldn't locate `await seedClinicalDemo()`; main() call not inserted.")
    else:
        end_of_line = src.find("\n", call_idx)
        src = src[: end_of_line + 1] + CALL_LINE + "\n" + src[end_of_line + 1 :]

    SEED.write_text(src, encoding="utf-8")
    print("[ok] seed-all.js patched.")
    return True


def main() -> int:
    patch_seed()
    return 0


if __name__ == "__main__":
    sys.exit(main())


