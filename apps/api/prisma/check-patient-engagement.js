// prisma/check-patient-engagement.js
//
// v2 patient-engagement diagnostic.
//   - per-tenant 服务号配置 (mask)
//   - per-tenant openId 数量
//   - 重要 demo patient 是否能收本院服务号

const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('========================================================');
    console.log('  patient-engagement hospital-wechat v2 diagnostic');
    console.log('========================================================');

    const tenants = await prisma.hospitalTenant.findMany({
      orderBy: { createdAt: 'asc' },
      include: { wechatOfficialAccount: true },
    });
    console.log(`\nHospitalTenant 总数: ${tenants.length}`);
    for (const t of tenants) {
      const acct = t.wechatOfficialAccount;
      const identCount = await prisma.patientWechatIdentity.count({
        where: { hospitalTenantId: t.id },
      });
      const patientCount = await prisma.patient.count({
        where: { hospitalTenantId: t.id },
      });
      console.log(`\n  · ${t.displayName || t.name}  (id=${t.id}  code=${t.code})`);
      console.log(`    患者总数:           ${patientCount}`);
      console.log(`    本院 openId 数:     ${identCount}`);
      if (acct) {
        const mask = (v) => (v ? v.slice(0, 4) + '****' + (v.length > 6 ? v.slice(-2) : '') : '-');
        console.log(`    服务号: ${acct.accountName || '(未命名)'}  appId=${mask(acct.appId)}`);
        console.log(`    enabled=${acct.isEnabled}  verified=${acct.isVerified}  templates=Q:${acct.templateQuestionnaireId || '-'} V:${acct.templateVitalId || '-'} M:${acct.templateMedicationId || '-'} H:${acct.templateHospitalVisitId || '-'}`);
        console.log(`    最近 token 刷新:    ${acct.lastTokenRefreshAt ? acct.lastTokenRefreshAt.toISOString() : '-'}`);
      } else {
        console.log(`    [warn] 该医院尚未配置本院微信服务号 (HospitalWechatOfficialAccount 缺失)`);
      }
    }

    // demo patients
    const demoIds = ['demo-patient-001', 'demo-patient-002', 'demo-patient-003'];
    console.log(`\n--- demo patient × openId 检查 ---`);
    for (const pid of demoIds) {
      const p = await prisma.patient.findUnique({
        where: { id: pid },
        include: {
          hospitalTenant: { include: { wechatOfficialAccount: true } },
          wechatIdentities: true,
        },
      });
      if (!p) {
        console.log(`  ${pid}: (未找到)`);
        continue;
      }
      const tenantAcct = p.hospitalTenant?.wechatOfficialAccount;
      const matched = tenantAcct
        ? p.wechatIdentities.find(
            (i) =>
              i.hospitalTenantId === p.hospitalTenantId &&
              i.appId === tenantAcct.appId &&
              i.isVerified,
          )
        : null;
      console.log(
        `  ${pid}: 医院=${p.hospitalTenant?.displayName || p.hospitalTenant?.name || '-'} | ` +
          `本院 openId=${matched ? 'YES (' + matched.openId.slice(0, 8) + '****)' : 'NO'} | ` +
          `phone=${p.phone ? 'YES' : 'NO'}`,
      );
    }

    // global counts
    const formLinkCount = await prisma.patientFormLink.count();
    const messageCount = await prisma.patientOutboundMessage.count();
    const eventCount = await prisma.engagementEventLog.count();
    console.log(`\n--- 全局统计 ---`);
    console.log(`  PatientFormLink:        ${formLinkCount}`);
    console.log(`  PatientOutboundMessage: ${messageCount}`);
    console.log(`  EngagementEventLog:     ${eventCount}`);

    console.log('\n[ok] 诊断完成.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[err]', e);
  process.exit(1);
});
