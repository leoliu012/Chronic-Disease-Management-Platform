/*
 * Hospital integration center v1 seed.
 * Run from apps/api:
 *   node prisma/seed-integrations.js
 */
const { PrismaClient, IntegrationSystemType } = require('@prisma/client');

const prisma = new PrismaClient();

const sources = [
  {
    id: 'integration-source-his-demo',
    code: 'HIS_DEMO',
    name: 'HIS 患者主索引模拟接口',
    systemType: IntegrationSystemType.HIS,
    description: '模拟医院 HIS 患者基本信息、院内号和就诊卡信息同步。',
  },
  {
    id: 'integration-source-emr-demo',
    code: 'EMR_DEMO',
    name: 'EMR 诊断病历模拟接口',
    systemType: IntegrationSystemType.EMR,
    description: '模拟 EMR 诊断、慢病病程、并发症和合并症同步。',
  },
  {
    id: 'integration-source-lis-demo',
    code: 'LIS_DEMO',
    name: 'LIS 检验结果模拟接口',
    systemType: IntegrationSystemType.LIS,
    description: '模拟 LIS 血糖、血脂、血氧等关键慢病指标同步。',
  },
  {
    id: 'integration-source-pharmacy-demo',
    code: 'PHARMACY_DEMO',
    name: '药房处方模拟接口',
    systemType: IntegrationSystemType.PHARMACY,
    description: '模拟处方用药、剂量、频次和医嘱说明同步。',
  },
];

const mappings = [
  ['HIS_DEMO', 'Patient', 'PATIENT_ID', 'hospitalPatientId', '院内患者号', true],
  ['HIS_DEMO', 'Patient', 'PATIENT_NAME', 'name', '患者姓名', true],
  ['HIS_DEMO', 'Patient', 'GENDER_CODE', 'gender', '性别代码', false],
  ['HIS_DEMO', 'Patient', 'MOBILE_PHONE', 'phone', '手机号', false],
  ['HIS_DEMO', 'Patient', 'ID_CARD_NO', 'idCardNo', '身份证号', false],
  ['EMR_DEMO', 'DiseaseProfile', 'DIAGNOSIS_CODE', 'diseaseType', '慢病病种编码', true],
  ['EMR_DEMO', 'DiseaseProfile', 'DIAGNOSIS_DATE', 'diagnosisDate', '确诊日期', false],
  ['EMR_DEMO', 'DiseaseProfile', 'RISK_LEVEL', 'riskLevel', '风险等级', false],
  ['LIS_DEMO', 'VitalRecord', 'ITEM_CODE', 'type', '检验项目编码/指标类型', true],
  ['LIS_DEMO', 'VitalRecord', 'RESULT_VALUE', 'value', '检验结果数值', true],
  ['LIS_DEMO', 'VitalRecord', 'RESULT_UNIT', 'unit', '单位', true],
  ['LIS_DEMO', 'VitalRecord', 'REPORT_TIME', 'measuredAt', '报告时间', true],
  ['PHARMACY_DEMO', 'MedicationRecord', 'DRUG_NAME', 'medicationName', '药品名称', true],
  ['PHARMACY_DEMO', 'MedicationRecord', 'DOSAGE', 'dosage', '剂量', true],
  ['PHARMACY_DEMO', 'MedicationRecord', 'FREQUENCY', 'frequency', '频次', true],
];

async function main() {
  for (const source of sources) {
    await prisma.integrationSource.upsert({
      where: { code: source.code },
      update: {
        name: source.name,
        systemType: source.systemType,
        description: source.description,
        isEnabled: true,
      },
      create: source,
    });
  }

  for (const [sourceCode, targetModel, externalField, localField, displayName, isRequired] of mappings) {
    const source = await prisma.integrationSource.findUnique({ where: { code: sourceCode } });
    if (!source) continue;

    await prisma.integrationFieldMapping.upsert({
      where: {
        sourceId_targetModel_externalField: {
          sourceId: source.id,
          targetModel,
          externalField,
        },
      },
      update: {
        localField,
        displayName,
        isRequired,
        isActive: true,
      },
      create: {
        sourceId: source.id,
        targetModel,
        externalField,
        localField,
        displayName,
        isRequired,
        isActive: true,
      },
    });
  }

  console.log(`Integration sources seeded: ${sources.length}`);
  console.log(`Integration field mappings seeded: ${mappings.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
