#!/usr/bin/env node
/*
 * Unified Clinical Demo Seed
 *
 * Single source of truth for local development data.
 * Run from apps/api:
 *   node prisma/seed-all.js
 *
 * This file intentionally combines what used to be separate seed-auth,
 * seed-clinical-rules, seed-integrations, and seed-demo scripts so the demo
 * database always matches the current workflow being tested.
 *
 * v3 (patient-self-consent-bind / patient-prestart-gate):
 *   - 增加 ChronicLead 高危慢病线索池 demo 数据：覆盖 PENDING_REVIEW / CONTACTED /
 *     DEFERRED / SIGNED / REJECTED / EXPIRED 全状态机，供护士工作台「高危线索」页面
 *     以及小程序 /patient-app/identity/lookup 邀约库匹配演示。
 *   - 增加 PatientConsent 知情同意书演示记录：对应已有的 demo-binding-approved-001
 *     (EXISTING_PATIENT 路径) 和 demo-binding-pending-001 (CHRONIC_LEAD 路径)，
 *     保证患者绑定流程的「已签同意书」前置态可被复现和审计。
 */

const {
  PrismaClient,
  ClinicalRuleLifecycleStatus,
  DiseaseType,
  Gender,
  IntegrationSystemType,
  LeadConsentSource,
  LeadSourceChannel,
  LeadStatus,
  PatientConsentSource,
  PatientConsentStatus,
  RiskLevel,
  UserRole,
} = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

function hashPassword(password, salt) {
  const hash = crypto
    .pbkdf2Sync(password, salt, 120000, 32, 'sha256')
    .toString('hex');

  return `${salt}:${hash}`;
}

const authDemoUsers = [
  {
    id: 'admin-001',
    username: 'admin',
    password: 'admin123',
    displayName: '系统管理员',
    role: UserRole.ADMIN,
  },
  {
    id: 'doctor-001',
    username: 'doctor',
    password: 'doctor123',
    displayName: '王医生',
    role: UserRole.DOCTOR,
  },
  {
    id: 'demo-care-nurse-a',
    username: 'nurse',
    password: 'nurse123',
    displayName: '李护士长',
    role: UserRole.NURSE,
  },
  {
    id: 'manager-001',
    username: 'manager',
    password: 'manager123',
    displayName: '慢病中心主任',
    role: UserRole.MANAGER,
  },
  // patient_engagement_hospital_wechat_v2_1: second-tenant nurse for cross-tenant smoke
  {
    id: 'nurse-002',
    username: 'nurse2',
    password: 'nurse123',
    displayName: '王护士 (示例三甲)',
    role: UserRole.NURSE,
  },
];

async function seedAuth() {
  for (const user of authDemoUsers) {
    const salt = `auth-demo-v1-${user.username}`;
    const existingByUsername = await prisma.user.findUnique({
      where: { username: user.username },
      select: { id: true },
    });

    if (existingByUsername && existingByUsername.id !== user.id) {
      await prisma.user.update({
        where: { id: existingByUsername.id },
        data: {
          username: `${user.username}-legacy-${existingByUsername.id}`,
          isActive: false,
        },
      });
    }

    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        passwordHash: hashPassword(user.password, salt),
        isActive: true,
      },
      create: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        passwordHash: hashPassword(user.password, salt),
        isActive: true,
      },
    });
  }

  console.log('Auth/RBAC demo users seeded:');
  for (const user of authDemoUsers) {
    console.log(`- ${user.username} / ${user.password} (${user.role})`);
  }
}



/*
 * Clinical Rules/Templates v1 seed data.
 * Run from apps/api:
 *   node prisma/seed-clinical-rules.js
 */


const clinicalRuleTemplates = [
  {
    id: 'rule-template-hypertension-v1',
    diseaseType: DiseaseType.HYPERTENSION,
    templateName: '高血压分层管理模板',
    description: '家庭血压上传后的自动异常识别、风险分层和护士随访任务生成。',
    managementGoal: '识别收缩压/舒张压异常，优先处理高危和极高危患者。',
    riskBasis: '演示规则参考常见慢病管理阈值，正式上线时由医院按指南配置。',
    vitalThresholdRules: [
      ['thr-htn-sbp-vhigh', 'SYSTOLIC_BP', '血压（收缩压）', 'mmHg', 'GTE', 180, null, RiskLevel.VERY_HIGH, '血压极高危预警', '4 小时内电话复核，必要时建议急诊/门诊复诊。', 10],
      ['thr-htn-sbp-high', 'SYSTOLIC_BP', '血压（收缩压）', 'mmHg', 'GTE', 160, null, RiskLevel.HIGH, '血压高危预警', '24 小时内电话随访，提醒复测并核对用药。', 20],
      ['thr-htn-sbp-medium', 'SYSTOLIC_BP', '血压（收缩压）', 'mmHg', 'GTE', 140, null, RiskLevel.MEDIUM, '血压异常提醒', '3 日内提醒复测，持续异常则升级。', 30],
      ['thr-htn-dbp-vhigh', 'DIASTOLIC_BP', '血压（舒张压）', 'mmHg', 'GTE', 110, null, RiskLevel.VERY_HIGH, '血压极高危预警', '4 小时内电话复核，确认危险症状。', 40],
      ['thr-htn-dbp-high', 'DIASTOLIC_BP', '血压（舒张压）', 'mmHg', 'GTE', 100, null, RiskLevel.HIGH, '血压高危预警', '24 小时内电话随访，提醒复测并核对用药。', 50],
      ['thr-htn-dbp-medium', 'DIASTOLIC_BP', '血压（舒张压）', 'mmHg', 'GTE', 90, null, RiskLevel.MEDIUM, '血压异常提醒', '3 日内提醒复测。', 60],
    ],
    followUpPolicies: [
      ['fup-htn-vhigh', RiskLevel.VERY_HIGH, '紧急电话复核', 4, '立即复核，必要时转诊/急诊。', '立即复核：高血压极高危指标', '确认症状、复测数据、近期用药和是否需要急诊处理。'],
      ['fup-htn-high', RiskLevel.HIGH, '当日电话随访', 24, '当日随访并要求患者复测。', '今日随访：高血压高危指标', '确认复测值、用药依从性和生活方式诱因。'],
      ['fup-htn-medium', RiskLevel.MEDIUM, '异常复测提醒', 72, '3 日内复测，持续异常时升级。', '异常复测随访：血压异常', '提醒规范测量并观察连续 3 日趋势。'],
    ],
    questionnaires: [['q-htn-monthly', 'HYPERTENSION_MONTHLY', '高血压月度随访问卷', '记录头痛、头晕、胸闷、服药和家庭血压趋势。']],
  },
  {
    id: 'rule-template-diabetes-v1',
    diseaseType: DiseaseType.TYPE_2_DIABETES,
    templateName: '2 型糖尿病分层管理模板',
    description: '血糖上传后的自动异常识别、低血糖/高血糖预警和随访安排。',
    managementGoal: '识别血糖明显升高、低血糖风险和持续控制不佳患者。',
    riskBasis: '演示规则参考慢病随访常用阈值。',
    vitalThresholdRules: [
      ['thr-dm-glu-vhigh', 'BLOOD_GLUCOSE', '血糖', 'mmol/L', 'GTE', 16.7, null, RiskLevel.VERY_HIGH, '血糖极高危预警', '4 小时内复核，评估是否需要就医。', 10],
      ['thr-dm-glu-high', 'BLOOD_GLUCOSE', '血糖', 'mmol/L', 'GTE', 11.1, null, RiskLevel.HIGH, '血糖高危预警', '24 小时内随访饮食、用药和复测情况。', 20],
      ['thr-dm-glu-medium', 'BLOOD_GLUCOSE', '血糖', 'mmol/L', 'GTE', 7.0, null, RiskLevel.MEDIUM, '血糖异常提醒', '3 日内提醒复测并记录饮食。', 30],
      ['thr-dm-glu-low', 'BLOOD_GLUCOSE', '血糖', 'mmol/L', 'LT', 3.9, null, RiskLevel.HIGH, '低血糖风险预警', '当日联系患者，确认是否已补糖。', 40],
    ],
    followUpPolicies: [
      ['fup-dm-vhigh', RiskLevel.VERY_HIGH, '紧急电话复核', 4, '立即复核症状和酮症风险。', '立即复核：糖尿病极高危血糖', '确认多饮、多尿、恶心、乏力等症状和近期用药。'],
      ['fup-dm-high', RiskLevel.HIGH, '当日电话随访', 24, '当日随访并安排复测。', '今日随访：糖尿病高危血糖', '核对饮食、运动、服药和复测结果。'],
      ['fup-dm-medium', RiskLevel.MEDIUM, '复测提醒', 72, '3 日内复测。', '异常复测随访：血糖异常', '提醒记录空腹/餐后血糖并观察趋势。'],
    ],
    questionnaires: [['q-dm-monthly', 'DIABETES_MONTHLY', '糖尿病月度随访问卷', '记录低血糖、足部症状、饮食运动和服药情况。']],
  },
  {
    id: 'rule-template-copd-v1', diseaseType: DiseaseType.COPD, templateName: '慢阻肺急性加重风险模板', description: '血氧、心率和症状变化后的风险预警。', managementGoal: '识别低血氧和可能急性加重患者。', riskBasis: '演示规则用于慢阻肺院外监测场景。',
    vitalThresholdRules: [
      ['thr-copd-spo2-vhigh', 'SPO2', '血氧', '%', 'LT', 90, null, RiskLevel.VERY_HIGH, '血氧极高危预警', '4 小时内联系患者，确认呼吸困难程度。', 10],
      ['thr-copd-spo2-high', 'SPO2', '血氧', '%', 'LT', 95, null, RiskLevel.HIGH, '血氧异常预警', '24 小时内随访症状和吸入药使用。', 20],
      ['thr-copd-hr-high', 'HEART_RATE', '心率', 'bpm', 'GTE', 120, null, RiskLevel.HIGH, '慢阻肺心率高危预警', '24 小时内复核气促、发热和用药。', 30],
    ],
    followUpPolicies: [
      ['fup-copd-vhigh', RiskLevel.VERY_HIGH, '紧急电话复核', 4, '立即复核呼吸困难程度。', '立即复核：慢阻肺极高危指标', '确认血氧复测、呼吸困难、咳痰变化和是否需要就医。'],
      ['fup-copd-high', RiskLevel.HIGH, '当日电话随访', 24, '当日随访症状和吸入药使用。', '今日随访：慢阻肺高危指标', '确认血氧趋势、吸入药依从性和急性加重表现。'],
    ],
    questionnaires: [['q-copd-cat', 'COPD_CAT', '慢阻肺 CAT 症状评估', '记录咳嗽、咳痰、胸闷、活动耐量和睡眠影响。']],
  },
  {
    id: 'rule-template-chd-v1', diseaseType: DiseaseType.CORONARY_HEART_DISEASE, templateName: '冠心病二级预防模板', description: '冠心病患者血压、心率及胸痛相关随访。', managementGoal: '识别胸痛风险和二级预防管理异常。', riskBasis: '演示规则用于冠心病长期管理。',
    vitalThresholdRules: [
      ['thr-chd-hr-high', 'HEART_RATE', '心率', 'bpm', 'GTE', 120, null, RiskLevel.HIGH, '冠心病心率高危预警', '24 小时内确认胸闷胸痛和急救药使用。', 10],
      ['thr-chd-sbp-high', 'SYSTOLIC_BP', '血压（收缩压）', 'mmHg', 'GTE', 160, null, RiskLevel.HIGH, '冠心病合并血压高危预警', '当日随访并建议复测。', 20],
    ],
    followUpPolicies: [['fup-chd-high', RiskLevel.HIGH, '当日电话随访', 24, '当日确认胸痛和二级预防用药。', '今日随访：冠心病风险指标', '确认胸闷胸痛、硝酸甘油使用和阿司匹林/他汀依从性。']],
    questionnaires: [['q-chd-monthly', 'CHD_MONTHLY', '冠心病月度随访问卷', '记录胸痛、活动耐量、急救药和二级预防用药。']],
  },
  {
    id: 'rule-template-hyperlipidemia-v1', diseaseType: DiseaseType.HYPERLIPIDEMIA, templateName: '高脂血症管理模板', description: '血脂异常、生活方式和用药依从性管理。', managementGoal: '跟踪血脂达标与动脉粥样硬化风险。', riskBasis: '演示版保留血脂指标接口，正式上线接入 LIS 后启用。',
    vitalThresholdRules: [['thr-lipid-ldl-high', 'LDL_C', '低密度脂蛋白胆固醇', 'mmol/L', 'GTE', 4.1, null, RiskLevel.HIGH, 'LDL-C 高危预警', '7 日内随访生活方式和他汀用药依从性。', 10]],
    followUpPolicies: [['fup-lipid-high', RiskLevel.HIGH, '用药依从性随访', 168, '7 日内随访。', '血脂异常随访：复核用药依从性', '确认他汀用药、不良反应和复查计划。']],
    questionnaires: [['q-lipid-lifestyle', 'LIPID_LIFESTYLE', '血脂生活方式问卷', '记录饮食、运动、体重和用药依从性。']],
  },
  {
    id: 'rule-template-obesity-v1', diseaseType: DiseaseType.OBESITY, templateName: '肥胖/代谢综合征管理模板', description: '体重、BMI、腰围和代谢综合征相关随访。', managementGoal: '跟踪体重趋势和生活方式干预效果。', riskBasis: '演示版先支持体重阈值，后续可接入 BMI/腰围。',
    vitalThresholdRules: [['thr-obesity-weight-high', 'WEIGHT', '体重', 'kg', 'GTE', 90, null, RiskLevel.MEDIUM, '体重管理异常提醒', '7 日内进行生活方式随访。', 10]],
    followUpPolicies: [['fup-obesity-medium', RiskLevel.MEDIUM, '生活方式随访', 168, '7 日内随访。', '生活方式随访：体重管理', '记录饮食、运动、睡眠和体重趋势。']],
    questionnaires: [['q-obesity-lifestyle', 'OBESITY_LIFESTYLE', '体重管理生活方式问卷', '记录饮食、运动、睡眠和体重变化。']],
  },
];

const questionnaireRuleDefaults = {
  HYPERTENSION_MONTHLY: {
    scoringRule: { maxScore: 20, fields: ['症状', '用药依从性', '复测情况'] },
    riskBands: [{ min: 0, max: 6, riskLevel: 'LOW' }, { min: 7, max: 13, riskLevel: 'MEDIUM' }, { min: 14, max: 20, riskLevel: 'HIGH' }],
  },
  DIABETES_MONTHLY: {
    scoringRule: { maxScore: 24, fields: ['低血糖', '足部症状', '用药依从性'] },
    riskBands: [{ min: 0, max: 8, riskLevel: 'LOW' }, { min: 9, max: 16, riskLevel: 'MEDIUM' }, { min: 17, max: 24, riskLevel: 'HIGH' }],
  },
  COPD_CAT: {
    scoringRule: { maxScore: 40, fields: ['咳嗽', '咳痰', '活动耐量'] },
    riskBands: [{ min: 0, max: 9, riskLevel: 'LOW' }, { min: 10, max: 20, riskLevel: 'MEDIUM' }, { min: 21, max: 40, riskLevel: 'HIGH' }],
  },
  CHD_MONTHLY: {
    scoringRule: { maxScore: 20, fields: ['胸痛', '活动耐量', '用药依从性'] },
    riskBands: [{ min: 0, max: 6, riskLevel: 'LOW' }, { min: 7, max: 13, riskLevel: 'MEDIUM' }, { min: 14, max: 20, riskLevel: 'HIGH' }],
  },
  LIPID_LIFESTYLE: {
    scoringRule: { maxScore: 16, fields: ['饮食', '运动', '用药依从性'] },
    riskBands: [{ min: 0, max: 5, riskLevel: 'LOW' }, { min: 6, max: 10, riskLevel: 'MEDIUM' }, { min: 11, max: 16, riskLevel: 'HIGH' }],
  },
  OBESITY_LIFESTYLE: {
    scoringRule: { maxScore: 20, fields: ['饮食', '运动', '睡眠', '体重变化'] },
    riskBands: [{ min: 0, max: 6, riskLevel: 'LOW' }, { min: 7, max: 13, riskLevel: 'MEDIUM' }, { min: 14, max: 20, riskLevel: 'HIGH' }],
  },
};

async function seedClinicalRules() {
  const now = new Date();
  for (const template of clinicalRuleTemplates) {
    let dbTemplate = await prisma.diseaseRuleTemplate.findUnique({
      where: { diseaseType_version: { diseaseType: template.diseaseType, version: 'v1' } },
    });
    if (!dbTemplate) {
      const existingEffective = await prisma.diseaseRuleTemplate.findFirst({
        where: {
          diseaseType: template.diseaseType,
          lifecycleStatus: ClinicalRuleLifecycleStatus.EFFECTIVE,
          isActive: true,
        },
        select: { id: true },
      });
      const shouldActivateSeed = !existingEffective;
      dbTemplate = await prisma.diseaseRuleTemplate.create({
        data: {
          id: template.id,
          diseaseType: template.diseaseType,
          templateName: template.templateName,
          description: template.description,
          managementGoal: template.managementGoal,
          riskBasis: template.riskBasis,
          evidenceBasis: template.riskBasis,
          version: 'v1',
          isActive: shouldActivateSeed,
          lifecycleStatus: shouldActivateSeed
            ? ClinicalRuleLifecycleStatus.EFFECTIVE
            : ClinicalRuleLifecycleStatus.DRAFT,
          effectiveFrom: shouldActivateSeed ? now : undefined,
          publishedAt: shouldActivateSeed ? now : undefined,
          publishedBy: shouldActivateSeed ? 'SYSTEM_SEED' : undefined,
        },
      });
    }

    // Released rule rows are immutable. Demo seeding is create-only: a rerun
    // may fill missing fixtures but must never rewrite a physician-reviewed
    // threshold, SLA, questionnaire score band, or active release state.
    for (const [id, vitalType, displayName, unit, operator, thresholdValue, thresholdValueMax, riskLevel, alertTitle, followUpAction, sortOrder] of template.vitalThresholdRules) {
      await prisma.vitalThresholdRule.upsert({
        where: { id },
        update: {},
        create: { id, templateId: dbTemplate.id, vitalType, displayName, unit, operator, thresholdValue, thresholdValueMax, riskLevel, alertTitle, alertDescription: followUpAction, followUpAction, sortOrder, isActive: true },
      });
    }

    for (const [id, riskLevel, followUpType, dueWithinHours, frequencyDescription, taskTitle, instruction] of template.followUpPolicies) {
      await prisma.followUpPolicy.upsert({
        where: { id },
        update: {},
        create: { id, templateId: dbTemplate.id, riskLevel, followUpType, dueWithinHours, frequencyDescription, taskTitle, instruction, isActive: true },
      });
    }

    for (const [id, questionnaireType, title, description] of template.questionnaires) {
      const config = questionnaireRuleDefaults[questionnaireType];
      if (!config) throw new Error(`Missing questionnaireRuleDefaults for ${questionnaireType}`);
      await prisma.questionnaireTemplate.upsert({
        where: { id },
        update: {},
        create: { id, templateId: dbTemplate.id, questionnaireType, title, description, scoringRule: config.scoringRule, riskBands: config.riskBands, isActive: true },
      });
    }
  }

  console.log(`Clinical rules seeded create-only: ${clinicalRuleTemplates.length} disease templates`);
}



/*
 * Hospital integration center v1 seed.
 * Run from apps/api:
 *   node prisma/seed-integrations.js
 */

const integrationSources = [
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

const integrationMappings = [
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

async function ensurePrimaryDemoTenant() {
  return prisma.hospitalTenant.upsert({
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
}

async function seedIntegrations() {
  const tenant = await ensurePrimaryDemoTenant();
  for (const source of integrationSources) {
    await prisma.integrationSource.upsert({
      where: {
        hospitalTenantId_code: {
          hospitalTenantId: tenant.id,
          code: source.code,
        },
      },
      update: {
        hospitalTenantId: tenant.id,
        name: source.name,
        systemType: source.systemType,
        description: source.description,
        isEnabled: true,
      },
      create: {
        ...source,
        hospitalTenantId: tenant.id,
      },
    });
  }

  for (const [sourceCode, targetModel, externalField, localField, displayName, isRequired] of integrationMappings) {
    const source = await prisma.integrationSource.findUnique({
      where: {
        hospitalTenantId_code: {
          hospitalTenantId: tenant.id,
          code: sourceCode,
        },
      },
    });
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

  console.log(`Integration sources seeded: ${integrationSources.length}`);
  console.log(`Integration field mappings seeded: ${integrationMappings.length}`);
}



/*
 * Clinical Demo v2 seed data for the smart chronic-disease platform.
 * Run from apps/api:
 *   node prisma/seed-demo.js
 *
 * Design goal: support current development testing, not just static screenshots.
 * It creates continuous vital trends, medication/vital check-ins, open tasks,
 * linked risk alerts, active hospital-visit reminders, and completed history.
 */


const nurseId = 'demo-care-nurse-a';
const doctorId = 'doctor-001';
const demoOpenId = 'demo-openid-patient-001';

// patient-self-consent-bind 流程当前生效的同意书版本号，需与
// apps/api/src/patient-app/patient-app.service.ts 中的 PATIENT_CONSENT_VERSION 一致。
const PATIENT_CONSENT_VERSION = '2026-05-24-v2';
const CONSENT_TEXT_SNAPSHOT =
  '《知情同意与隐私授权协议》(2026-05-24-v2)\n' +
  '本演示快照内容仅用于本地 demo，正式上线请由医院法务团队提供最终文本。\n' +
  '患者已知悉数据采集范围、使用目的、保存期限和撤回权利。';

function daysAgo(days, hour = 9, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function daysFromNow(days, hour = 9, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function yearsAgo(years, month = 0, day = 1) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years, month, day);
  d.setHours(0, 0, 0, 0);
  return d;
}

const demoPatients = [
  {
    id: 'demo-patient-001',
    hospitalPatientId: 'MZ20260519001',
    name: '王建国',
    gender: 'MALE',
    birthDate: yearsAgo(68, 2, 14),
    phone: '13800010001',
    idCardNo: '610102195803140011',
    address: '碑林区长乐坊社区',
    emergencyContactName: '王女士',
    emergencyContactPhone: '13900010001',
    responsibleDoctorId: doctorId,
    responsibleNurseId: nurseId,
  },
  {
    id: 'demo-patient-002',
    hospitalPatientId: 'MZ20260519002',
    name: '李秀兰',
    gender: 'FEMALE',
    birthDate: yearsAgo(63, 6, 8),
    phone: '13800010002',
    idCardNo: '610103196307080022',
    address: '雁塔区电子城社区',
    emergencyContactName: '李先生',
    emergencyContactPhone: '13900010002',
    responsibleDoctorId: doctorId,
    responsibleNurseId: nurseId,
  },
  {
    id: 'demo-patient-003',
    hospitalPatientId: 'MZ20260519003',
    name: '张德明',
    gender: 'MALE',
    birthDate: yearsAgo(72, 10, 22),
    phone: '13800010003',
    idCardNo: '610104195411220033',
    address: '莲湖区红庙坡社区',
    emergencyContactName: '张女士',
    emergencyContactPhone: '13900010003',
    responsibleDoctorId: doctorId,
    responsibleNurseId: nurseId,
  },
  {
    id: 'demo-patient-004',
    hospitalPatientId: 'MZ20260519004',
    name: '赵敏',
    gender: 'FEMALE',
    birthDate: yearsAgo(54, 4, 12),
    phone: '13800010004',
    idCardNo: '610105197204120044',
    address: '新城区太华路社区',
    emergencyContactName: '赵先生',
    emergencyContactPhone: '13900010004',
    responsibleDoctorId: doctorId,
    responsibleNurseId: nurseId,
  },
  {
    id: 'demo-patient-005',
    hospitalPatientId: 'MZ20260519005',
    name: '陈红',
    gender: 'FEMALE',
    birthDate: yearsAgo(59, 8, 3),
    phone: '13800010005',
    idCardNo: '610106196709030055',
    address: '灞桥区纺织城社区',
    emergencyContactName: '陈女士',
    emergencyContactPhone: '13900010005',
    responsibleDoctorId: doctorId,
    responsibleNurseId: nurseId,
  },
  {
    id: 'demo-patient-006',
    hospitalPatientId: 'MZ20260519006',
    name: '刘国强',
    gender: 'MALE',
    birthDate: yearsAgo(61, 1, 9),
    phone: '13800010006',
    idCardNo: '610107196501090066',
    address: '未央区凤城路社区',
    emergencyContactName: '刘女士',
    emergencyContactPhone: '13900010006',
    responsibleDoctorId: doctorId,
    responsibleNurseId: nurseId,
  },
  {
    id: 'demo-patient-007',
    hospitalPatientId: 'MZ20260519007',
    name: '周桂芳',
    gender: 'FEMALE',
    birthDate: yearsAgo(70, 11, 18),
    phone: '13800010007',
    idCardNo: '610108195612180077',
    address: '长安区韦曲社区',
    emergencyContactName: '周先生',
    emergencyContactPhone: '13900010007',
    responsibleDoctorId: doctorId,
    responsibleNurseId: nurseId,
  },
  {
    id: 'demo-patient-008',
    hospitalPatientId: 'MZ20260519008',
    name: '孙平',
    gender: 'MALE',
    birthDate: yearsAgo(49, 5, 26),
    phone: '13800010008',
    idCardNo: '610109197705260088',
    address: '高新区丈八社区',
    emergencyContactName: '孙女士',
    emergencyContactPhone: '13900010008',
    responsibleDoctorId: doctorId,
    responsibleNurseId: nurseId,
  },
  {
    id: 'demo-patient-009',
    hospitalPatientId: 'MZ20260519009',
    name: '吴爱民',
    gender: 'MALE',
    birthDate: yearsAgo(66, 9, 6),
    phone: '13800010009',
    idCardNo: '610110196010060099',
    address: '曲江新区芙蓉社区',
    emergencyContactName: '吴女士',
    emergencyContactPhone: '13900010009',
    responsibleDoctorId: doctorId,
    responsibleNurseId: nurseId,
  },
  {
    id: 'demo-patient-010',
    hospitalPatientId: 'MZ20260519010',
    name: '郑丽',
    gender: 'FEMALE',
    birthDate: yearsAgo(57, 3, 30),
    phone: '13800010010',
    idCardNo: '610111196903300100',
    address: '经开区明光路社区',
    emergencyContactName: '郑先生',
    emergencyContactPhone: '13900010010',
    responsibleDoctorId: doctorId,
    responsibleNurseId: nurseId,
  },
];

const profileSeeds = [
  ['demo-profile-001-a', 'demo-patient-001', 'HYPERTENSION', 'VERY_HIGH', '2级高血压，近 14 天晨间血压逐步升高', '高血压性心脏病风险', '高脂血症'],
  ['demo-profile-001-b', 'demo-patient-001', 'HYPERLIPIDEMIA', 'MEDIUM', 'LDL-C 控制一般', '', '高血压'],
  ['demo-profile-002-a', 'demo-patient-002', 'TYPE_2_DIABETES', 'VERY_HIGH', '2型糖尿病病程 11 年，近期空腹血糖持续偏高', '糖尿病周围神经病变风险', '高血压'],
  ['demo-profile-003-a', 'demo-patient-003', 'COPD', 'HIGH', '慢阻肺稳定期，近 1 周血氧下降', '急性加重风险', '冠心病'],
  ['demo-profile-004-a', 'demo-patient-004', 'OBESITY', 'MEDIUM', 'BMI 偏高，生活方式干预中', '', '高脂血症'],
  ['demo-profile-005-a', 'demo-patient-005', 'CORONARY_HEART_DISEASE', 'HIGH', '冠心病二级预防随访', '胸闷症状需跟踪', '高血压'],
  ['demo-profile-006-a', 'demo-patient-006', 'HYPERTENSION', 'MEDIUM', '1级高血压，规律用药', '', '肥胖'],
  ['demo-profile-007-a', 'demo-patient-007', 'TYPE_2_DIABETES', 'MEDIUM', '口服降糖药治疗中', '', '高脂血症'],
  ['demo-profile-008-a', 'demo-patient-008', 'HYPERLIPIDEMIA', 'LOW', '血脂异常，门诊随访', '', '肥胖'],
  ['demo-profile-009-a', 'demo-patient-009', 'HYPERTENSION', 'LOW', '血压总体平稳', '', ''],
  ['demo-profile-010-a', 'demo-patient-010', 'COPD', 'MEDIUM', '慢阻肺稳定期管理', '', ''],
];

const planSeeds = [
  {
    id: 'demo-vital-plan-001-bp', patientId: 'demo-patient-001', vitalType: 'BLOOD_PRESSURE', displayName: '血压（收缩压/舒张压）', unit: 'mmHg', frequencyUnit: 'DAY', timesPerUnit: 2, customMeasureTimes: ['07:30', '19:30'], sourcePreset: 'HYPERTENSION', evidenceBasis: '高血压患者早晚各 1 次家庭血压监测。', lastCheckInAt: daysAgo(0, 7, 35),
  },
  {
    id: 'demo-vital-plan-002-glu', patientId: 'demo-patient-002', vitalType: 'BLOOD_GLUCOSE', displayName: '血糖', unit: 'mmol/L', frequencyUnit: 'DAY', timesPerUnit: 2, customMeasureTimes: ['07:00', '21:00'], sourcePreset: 'TYPE_2_DIABETES', evidenceBasis: '极高危糖尿病患者需加密血糖监测。', lastCheckInAt: daysAgo(0, 7, 15),
  },
  {
    id: 'demo-vital-plan-003-spo2', patientId: 'demo-patient-003', vitalType: 'SPO2', displayName: '血氧', unit: '%', frequencyUnit: 'DAY', timesPerUnit: 1, customMeasureTimes: ['09:00'], sourcePreset: 'COPD', evidenceBasis: '慢阻肺患者每日血氧监测，用于识别急性加重风险。', lastCheckInAt: daysAgo(0, 9, 10),
  },
  {
    id: 'demo-vital-plan-004-weight', patientId: 'demo-patient-004', vitalType: 'WEIGHT', displayName: '体重', unit: 'kg', frequencyUnit: 'DAY', timesPerUnit: 1, customMeasureTimes: ['08:00'], sourcePreset: 'OBESITY', evidenceBasis: '体重固定时间监测，观察生活方式干预趋势。', lastCheckInAt: daysAgo(0, 8, 0),
  },
  {
    id: 'demo-vital-plan-005-hr', patientId: 'demo-patient-005', vitalType: 'HEART_RATE', displayName: '心率', unit: 'bpm', frequencyUnit: 'DAY', timesPerUnit: 1, customMeasureTimes: ['20:00'], sourcePreset: 'CORONARY_HEART_DISEASE', evidenceBasis: '冠心病患者每日心率监测。', lastCheckInAt: daysAgo(0, 20, 0),
  },
  {
    id: 'demo-vital-plan-006-bp', patientId: 'demo-patient-006', vitalType: 'BLOOD_PRESSURE', displayName: '血压（收缩压/舒张压）', unit: 'mmHg', frequencyUnit: 'DAY', timesPerUnit: 1, customMeasureTimes: ['08:00'], sourcePreset: 'HYPERTENSION', evidenceBasis: '血压平稳患者每日 1 次家庭监测。', lastCheckInAt: daysAgo(0, 8, 10),
  },
  {
    id: 'demo-vital-plan-007-glu', patientId: 'demo-patient-007', vitalType: 'BLOOD_GLUCOSE', displayName: '血糖', unit: 'mmol/L', frequencyUnit: 'DAY', timesPerUnit: 1, customMeasureTimes: ['07:40'], sourcePreset: 'TYPE_2_DIABETES', evidenceBasis: '糖尿病稳定期每日空腹血糖监测。', lastCheckInAt: daysAgo(0, 7, 40),
  },
];

const medicationSeeds = [
  {
    id: 'demo-med-001', patientId: 'demo-patient-001', medicationName: '苯磺酸氨氯地平片', dosage: '5mg', frequency: '每日 1 次，饭后服用', frequencyUnit: 'DAY', timesPerUnit: 1, timingRelation: 'AFTER_MEAL', customDoseTimes: ['08:00'], instructions: '每日晨起后服用，注意监测血压。', lastCheckInAt: daysAgo(0, 8, 10),
  },
  {
    id: 'demo-med-002', patientId: 'demo-patient-002', medicationName: '二甲双胍片', dosage: '500mg', frequency: '每日 2 次，随餐服用', frequencyUnit: 'DAY', timesPerUnit: 2, timingRelation: 'WITH_MEAL', customDoseTimes: ['08:00', '18:00'], instructions: '随餐服用，如低血糖及时联系护士。', lastCheckInAt: daysAgo(0, 18, 10),
  },
  {
    id: 'demo-med-003', patientId: 'demo-patient-003', medicationName: '噻托溴铵吸入剂', dosage: '18μg', frequency: '每日 1 次', frequencyUnit: 'DAY', timesPerUnit: 1, timingRelation: 'NONE', customDoseTimes: ['09:00'], instructions: '按吸入装置规范使用。', lastCheckInAt: daysAgo(0, 9, 20),
  },
  {
    id: 'demo-med-004', patientId: 'demo-patient-005', medicationName: '阿司匹林肠溶片', dosage: '100mg', frequency: '每日 1 次，饭后服用', frequencyUnit: 'DAY', timesPerUnit: 1, timingRelation: 'AFTER_MEAL', customDoseTimes: ['20:00'], instructions: '如出现黑便、胃痛等需及时复诊。', lastCheckInAt: daysAgo(0, 20, 5),
  },
];

const vitalSeeds = [];

function addVital(id, patientId, type, value, unit, measuredAt, isAbnormal, monitoringPlanId, note) {
  vitalSeeds.push([id, patientId, type, value, unit, measuredAt, isAbnormal, monitoringPlanId, note]);
}

function addBloodPressurePair(baseId, patientId, systolic, diastolic, measuredAt, monitoringPlanId, note) {
  const isAbnormal = systolic >= 140 || systolic < 90 || diastolic >= 90 || diastolic < 60;
  addVital(`${baseId}-sbp`, patientId, 'SYSTOLIC_BP', systolic, 'mmHg', measuredAt, isAbnormal, monitoringPlanId, `${note}；收缩压。`);
  addVital(`${baseId}-dbp`, patientId, 'DIASTOLIC_BP', diastolic, 'mmHg', measuredAt, isAbnormal, monitoringPlanId, `${note}；舒张压。`);
}

function buildContinuousVitals() {
  const bpMorning = [132, 136, 138, 141, 145, 148, 150, 153, 157, 160, 166, 172, 184, 188];
  const bpMorningDbp = [78, 80, 82, 83, 85, 86, 88, 90, 92, 95, 97, 101, 106, 112];
  const bpEvening = [128, 130, 134, 136, 139, 142, 144, 148, 150, 154, 158, 160, 166, 170];
  const bpEveningDbp = [76, 78, 79, 80, 82, 84, 85, 87, 89, 91, 94, 96, 98, 100];

  bpMorning.forEach((sbp, index) => {
    const day = 13 - index;
    addBloodPressurePair(`demo-vital-p001-d${String(day).padStart(2, '0')}-am`, 'demo-patient-001', sbp, bpMorningDbp[index], daysAgo(day, 7, 35), 'demo-vital-plan-001-bp', '患者小程序晨间血压打卡');
    addBloodPressurePair(`demo-vital-p001-d${String(day).padStart(2, '0')}-pm`, 'demo-patient-001', bpEvening[index], bpEveningDbp[index], daysAgo(day, 19, 35), 'demo-vital-plan-001-bp', '患者小程序晚间血压打卡');
  });

  const fastingGlucose = [7.2, 7.5, 7.8, 8.1, 8.4, 8.8, 9.2, 9.7, 10.4, 11.2, 12.6, 13.8, 14.6, 15.8];
  const bedtimeGlucose = [8.0, 8.2, 8.6, 8.9, 9.3, 9.8, 10.5, 11.0, 11.4, 12.0, 12.8, 13.4, 13.0, 12.2];
  fastingGlucose.forEach((value, index) => {
    const day = 13 - index;
    addVital(`demo-vital-p002-d${String(day).padStart(2, '0')}-am-glu`, 'demo-patient-002', 'BLOOD_GLUCOSE', value, 'mmol/L', daysAgo(day, 7, 15), value >= 7.0 || value < 3.9, 'demo-vital-plan-002-glu', '患者小程序空腹血糖打卡。');
    addVital(`demo-vital-p002-d${String(day).padStart(2, '0')}-pm-glu`, 'demo-patient-002', 'BLOOD_GLUCOSE', bedtimeGlucose[index], 'mmol/L', daysAgo(day, 21, 10), bedtimeGlucose[index] >= 10.0, 'demo-vital-plan-002-glu', '患者小程序睡前血糖打卡。');
  });

  const spo2 = [97, 97, 96, 96, 95, 96, 95, 94, 95, 94, 93, 93, 92, 91];
  const heartRateForCopd = [82, 84, 83, 86, 88, 90, 92, 94, 96, 99, 102, 105, 108, 112];
  spo2.forEach((value, index) => {
    const day = 13 - index;
    addVital(`demo-vital-p003-d${String(day).padStart(2, '0')}-spo2`, 'demo-patient-003', 'SPO2', value, '%', daysAgo(day, 9, 10), value < 95, 'demo-vital-plan-003-spo2', '慢阻肺患者每日血氧打卡。');
    addVital(`demo-vital-p003-d${String(day).padStart(2, '0')}-hr`, 'demo-patient-003', 'HEART_RATE', heartRateForCopd[index], 'bpm', daysAgo(day, 9, 10), heartRateForCopd[index] >= 100, null, '同次测量心率。');
  });

  const weight = [80.1, 80.0, 79.8, 79.6, 79.5, 79.3, 79.2, 79.0, 78.9, 78.7, 78.6, 78.5, 78.4, 78.2];
  weight.forEach((value, index) => {
    const day = 13 - index;
    addVital(`demo-vital-p004-d${String(day).padStart(2, '0')}-weight`, 'demo-patient-004', 'WEIGHT', value, 'kg', daysAgo(day, 8, 0), false, 'demo-vital-plan-004-weight', '生活方式干预期间每日体重打卡。');
  });

  const chdHeartRate = [76, 78, 80, 82, 84, 86, 88, 90, 94, 96, 101, 104, 108, 116];
  chdHeartRate.forEach((value, index) => {
    const day = 13 - index;
    addVital(`demo-vital-p005-d${String(day).padStart(2, '0')}-hr`, 'demo-patient-005', 'HEART_RATE', value, 'bpm', daysAgo(day, 20, 0), value >= 100, 'demo-vital-plan-005-hr', '冠心病患者心率打卡。');
  });

  const stableSbp = [130, 128, 132, 131, 129, 130, 133, 132, 134, 131, 133, 132, 135, 132];
  const stableDbp = [78, 76, 79, 78, 77, 78, 80, 79, 81, 78, 80, 79, 82, 80];
  stableSbp.forEach((sbp, index) => {
    const day = 13 - index;
    addBloodPressurePair(`demo-vital-p006-d${String(day).padStart(2, '0')}`, 'demo-patient-006', sbp, stableDbp[index], daysAgo(day, 8, 10), 'demo-vital-plan-006-bp', '血压平稳患者每日监测');
  });

  const stableGlucose = [6.2, 6.4, 6.5, 6.3, 6.7, 6.6, 6.8, 6.5, 6.9, 6.7, 6.8, 6.6, 7.1, 6.8];
  stableGlucose.forEach((value, index) => {
    const day = 13 - index;
    addVital(`demo-vital-p007-d${String(day).padStart(2, '0')}-glu`, 'demo-patient-007', 'BLOOD_GLUCOSE', value, 'mmol/L', daysAgo(day, 7, 50), value >= 7.0, 'demo-vital-plan-007-glu', '糖尿病稳定期空腹血糖打卡。');
  });

  const ldlValues = [4.8, 4.6, 4.5, 4.4];
  ldlValues.forEach((value, index) => {
    const day = 28 - index * 7;
    addVital(`demo-vital-p008-week${index}-ldl`, 'demo-patient-008', 'LDL_C', value, 'mmol/L', daysAgo(day, 10, 20), value >= 4.1, null, 'LIS 模拟导入 LDL-C。');
  });
}

buildContinuousVitals();

const alertSeeds = [
  {
    id: 'demo-alert-001', patientId: 'demo-patient-001', riskType: 'VITAL_ABNORMAL', riskLevel: 'VERY_HIGH', title: '异常健康指标：血压', description: '血压 188/112 mmHg；收缩压 ≥ 180 mmHg 或舒张压 ≥ 110 mmHg，极高危。', triggerRule: '规则配置：高血压分层管理模板，收缩压 ≥ 180 mmHg 或舒张压 ≥ 110 mmHg，判定为极高危', sourceVitalRecordId: 'demo-vital-p001-d00-am-sbp', status: 'OPEN', createdAt: daysAgo(0, 7, 40),
  },
  {
    id: 'demo-alert-002', patientId: 'demo-patient-002', riskType: 'VITAL_ABNORMAL', riskLevel: 'HIGH', title: '异常健康指标：血糖', description: '空腹血糖 15.8 mmol/L，需今日电话随访并提醒复测。', triggerRule: '血糖 ≥ 11.1 mmol/L，高危', sourceVitalRecordId: 'demo-vital-p002-d00-am-glu', status: 'IN_PROGRESS', createdAt: daysAgo(0, 7, 20), handledBy: nurseId, handledAt: daysAgo(0, 8, 0), handlingNote: '护士已开始电话联系患者。',
  },
  {
    id: 'demo-alert-003', patientId: 'demo-patient-003', riskType: 'VITAL_ABNORMAL', riskLevel: 'HIGH', title: '异常健康指标：血氧', description: '血氧 91%；血氧 < 95%，异常。', triggerRule: '血氧 < 95%，异常', sourceVitalRecordId: 'demo-vital-p003-d00-spo2', status: 'OPEN', createdAt: daysAgo(3, 9, 15),
  },
  {
    id: 'demo-alert-004', patientId: 'demo-patient-005', riskType: 'SYMPTOM_REVIEW', riskLevel: 'MEDIUM', title: '胸闷症状复核', description: '患者问卷提示偶发胸闷，需要护士复核是否需要提前复诊。', triggerRule: '冠心病问卷胸闷症状阳性', sourceVitalRecordId: null, status: 'RESOLVED', createdAt: daysAgo(4, 10, 20), handledBy: nurseId, handledAt: daysAgo(3, 14, 30), handlingNote: '已完成电话随访，患者症状缓解。',
  },
  {
    id: 'demo-alert-005', patientId: 'demo-patient-005', riskType: 'VITAL_ABNORMAL', riskLevel: 'MEDIUM', title: '异常健康指标：心率', description: '心率 116 bpm，冠心病患者需复核胸闷胸痛。', triggerRule: '心率 ≥ 100 bpm，冠心病患者需复核', sourceVitalRecordId: 'demo-vital-p005-d00-hr', status: 'OPEN', createdAt: daysAgo(0, 20, 5),
  },
];

const taskSeeds = [
  { id: 'demo-task-001', patientId: 'demo-patient-001', title: '异常健康指标：血压', type: 'HOSPITAL_VISIT_FOLLOW_UP', status: 'PENDING', dueAt: daysFromNow(0, 12, 0), assigneeId: nurseId, relatedAlertId: 'demo-alert-001', createdAt: daysAgo(0, 7, 45) },
  { id: 'demo-task-002', patientId: 'demo-patient-002', title: '异常健康指标：血糖', type: 'RISK_ALERT_FOLLOW_UP', status: 'IN_PROGRESS', dueAt: daysFromNow(0, 17, 30), assigneeId: nurseId, relatedAlertId: 'demo-alert-002', createdAt: daysAgo(0, 7, 25) },
  { id: 'demo-task-003', patientId: 'demo-patient-003', title: '异常健康指标：血氧', type: 'HOSPITAL_VISIT_FOLLOW_UP', status: 'PENDING', dueAt: daysAgo(1, 16, 30), assigneeId: nurseId, relatedAlertId: 'demo-alert-003', createdAt: daysAgo(3, 9, 20) },
  { id: 'demo-task-004', patientId: 'demo-patient-004', title: '本周体重管理电话随访', type: 'FOLLOW_UP', status: 'PENDING', dueAt: daysFromNow(2, 10, 0), assigneeId: nurseId, relatedAlertId: null, createdAt: daysAgo(1, 13, 0) },
  { id: 'demo-task-005', patientId: 'demo-patient-005', title: '胸闷症状复核', type: 'RISK_ALERT_FOLLOW_UP', status: 'DONE', dueAt: daysAgo(3, 17, 0), assigneeId: nurseId, relatedAlertId: 'demo-alert-004', createdAt: daysAgo(4, 10, 30) },
  { id: 'demo-task-006', patientId: 'demo-patient-005', title: '异常健康指标：心率', type: 'RISK_ALERT_FOLLOW_UP', status: 'PENDING', dueAt: daysFromNow(0, 21, 30), assigneeId: nurseId, relatedAlertId: 'demo-alert-005', createdAt: daysAgo(0, 20, 10) },
  { id: 'demo-task-007', patientId: 'demo-patient-006', title: '血压平稳患者常规复核', type: 'FOLLOW_UP', status: 'DONE', dueAt: daysAgo(2, 15, 0), assigneeId: nurseId, relatedAlertId: null, createdAt: daysAgo(5, 9, 0) },
  { id: 'demo-task-008', patientId: 'demo-patient-007', title: '血糖接近阈值复测提醒', type: 'RECHECK_REMINDER', status: 'PENDING', dueAt: daysFromNow(1, 8, 0), assigneeId: nurseId, relatedAlertId: null, createdAt: daysAgo(0, 8, 0) },
];

const hospitalVisitReminderSeeds = [
  {
    id: 'demo-hospital-visit-001', patientId: 'demo-patient-001', sourceRiskAlertId: 'demo-alert-001', reason: '立即前往医院/门急诊评估：血压极高危', note: '患者端应显示强提示；护士端到院提醒中心仅提供查看详情入口。', status: 'ACTIVE', remindedBy: nurseId, remindedAt: daysAgo(0, 7, 46), createdAt: daysAgo(0, 7, 46),
  },
  {
    id: 'demo-hospital-visit-002', patientId: 'demo-patient-003', sourceRiskAlertId: 'demo-alert-003', reason: '立即前往医院/门急诊评估：血氧持续偏低', note: '已超过两天，可在对应到院提醒任务中测试未到院/拒绝到院按钮。', status: 'ACTIVE', remindedBy: nurseId, remindedAt: daysAgo(3, 9, 22), createdAt: daysAgo(3, 9, 22),
  },
  {
    id: 'demo-hospital-visit-003', patientId: 'demo-patient-005', sourceRiskAlertId: 'demo-alert-004', reason: '胸闷症状复核后建议门诊评估', note: '患者已到院，作为历史闭环样例。', status: 'ARRIVED', remindedBy: nurseId, remindedAt: daysAgo(4, 11, 0), arrivedAt: daysAgo(3, 9, 10), arrivalConfirmedBy: nurseId, outcomeNote: '患者已完成门诊评估，胸闷症状缓解。', createdAt: daysAgo(4, 11, 0),
  },
];

function buildMedicationCheckIns() {
  const checkIns = [];
  const add = (id, medicationId, patientId, taken, checkedAt, scheduledAt, note) => {
    checkIns.push({ id, medicationId, patientId, taken, checkedAt, scheduledAt, note });
  };

  for (let day = 13; day >= 0; day -= 1) {
    add(`demo-med-check-001-d${String(day).padStart(2, '0')}`, 'demo-med-001', 'demo-patient-001', day !== 5, daysAgo(day, 8, 10), daysAgo(day, 8, 0), day === 5 ? '当天漏服，护士已提醒。' : '已按时服药。');
    add(`demo-med-check-002-d${String(day).padStart(2, '0')}-am`, 'demo-med-002', 'demo-patient-002', true, daysAgo(day, 8, 12), daysAgo(day, 8, 0), '早餐随餐服药。');
    add(`demo-med-check-002-d${String(day).padStart(2, '0')}-pm`, 'demo-med-002', 'demo-patient-002', day !== 2, daysAgo(day, 18, 18), daysAgo(day, 18, 0), day === 2 ? '晚餐后忘记服药，已提醒。' : '晚餐随餐服药。');
    add(`demo-med-check-003-d${String(day).padStart(2, '0')}`, 'demo-med-003', 'demo-patient-003', true, daysAgo(day, 9, 20), daysAgo(day, 9, 0), '已完成吸入剂使用。');
    add(`demo-med-check-004-d${String(day).padStart(2, '0')}`, 'demo-med-004', 'demo-patient-005', true, daysAgo(day, 20, 5), daysAgo(day, 20, 0), '无不适。');
  }

  return checkIns;
}

const followUpSeeds = [
  { id: 'demo-followup-001', patientId: 'demo-patient-001', followUpType: 'PHONE', followUpTime: daysAgo(6, 15, 10), content: '询问家庭血压监测和服药情况。', result: '患者服药规律，但近两日晨间血压偏高。', suggestion: '继续早晚监测，若持续 ≥160 mmHg 建议提前复诊。', nextFollowUpTime: daysFromNow(1, 15, 30), operatorId: nurseId },
  { id: 'demo-followup-002', patientId: 'demo-patient-002', followUpType: 'WECHAT', followUpTime: daysAgo(5, 11, 0), content: '提醒患者完成血糖打卡和饮食记录。', result: '患者反馈晚餐后血糖偏高。', suggestion: '建议复测空腹血糖并记录饮食。', nextFollowUpTime: daysFromNow(0, 17, 30), operatorId: nurseId },
  { id: 'demo-followup-003', patientId: 'demo-patient-005', followUpType: 'PHONE', followUpTime: daysAgo(3, 14, 35), content: '复核胸闷症状。', result: '患者胸闷症状已缓解，无持续胸痛。', suggestion: '继续规律服药，如胸痛持续或加重立即就诊。', nextFollowUpTime: daysFromNow(7, 10, 0), operatorId: nurseId },
  { id: 'demo-followup-004', patientId: 'demo-patient-003', followUpType: 'PHONE', followUpTime: daysAgo(2, 10, 10), content: '复核血氧下降和气促症状。', result: '患者活动后气促，血氧复测仍偏低。', suggestion: '已提醒尽快到院评估。', nextFollowUpTime: daysFromNow(0, 10, 30), operatorId: nurseId },
];

const questionnaireSeeds = [
  { id: 'demo-questionnaire-001', patientId: 'demo-patient-001', questionnaireType: 'HYPERTENSION_MONTHLY', score: 8, riskLevel: 'HIGH', riskConclusion: '近期晨间血压偏高，建议护士复核。', answers: { headache: true, dizziness: true, medicationAdherence: 'good' }, dataSource: 'MINI_PROGRAM', createdAt: daysAgo(1, 20, 0) },
  { id: 'demo-questionnaire-002', patientId: 'demo-patient-002', questionnaireType: 'DIABETES_MONTHLY', score: 9, riskLevel: 'VERY_HIGH', riskConclusion: '血糖波动较明显，需今日电话随访。', answers: { thirst: true, hypoglycemia: false, medicationAdherence: 'missed_once' }, dataSource: 'MINI_PROGRAM', createdAt: daysAgo(0, 7, 10) },
  { id: 'demo-questionnaire-003', patientId: 'demo-patient-005', questionnaireType: 'CHD_MONTHLY', score: 5, riskLevel: 'MEDIUM', riskConclusion: '偶发胸闷，已电话复核。', answers: { chestTightness: true, persistentChestPain: false }, dataSource: 'MINI_PROGRAM', createdAt: daysAgo(4, 9, 0) },
  { id: 'demo-questionnaire-004', patientId: 'demo-patient-003', questionnaireType: 'COPD_CAT', score: 12, riskLevel: 'HIGH', riskConclusion: '咳痰与气促较前增加，需复核血氧趋势。', answers: { dyspnea: true, sputumIncrease: true, rescueInhaler: 'more_than_usual' }, dataSource: 'MINI_PROGRAM', createdAt: daysAgo(2, 8, 40) },
];

const bindingSeeds = [
  { id: 'demo-binding-approved-001', demoOpenId, patientId: 'demo-patient-001', hospitalPatientId: 'MZ20260519001', phone: '13800010001', idCardLast4: '0011', status: 'APPROVED', reviewedBy: nurseId, reviewedAt: daysAgo(7, 10, 0), createdAt: daysAgo(8, 9, 30) },
  { id: 'demo-binding-pending-001', demoOpenId: 'demo-openid-pending-001', patientId: 'demo-patient-002', hospitalPatientId: 'MZ20260519002', phone: '13800010002', idCardLast4: '0022', status: 'PENDING', createdAt: daysAgo(0, 10, 15) },
];

const sessionSeeds = [
  { id: 'demo-patient-session-001', demoOpenId, patientId: 'demo-patient-001', tokenHash: 'demo-token-hash-patient-001-do-not-use-in-prod', expiresAt: daysFromNow(30, 23, 59), lastUsedAt: daysAgo(0, 7, 35), createdAt: daysAgo(7, 10, 2) },
];

// ============================================================================
// ChronicLead 高危慢病线索池 demo 数据 (patient-prestart-gate)
//
// 覆盖全状态机，方便护士工作台「高危线索」页面和小程序绑定流程
// /patient-app/identity/lookup 的 CHRONIC_LEAD 分支演示。
//
// 注意:
//   - 这些线索使用的 hospitalPatientId / phone / idCardNo 故意与 demoPatients
//     不冲突，避免 lookup 时同一身份既命中 ChronicLead 又命中 Patient。
//   - demo-lead-signed-001 是唯一与 demoPatients 关联的线索 (promotedPatientId
//     = demo-patient-002)，演示"小程序签约 → 升档 → 等护士审核绑定申请"全链路。
// ============================================================================

const chronicLeadSeeds = [
  // (1) PENDING_REVIEW — 待邀约，HL7 出院信号，极高危高血压
  {
    id: 'demo-lead-pending-001',
    hospitalPatientId: 'MZ20260522101',
    phone: '13900020001',
    idCardNo: '610102195906151001',
    externalPatientId: 'HL7-PID-20260522-A101',
    name: '吴建华',
    gender: Gender.MALE,
    birthDate: yearsAgo(66, 5, 15),
    sourceChannel: LeadSourceChannel.HL7_DISCHARGE,
    sourceRecordId: 'HL7-DISCH-20260522-1041',
    sourceBatchId: 'GATEWAY-BATCH-20260522',
    suspectedDisease: DiseaseType.HYPERTENSION,
    diagnosisIcd: 'I10',
    diagnosisText: '原发性高血压（3级，极高危）',
    riskHint: RiskLevel.VERY_HIGH,
    evidenceSummary: '出院诊断 I10；住院期间最高血压 198/118 mmHg；建议立刻入组慢病管理。',
    status: LeadStatus.PENDING_REVIEW,
    hitCount: 1,
    lastSeenAt: daysAgo(2, 10, 41),
    createdAt: daysAgo(2, 10, 41),
  },
  // (2) PENDING_REVIEW — 待邀约，FHIR Observation，糖尿病高危
  {
    id: 'demo-lead-pending-002',
    hospitalPatientId: 'MZ20260522102',
    phone: '13900020002',
    idCardNo: '610105197207120015',
    externalPatientId: 'FHIR-PID-20260522-B215',
    name: '陈丽君',
    gender: Gender.FEMALE,
    birthDate: yearsAgo(53, 6, 12),
    sourceChannel: LeadSourceChannel.FHIR_OBSERVATION,
    sourceRecordId: 'FHIR-OBS-20260522-A715',
    sourceBatchId: 'GATEWAY-BATCH-20260522',
    suspectedDisease: DiseaseType.TYPE_2_DIABETES,
    diagnosisIcd: 'E11.9',
    diagnosisText: '2型糖尿病',
    riskHint: RiskLevel.HIGH,
    evidenceSummary: '门诊 HbA1c 8.6%；FHIR Observation 提示空腹血糖 9.8 mmol/L。',
    status: LeadStatus.PENDING_REVIEW,
    hitCount: 2,
    lastSeenAt: daysAgo(1, 14, 30),
    createdAt: daysAgo(1, 14, 30),
  },
  // (3) PENDING_REVIEW — 待邀约，来自中间库，慢阻肺高危
  {
    id: 'demo-lead-pending-003',
    hospitalPatientId: 'MZ20260523401',
    phone: '13900020005',
    idCardNo: '610104196301242088',
    name: '韩玉珍',
    gender: Gender.FEMALE,
    birthDate: yearsAgo(63, 0, 24),
    sourceChannel: LeadSourceChannel.INTERMEDIATE_DB,
    sourceRecordId: 'IDB-20260523-0211',
    sourceBatchId: 'INTERMEDIATE-POLL-20260523',
    suspectedDisease: DiseaseType.COPD,
    diagnosisIcd: 'J44.9',
    diagnosisText: '慢性阻塞性肺疾病',
    riskHint: RiskLevel.HIGH,
    evidenceSummary: '中间库导入：肺功能 FEV1/FVC 60%，建议入组血氧监测。',
    status: LeadStatus.PENDING_REVIEW,
    hitCount: 1,
    lastSeenAt: daysAgo(0, 9, 12),
    createdAt: daysAgo(0, 9, 12),
  },
  // (4) CONTACTED — 已联系，等待二次回访
  {
    id: 'demo-lead-contacted-001',
    hospitalPatientId: 'MZ20260518203',
    phone: '13900020003',
    idCardNo: '610103195811302001',
    name: '高志强',
    gender: Gender.MALE,
    birthDate: yearsAgo(67, 10, 30),
    sourceChannel: LeadSourceChannel.HIS_EVENT_DISCHARGE,
    sourceRecordId: 'HIS-EVT-DISCH-20260518-0319',
    suspectedDisease: DiseaseType.CORONARY_HEART_DISEASE,
    diagnosisIcd: 'I25.9',
    diagnosisText: '冠状动脉粥样硬化性心脏病（PCI 术后）',
    riskHint: RiskLevel.HIGH,
    evidenceSummary: '出院诊断 I25.9，PCI 术后一周；30 天内必须建立随访。',
    status: LeadStatus.CONTACTED,
    contactNote: '6 天前 17:30 电话联系成功，患者称需与家属商量，约定明日二次回访。',
    reviewedById: nurseId,
    reviewedAt: daysAgo(6, 17, 30),
    hitCount: 1,
    lastSeenAt: daysAgo(6, 17, 30),
    createdAt: daysAgo(6, 9, 0),
  },
  // (5) DEFERRED — 患者暂缓，30 天后回访
  {
    id: 'demo-lead-deferred-001',
    hospitalPatientId: 'MZ20260516301',
    phone: '13900020004',
    name: '田小英',
    gender: Gender.FEMALE,
    birthDate: yearsAgo(58, 2, 19),
    sourceChannel: LeadSourceChannel.HL7_OUTPATIENT,
    sourceRecordId: 'HL7-OPN-20260516-0701',
    suspectedDisease: DiseaseType.HYPERTENSION,
    diagnosisIcd: 'I10',
    diagnosisText: '原发性高血压（1级）',
    riskHint: RiskLevel.MEDIUM,
    evidenceSummary: '门诊血压 146/92 mmHg。',
    status: LeadStatus.DEFERRED,
    deferNote: '患者出差中，约定 30 天后回访。',
    reviewedById: nurseId,
    reviewedAt: daysAgo(8, 11, 15),
    hitCount: 1,
    lastSeenAt: daysAgo(8, 11, 15),
    createdAt: daysAgo(8, 11, 15),
  },
  // (6) SIGNED — 已升档为 demo-patient-002；对应 demo-binding-pending-001 的前史。
  //     故事：李秀兰最初是 HL7 出院线索 → 护士打电话邀约 → 患者扫码进小程序 →
  //          签知情同意书并提交绑定申请 → 后端同步创建 Patient/DiseaseProfile/
  //          入组随访任务 → 绑定申请进入护士审核队列（PENDING）。
  {
    id: 'demo-lead-signed-001',
    hospitalPatientId: 'MZ20260519002',
    idCardNo: '610103196307080022',
    phone: '13800010002',
    externalPatientId: 'HL7-PID-20260512-7822',
    name: '李秀兰',
    gender: Gender.FEMALE,
    birthDate: yearsAgo(63, 6, 8),
    sourceChannel: LeadSourceChannel.HL7_DISCHARGE,
    sourceRecordId: 'HL7-DISCH-20260512-0822',
    sourceBatchId: 'GATEWAY-BATCH-20260512',
    suspectedDisease: DiseaseType.TYPE_2_DIABETES,
    diagnosisIcd: 'E11.9',
    diagnosisText: '2型糖尿病（不伴有并发症）',
    riskHint: RiskLevel.HIGH,
    evidenceSummary: '出院诊断 E11.9；空腹血糖最高 13.2 mmol/L；HbA1c 9.4%。',
    status: LeadStatus.SIGNED,
    consentSource: LeadConsentSource.MINI_PROGRAM_SIGN,
    consentRef:
      'MINI_PROGRAM_BIND | consentId=demo-consent-002 | v' +
      PATIENT_CONSENT_VERSION +
      ' | openid=demo-openid-pending-001 | ip=203.0.113.88 | signedAt=' +
      daysAgo(0, 10, 10).toISOString(),
    reviewedById: nurseId,
    reviewedAt: daysAgo(0, 10, 10),
    promotedPatientId: 'demo-patient-002',
    promotedAt: daysAgo(0, 10, 10),
    hitCount: 2,
    lastSeenAt: daysAgo(0, 10, 10),
    createdAt: daysAgo(12, 9, 0),
  },
  // (7) REJECTED — 患者明确拒绝
  {
    id: 'demo-lead-rejected-001',
    hospitalPatientId: 'MZ20260510501',
    phone: '13900020006',
    name: '马卫国',
    gender: Gender.MALE,
    birthDate: yearsAgo(54, 7, 7),
    sourceChannel: LeadSourceChannel.HL7_ABNORMAL_OBSERVATION,
    sourceRecordId: 'HL7-OBX-20260510-1133',
    suspectedDisease: DiseaseType.HYPERLIPIDEMIA,
    diagnosisIcd: 'E78.5',
    diagnosisText: '高脂血症',
    riskHint: RiskLevel.MEDIUM,
    evidenceSummary: 'LDL-C 5.2 mmol/L；TG 3.8 mmol/L。',
    status: LeadStatus.REJECTED,
    rejectReason: '患者表示已在外院随访，无需入组。',
    reviewedById: nurseId,
    reviewedAt: daysAgo(13, 16, 0),
    hitCount: 1,
    lastSeenAt: daysAgo(14, 9, 0),
    createdAt: daysAgo(14, 9, 0),
  },
  // (8) EXPIRED — 30 天未处理，cron 自动清理
  {
    id: 'demo-lead-expired-001',
    hospitalPatientId: 'MZ20260420601',
    phone: '13900020007',
    name: '罗树森',
    gender: Gender.MALE,
    birthDate: yearsAgo(71, 4, 3),
    sourceChannel: LeadSourceChannel.MANUAL,
    suspectedDisease: DiseaseType.OBESITY,
    diagnosisText: '体重管理建议（BMI 32.4）',
    riskHint: RiskLevel.LOW,
    evidenceSummary: 'BMI 32.4；纳入肥胖管理建议。',
    status: LeadStatus.EXPIRED,
    hitCount: 1,
    lastSeenAt: daysAgo(34, 9, 0),
    createdAt: daysAgo(34, 9, 0),
  },
];

// ============================================================================
// PatientConsent 知情同意书 demo 数据 (patient-self-consent-bind)
//
// 当前生效的同意书版本为 PATIENT_CONSENT_VERSION (= 2026-05-24-v2)。
//
// 这两条 demo 同意书分别覆盖两条核心路径:
//   - demo-consent-001: EXISTING_PATIENT 路径 (王建国 8 天前签同意书 →
//                       绑定申请 → 护士审批通过 → 已有患者端会话)
//   - demo-consent-002: CHRONIC_LEAD 路径 (李秀兰今天签同意书 → 触发
//                       demo-lead-signed-001 升档 → 绑定申请待审)
// ============================================================================

const consentSeeds = [
  {
    id: 'demo-consent-001',
    demoOpenId,
    hospitalPatientId: 'MZ20260519001',
    chronicLeadId: null,
    patientId: 'demo-patient-001',
    bindingRequestId: 'demo-binding-approved-001',
    consentVersion: PATIENT_CONSENT_VERSION,
    consentSource: PatientConsentSource.MINI_PROGRAM,
    consentTextSnapshot: CONSENT_TEXT_SNAPSHOT,
    matchType: 'EXISTING_PATIENT',
    signedAt: daysAgo(8, 9, 28),
    ipAddress: '203.0.113.41',
    userAgent: 'MicroMessenger/8.0.51 wechatdevtools/1.06.2412050',
    status: PatientConsentStatus.SIGNED,
    createdAt: daysAgo(8, 9, 28),
  },
  {
    id: 'demo-consent-002',
    demoOpenId: 'demo-openid-pending-001',
    hospitalPatientId: 'MZ20260519002',
    chronicLeadId: 'demo-lead-signed-001',
    patientId: 'demo-patient-002',
    bindingRequestId: 'demo-binding-pending-001',
    consentVersion: PATIENT_CONSENT_VERSION,
    consentSource: PatientConsentSource.MINI_PROGRAM,
    consentTextSnapshot: CONSENT_TEXT_SNAPSHOT,
    matchType: 'CHRONIC_LEAD',
    signedAt: daysAgo(0, 10, 10),
    ipAddress: '203.0.113.88',
    userAgent: 'MicroMessenger/8.0.51 wechatdevtools/1.06.2412050',
    status: PatientConsentStatus.SIGNED,
    createdAt: daysAgo(0, 10, 10),
  },
];


// ============================================================================
// 院内病历 demo 数据 (hospital-records-seed)
//
// 为 demo 病人补充从医院系统 (HIS / EMR / LIS) 获取的院内病历记录:
//   - EncounterRecord         就诊记录 (门诊/住院/急诊/体检)
//   - MedicalRecordSummary    病历摘要 (门诊病历/住院病历/出院小结/病程记录/会诊)
//   - ExamReportRecord        检查报告 (影像/心电/超声/血液检验/肺功能等)
//   - HospitalMedicationOrder 院内处方 (与就诊记录关联的药物医嘱)
//
// 每条记录都通过 patientId 关联到 demoPatients, 并与现有的临床叙事线吻合:
//   - 王建国(001) 极高危高血压 → 心血管内科门诊 + 急诊高血压 + 头颅 CT + 乌拉地尔
//   - 李秀兰(002) 极高危糖尿病 → 内分泌科住院 + 出院小结 + 血液检验 + 二甲双胍
//   - 张德明(003) 慢阻肺急性加重风险 → 呼吸科门诊 + 肺功能 + 噻托溴铵吸入剂
//   - 陈红(005)   冠心病二级预防 → 胸痛复核 + 心脏超声 + 冠脉造影 + 阿司匹林/他汀
// ============================================================================

const encounterSeeds = [
  // ── 患者 001 王建国 (高血压 VERY_HIGH) ──
  {
    id: 'demo-encounter-001-a',
    patientId: 'demo-patient-001',
    hospitalPatientId: 'MZ20260519001',
    externalVisitId: 'HIS-VISIT-20260318-0001',
    visitType: 'OUTPATIENT',
    departmentName: '心血管内科',
    doctorName: '张主任',
    visitTime: daysAgo(68, 9, 30),
    chiefComplaint: '头晕、头痛反复发作 2 月余',
    diagnosisSummary: '原发性高血压 2 级 (极高危); 高脂血症',
    treatmentSummary: '调整降压方案: 苯磺酸氨氯地平 5mg qd → 联合缬沙坦 80mg qd。嘱规律监测家庭血压。',
  },
  {
    id: 'demo-encounter-001-b',
    patientId: 'demo-patient-001',
    hospitalPatientId: 'MZ20260519001',
    externalVisitId: 'HIS-VISIT-20260425-0019',
    visitType: 'OUTPATIENT',
    departmentName: '心血管内科',
    doctorName: '张主任',
    visitTime: daysAgo(30, 14, 0),
    chiefComplaint: '门诊复诊: 血压控制情况评估',
    diagnosisSummary: '高血压 2 级; 近期晨间血压有上升趋势',
    treatmentSummary: '维持现有方案, 加强晨间血压监测频率。建议 4 周后复诊。',
  },
  {
    id: 'demo-encounter-001-c',
    patientId: 'demo-patient-001',
    hospitalPatientId: 'MZ20260519001',
    externalVisitId: 'HIS-VISIT-20260524-EM-0007',
    visitType: 'EMERGENCY',
    departmentName: '急诊内科',
    doctorName: '急诊王医生',
    visitTime: daysAgo(1, 8, 10),
    chiefComplaint: '晨起测血压 188/112 mmHg, 伴头痛、视物模糊',
    diagnosisSummary: '高血压急症; 高血压性脑病待排',
    treatmentSummary: '急诊留观, 静脉乌拉地尔降压; 完善头颅 CT 排查脑出血; 病情稳定后转回心内科门诊随访。',
  },

  // ── 患者 002 李秀兰 (糖尿病 VERY_HIGH) ──
  {
    id: 'demo-encounter-002-a',
    patientId: 'demo-patient-002',
    hospitalPatientId: 'MZ20260519002',
    externalVisitId: 'HIS-VISIT-20260408-IN-0003',
    visitType: 'INPATIENT',
    departmentName: '内分泌科',
    doctorName: '李主任',
    visitTime: daysAgo(47, 10, 0),
    chiefComplaint: '多饮多尿乏力加重 1 周, 空腹血糖 15.8 mmol/L',
    diagnosisSummary: '2 型糖尿病血糖控制不佳; 糖尿病周围神经病变 (早期)',
    treatmentSummary: '住院 7 天进行血糖管理 + 营养教育, 出院时空腹血糖降至 7.2 mmol/L。',
  },
  {
    id: 'demo-encounter-002-b',
    patientId: 'demo-patient-002',
    hospitalPatientId: 'MZ20260519002',
    externalVisitId: 'HIS-VISIT-20260520-0042',
    visitType: 'OUTPATIENT',
    departmentName: '内分泌科',
    doctorName: '李主任',
    visitTime: daysAgo(5, 10, 30),
    chiefComplaint: '门诊复诊: 空腹血糖反弹至 12.6 mmol/L',
    diagnosisSummary: '2 型糖尿病, 血糖控制不佳',
    treatmentSummary: '加量二甲双胍至 1000mg bid, 加用德谷胰岛素 10U 睡前皮下注射。',
  },

  // ── 患者 003 张德明 (慢阻肺 HIGH) ──
  {
    id: 'demo-encounter-003-a',
    patientId: 'demo-patient-003',
    hospitalPatientId: 'MZ20260519003',
    externalVisitId: 'HIS-VISIT-20260510-0028',
    visitType: 'OUTPATIENT',
    departmentName: '呼吸与危重症医学科',
    doctorName: '王主任',
    visitTime: daysAgo(15, 9, 15),
    chiefComplaint: '近 1 周活动后气促, 血氧波动 92~95%',
    diagnosisSummary: '慢性阻塞性肺疾病稳定期, 急性加重风险增加',
    treatmentSummary: '维持噻托溴铵 18μg qd; 加用沙美特罗替卡松吸入剂 50/250 bid。复查肺功能。',
  },

  // ── 患者 004 赵敏 (肥胖 MEDIUM) ──
  {
    id: 'demo-encounter-004-a',
    patientId: 'demo-patient-004',
    hospitalPatientId: 'MZ20260519004',
    externalVisitId: 'HIS-VISIT-20260418-CH-0011',
    visitType: 'CHECKUP',
    departmentName: '健康管理中心',
    doctorName: '体检中心',
    visitTime: daysAgo(37, 8, 0),
    chiefComplaint: '年度体检',
    diagnosisSummary: '超重 (BMI 29.4); 血脂偏高 (TG 2.1 mmol/L)',
    treatmentSummary: '建议生活方式干预: 减少精制碳水, 增加每周 150 分钟有氧运动。3 个月后复查。',
  },

  // ── 患者 005 陈红 (冠心病 HIGH) ──
  {
    id: 'demo-encounter-005-a',
    patientId: 'demo-patient-005',
    hospitalPatientId: 'MZ20260519005',
    externalVisitId: 'HIS-VISIT-20260206-IN-0009',
    visitType: 'INPATIENT',
    departmentName: '心血管内科',
    doctorName: '赵主任',
    visitTime: daysAgo(109, 11, 0),
    chiefComplaint: '反复胸闷胸痛 3 月, 加重 1 周',
    diagnosisSummary: '冠心病 (不稳定型心绞痛); 冠脉造影示前降支 70% 狭窄',
    treatmentSummary: '前降支 PCI 植入药物洗脱支架 1 枚; 术后双抗 + 他汀二级预防。',
  },
  {
    id: 'demo-encounter-005-b',
    patientId: 'demo-patient-005',
    hospitalPatientId: 'MZ20260519005',
    externalVisitId: 'HIS-VISIT-20260515-0033',
    visitType: 'OUTPATIENT',
    departmentName: '心血管内科',
    doctorName: '赵主任',
    visitTime: daysAgo(10, 14, 30),
    chiefComplaint: '门诊复诊: 偶发胸闷, 心率偏快',
    diagnosisSummary: 'PCI 术后随访, 心率控制不佳',
    treatmentSummary: '加用美托洛尔缓释片 47.5mg qd; 继续阿司匹林 + 替格瑞洛 + 阿托伐他汀方案。',
  },

  // ── 患者 006 刘国强 (高血压 MEDIUM) ──
  {
    id: 'demo-encounter-006-a',
    patientId: 'demo-patient-006',
    hospitalPatientId: 'MZ20260519006',
    externalVisitId: 'HIS-VISIT-20260502-0021',
    visitType: 'OUTPATIENT',
    departmentName: '心血管内科',
    doctorName: '张主任',
    visitTime: daysAgo(23, 9, 0),
    chiefComplaint: '门诊常规复诊: 血压 132/79 mmHg, 控制平稳',
    diagnosisSummary: '原发性高血压 1 级, 控制良好',
    treatmentSummary: '维持当前方案 (氢氯噻嗪 12.5mg qd)。3 个月后复诊。',
  },

  // ── 患者 009 吴爱民 (高血压 LOW) ──
  {
    id: 'demo-encounter-009-a',
    patientId: 'demo-patient-009',
    hospitalPatientId: 'MZ20260519009',
    externalVisitId: 'HIS-VISIT-20260512-CH-0014',
    visitType: 'CHECKUP',
    departmentName: '健康管理中心',
    doctorName: '体检中心',
    visitTime: daysAgo(13, 8, 30),
    chiefComplaint: '年度体检',
    diagnosisSummary: '高血压 1 级, 控制良好; 余无明显异常',
    treatmentSummary: '继续生活方式管理 + 规律家庭血压监测。',
  },
];

const medicalRecordSummarySeeds = [
  // 王建国(001) 心内科门诊 + 急诊
  {
    id: 'demo-medrec-001-a',
    patientId: 'demo-patient-001',
    externalRecordId: 'EMR-NOTE-20260318-0001',
    recordType: 'OUTPATIENT_NOTE',
    recordTime: daysAgo(68, 9, 45),
    departmentName: '心血管内科',
    title: '门诊病历 - 高血压调药',
    summary: '患者主诉头晕头痛 2 月, 自测血压晨间偏高 (155~165/95~100 mmHg)。',
    diagnosisText: '原发性高血压 2 级 (极高危); 高脂血症',
    treatmentPlan: '苯磺酸氨氯地平 5mg qd 联合缬沙坦 80mg qd; 1 个月后复诊评估。',
    doctorAdvice: '低盐饮食, 戒酒, 每日规律家庭血压监测, 必要时即刻就诊。',
  },
  {
    id: 'demo-medrec-001-b',
    patientId: 'demo-patient-001',
    externalRecordId: 'EMR-NOTE-20260524-EM-0007',
    recordType: 'PROGRESS_NOTE',
    recordTime: daysAgo(1, 9, 0),
    departmentName: '急诊内科',
    title: '急诊病程记录 - 高血压急症',
    summary: '患者晨起血压 188/112 mmHg, 伴头痛、视物模糊。急诊查体神清, 心肺听诊无异常。完善头颅 CT 未见出血。',
    diagnosisText: '高血压急症 (无靶器官损害)',
    treatmentPlan: '静脉乌拉地尔降压, 监测血压每 15 分钟 1 次; 病情稳定后留观 4 小时。',
    doctorAdvice: '出院后心内科门诊密切随访, 每日 2 次家庭血压监测并记录。',
  },

  // 李秀兰(002) 内分泌住院 + 出院小结
  {
    id: 'demo-medrec-002-a',
    patientId: 'demo-patient-002',
    externalRecordId: 'EMR-NOTE-20260408-IN-0003',
    recordType: 'INPATIENT_RECORD',
    recordTime: daysAgo(47, 14, 0),
    departmentName: '内分泌科',
    title: '住院病历 - 糖尿病血糖管理',
    summary: '患者糖尿病病史 11 年, 近期多饮多尿乏力加重 1 周, 入院查空腹血糖 15.8 mmol/L, 糖化血红蛋白 9.8%。',
    diagnosisText: '2 型糖尿病血糖控制不佳; 糖尿病周围神经病变 (早期)',
    treatmentPlan: '住院期间予胰岛素强化方案; 营养科介入饮食指导; 完善并发症筛查。',
    doctorAdvice: '住院期间每日 7 次血糖监测, 出院后改为每日 2 次。',
  },
  {
    id: 'demo-medrec-002-b',
    patientId: 'demo-patient-002',
    externalRecordId: 'EMR-NOTE-20260415-DC-0003',
    recordType: 'DISCHARGE_SUMMARY',
    recordTime: daysAgo(40, 10, 0),
    departmentName: '内分泌科',
    title: '出院小结 - 2 型糖尿病',
    summary: '住院 7 天后空腹血糖降至 7.2 mmol/L, 餐后 2h 血糖 9.4 mmol/L, 糖尿病周围神经病变筛查阳性。',
    diagnosisText: '2 型糖尿病; 糖尿病周围神经病变 (早期); 高血压 1 级',
    treatmentPlan: '出院方案: 二甲双胍 500mg bid + 甘精胰岛素 8U 睡前; 4 周后内分泌门诊复诊。',
    doctorAdvice: '低糖饮食, 规律运动, 自我血糖监测每日 2 次, 关注足部皮肤变化。',
  },

  // 张德明(003) 呼吸科会诊
  {
    id: 'demo-medrec-003-a',
    patientId: 'demo-patient-003',
    externalRecordId: 'EMR-NOTE-20260510-0028',
    recordType: 'OUTPATIENT_NOTE',
    recordTime: daysAgo(15, 9, 35),
    departmentName: '呼吸与危重症医学科',
    title: '门诊病历 - 慢阻肺稳定期管理',
    summary: '患者活动后气促加重 1 周, 血氧波动 92~95%, 听诊双肺可闻散在干啰音。',
    diagnosisText: '慢性阻塞性肺疾病稳定期 GOLD II 级, 急性加重风险升高',
    treatmentPlan: '维持噻托溴铵 18μg qd, 加用沙美特罗替卡松 50/250 bid; 4 周后复查肺功能。',
    doctorAdvice: '避免冷空气和粉尘暴露; 每日血氧打卡; SpO2 < 92% 立即就诊。',
  },

  // 陈红(005) 心内科 PCI 出院小结 + 复诊
  {
    id: 'demo-medrec-005-a',
    patientId: 'demo-patient-005',
    externalRecordId: 'EMR-NOTE-20260213-DC-0009',
    recordType: 'DISCHARGE_SUMMARY',
    recordTime: daysAgo(102, 10, 30),
    departmentName: '心血管内科',
    title: '出院小结 - 冠心病 PCI 术后',
    summary: '患者因反复胸闷胸痛入院, 冠脉造影示前降支近段 70% 狭窄, 行 PCI 植入药物洗脱支架 1 枚, 术后恢复良好。',
    diagnosisText: '冠心病 (不稳定型心绞痛); PCI 术后 (LAD 支架)',
    treatmentPlan: '阿司匹林 100mg qd + 替格瑞洛 90mg bid (双抗 12 个月) + 阿托伐他汀 20mg qn。',
    doctorAdvice: '严格戒烟, 控制血压心率; 任何胸痛立即舌下含服硝酸甘油并就诊。',
  },
  {
    id: 'demo-medrec-005-b',
    patientId: 'demo-patient-005',
    externalRecordId: 'EMR-NOTE-20260515-0033',
    recordType: 'OUTPATIENT_NOTE',
    recordTime: daysAgo(10, 14, 45),
    departmentName: '心血管内科',
    title: '门诊病历 - PCI 术后 3 月复诊',
    summary: '患者偶发胸闷, 心率偏快 (静息 96~108 bpm), 无明显胸痛。复查心电图未见缺血改变。',
    diagnosisText: 'PCI 术后随访期, 心率控制不佳',
    treatmentPlan: '加用美托洛尔缓释片 47.5mg qd; 继续双抗 + 他汀方案。',
    doctorAdvice: '继续戒烟, 心率目标 < 70 bpm; 1 个月后复诊。',
  },
];

const examReportSeeds = [
  // 王建国(001) 心电图 + 头颅 CT
  {
    id: 'demo-exam-001-a',
    patientId: 'demo-patient-001',
    externalExamId: 'EXAM-ECG-20260318-0001',
    examType: 'ECG',
    examName: '12 导联心电图',
    examTime: daysAgo(68, 10, 0),
    departmentName: '心电图室',
    finding: '窦性心律, 心率 78 bpm, 电轴不偏。ST-T 段大致正常, 未见缺血改变。左心室高电压。',
    conclusion: '窦性心律; 左心室高电压, 提示高血压性心脏改变可能。',
    reportUrl: 'https://demo-hospital.example.com/reports/ecg-001-a.pdf',
  },
  {
    id: 'demo-exam-001-b',
    patientId: 'demo-patient-001',
    externalExamId: 'EXAM-CT-20260524-0007',
    examType: 'CT',
    examName: '头颅 CT 平扫',
    examTime: daysAgo(1, 8, 45),
    departmentName: '影像科',
    finding: '脑实质未见明显异常密度灶, 脑沟脑回未见明显增宽变浅, 中线结构居中。',
    conclusion: '头颅 CT 未见明显异常, 未见急性脑出血及大面积脑梗死征象。',
    reportUrl: 'https://demo-hospital.example.com/reports/ct-001-b.pdf',
  },

  // 李秀兰(002) 血液检验 (糖化 + 肾功)
  {
    id: 'demo-exam-002-a',
    patientId: 'demo-patient-002',
    externalExamId: 'EXAM-LAB-20260408-IN-0003',
    examType: 'LAB',
    examName: '血液检验: 糖化血红蛋白 + 肝肾功能',
    examTime: daysAgo(47, 10, 30),
    departmentName: '检验科',
    finding: '糖化血红蛋白 9.8% (参考 4.0-6.0%); 空腹血糖 15.8 mmol/L; 肌酐 78 μmol/L; ALT 32 U/L。',
    conclusion: '糖化血红蛋白显著升高, 提示长期血糖控制不佳; 肝肾功能正常。',
    reportUrl: 'https://demo-hospital.example.com/reports/lab-002-a.pdf',
  },
  {
    id: 'demo-exam-002-b',
    patientId: 'demo-patient-002',
    externalExamId: 'EXAM-NCV-20260411-0011',
    examType: 'NCV',
    examName: '神经传导速度 + 肌电图',
    examTime: daysAgo(44, 11, 0),
    departmentName: '神经电生理',
    finding: '双下肢腓肠神经传导速度轻度减慢, 波幅尚可; 双正中神经感觉传导速度正常。',
    conclusion: '提示糖尿病周围神经病变早期改变 (下肢感觉神经)。',
    reportUrl: 'https://demo-hospital.example.com/reports/ncv-002-b.pdf',
  },

  // 张德明(003) 胸片 + 肺功能
  {
    id: 'demo-exam-003-a',
    patientId: 'demo-patient-003',
    externalExamId: 'EXAM-XRAY-20260510-0028',
    examType: 'XRAY',
    examName: '胸部正侧位 X 线',
    examTime: daysAgo(15, 9, 50),
    departmentName: '影像科',
    finding: '双肺纹理增多紊乱, 肺气肿征象; 心影未见明显增大, 膈面光整。',
    conclusion: '双肺慢性炎症伴肺气肿征象, 符合慢阻肺改变。',
    reportUrl: 'https://demo-hospital.example.com/reports/xray-003-a.pdf',
  },
  {
    id: 'demo-exam-003-b',
    patientId: 'demo-patient-003',
    externalExamId: 'EXAM-PFT-20260511-0014',
    examType: 'PFT',
    examName: '肺功能检查',
    examTime: daysAgo(14, 10, 30),
    departmentName: '呼吸功能室',
    finding: 'FEV1 占预计值 58%; FEV1/FVC 0.62; 支气管舒张试验阴性。',
    conclusion: '中度阻塞性通气功能障碍 (GOLD II 级), 支气管舒张试验阴性, 符合慢阻肺。',
    reportUrl: 'https://demo-hospital.example.com/reports/pft-003-b.pdf',
  },

  // 赵敏(004) 体检超声 + 血脂
  {
    id: 'demo-exam-004-a',
    patientId: 'demo-patient-004',
    externalExamId: 'EXAM-US-20260418-0011',
    examType: 'ULTRASOUND',
    examName: '腹部超声',
    examTime: daysAgo(37, 8, 30),
    departmentName: '超声科',
    finding: '肝脏体积稍大, 回声增粗增强, 肝内血管走形正常; 胆囊壁光滑; 双肾未见明显异常。',
    conclusion: '轻度脂肪肝。',
    reportUrl: 'https://demo-hospital.example.com/reports/us-004-a.pdf',
  },

  // 陈红(005) 心脏超声 + 冠脉造影 + 复诊心电图
  {
    id: 'demo-exam-005-a',
    patientId: 'demo-patient-005',
    externalExamId: 'EXAM-ECHO-20260206-IN-0009',
    examType: 'ECHO',
    examName: '经胸超声心动图',
    examTime: daysAgo(109, 11, 30),
    departmentName: '超声科',
    finding: '左室壁运动节段性减弱 (前壁中段), LVEF 53%; 各瓣膜未见明显异常; 主动脉根部内径正常。',
    conclusion: '左室前壁节段性运动减弱; 左室收缩功能轻度降低 (LVEF 53%)。',
    reportUrl: 'https://demo-hospital.example.com/reports/echo-005-a.pdf',
  },
  {
    id: 'demo-exam-005-b',
    patientId: 'demo-patient-005',
    externalExamId: 'EXAM-CAG-20260207-IN-0009',
    examType: 'ANGIOGRAPHY',
    examName: '冠状动脉造影',
    examTime: daysAgo(108, 9, 0),
    departmentName: '心血管介入中心',
    finding: '左前降支近段 70% 局限性狭窄; 回旋支及右冠未见明显狭窄。已于前降支植入药物洗脱支架 1 枚, 术后造影 TIMI 3 级血流。',
    conclusion: '冠状动脉单支病变 (LAD); PCI 成功植入支架 1 枚。',
    reportUrl: 'https://demo-hospital.example.com/reports/cag-005-b.pdf',
  },
  {
    id: 'demo-exam-005-c',
    patientId: 'demo-patient-005',
    externalExamId: 'EXAM-ECG-20260515-0033',
    examType: 'ECG',
    examName: '12 导联心电图',
    examTime: daysAgo(10, 15, 0),
    departmentName: '心电图室',
    finding: '窦性心律, 心率 102 bpm。胸前导联未见 ST 段动态变化, 与术前对比无新发缺血改变。',
    conclusion: '窦性心动过速; PCI 术后随访, 未见新发缺血。',
    reportUrl: 'https://demo-hospital.example.com/reports/ecg-005-c.pdf',
  },
];

const hospitalMedicationOrderSeeds = [
  // 王建国(001) 心内科门诊 + 急诊处方
  {
    id: 'demo-rx-001-a',
    patientId: 'demo-patient-001',
    externalOrderId: 'RX-20260318-0001-1',
    encounterRecordId: 'demo-encounter-001-a',
    medicationName: '苯磺酸氨氯地平片',
    dosage: '5mg',
    frequency: '每日 1 次',
    route: '口服',
    duration: '30 天',
    prescribedBy: '张主任',
    prescribedAt: daysAgo(68, 10, 15),
  },
  {
    id: 'demo-rx-001-b',
    patientId: 'demo-patient-001',
    externalOrderId: 'RX-20260318-0001-2',
    encounterRecordId: 'demo-encounter-001-a',
    medicationName: '缬沙坦胶囊',
    dosage: '80mg',
    frequency: '每日 1 次',
    route: '口服',
    duration: '30 天',
    prescribedBy: '张主任',
    prescribedAt: daysAgo(68, 10, 16),
  },
  {
    id: 'demo-rx-001-c',
    patientId: 'demo-patient-001',
    externalOrderId: 'RX-20260524-EM-0007-1',
    encounterRecordId: 'demo-encounter-001-c',
    medicationName: '盐酸乌拉地尔注射液',
    dosage: '25mg',
    frequency: '静脉缓慢推注 1 次, 必要时重复',
    route: '静脉注射',
    duration: '急诊单次医嘱',
    prescribedBy: '急诊王医生',
    prescribedAt: daysAgo(1, 8, 25),
  },

  // 李秀兰(002) 住院 + 出院 + 复诊
  {
    id: 'demo-rx-002-a',
    patientId: 'demo-patient-002',
    externalOrderId: 'RX-20260408-IN-0003-1',
    encounterRecordId: 'demo-encounter-002-a',
    medicationName: '二甲双胍片',
    dosage: '500mg',
    frequency: '每日 2 次, 随餐服用',
    route: '口服',
    duration: '住院期间',
    prescribedBy: '李主任',
    prescribedAt: daysAgo(47, 10, 30),
  },
  {
    id: 'demo-rx-002-b',
    patientId: 'demo-patient-002',
    externalOrderId: 'RX-20260415-DC-0003-1',
    encounterRecordId: 'demo-encounter-002-a',
    medicationName: '甘精胰岛素注射液',
    dosage: '8U',
    frequency: '每日 1 次, 睡前皮下注射',
    route: '皮下注射',
    duration: '出院后长期',
    prescribedBy: '李主任',
    prescribedAt: daysAgo(40, 10, 10),
  },
  {
    id: 'demo-rx-002-c',
    patientId: 'demo-patient-002',
    externalOrderId: 'RX-20260520-0042-1',
    encounterRecordId: 'demo-encounter-002-b',
    medicationName: '二甲双胍片',
    dosage: '1000mg',
    frequency: '每日 2 次, 随餐服用',
    route: '口服',
    duration: '30 天',
    prescribedBy: '李主任',
    prescribedAt: daysAgo(5, 10, 45),
  },
  {
    id: 'demo-rx-002-d',
    patientId: 'demo-patient-002',
    externalOrderId: 'RX-20260520-0042-2',
    encounterRecordId: 'demo-encounter-002-b',
    medicationName: '德谷胰岛素注射液',
    dosage: '10U',
    frequency: '每日 1 次, 睡前皮下注射',
    route: '皮下注射',
    duration: '30 天',
    prescribedBy: '李主任',
    prescribedAt: daysAgo(5, 10, 46),
  },

  // 张德明(003) 呼吸科吸入剂
  {
    id: 'demo-rx-003-a',
    patientId: 'demo-patient-003',
    externalOrderId: 'RX-20260510-0028-1',
    encounterRecordId: 'demo-encounter-003-a',
    medicationName: '噻托溴铵粉吸入剂',
    dosage: '18μg',
    frequency: '每日 1 次',
    route: '吸入',
    duration: '30 天',
    prescribedBy: '王主任',
    prescribedAt: daysAgo(15, 9, 50),
  },
  {
    id: 'demo-rx-003-b',
    patientId: 'demo-patient-003',
    externalOrderId: 'RX-20260510-0028-2',
    encounterRecordId: 'demo-encounter-003-a',
    medicationName: '沙美特罗替卡松吸入剂',
    dosage: '50μg/250μg',
    frequency: '每日 2 次',
    route: '吸入',
    duration: '30 天',
    prescribedBy: '王主任',
    prescribedAt: daysAgo(15, 9, 51),
  },

  // 陈红(005) PCI 出院双抗 + 他汀 + 加用美托洛尔
  {
    id: 'demo-rx-005-a',
    patientId: 'demo-patient-005',
    externalOrderId: 'RX-20260213-DC-0009-1',
    encounterRecordId: 'demo-encounter-005-a',
    medicationName: '阿司匹林肠溶片',
    dosage: '100mg',
    frequency: '每日 1 次, 饭后服用',
    route: '口服',
    duration: '长期',
    prescribedBy: '赵主任',
    prescribedAt: daysAgo(102, 10, 40),
  },
  {
    id: 'demo-rx-005-b',
    patientId: 'demo-patient-005',
    externalOrderId: 'RX-20260213-DC-0009-2',
    encounterRecordId: 'demo-encounter-005-a',
    medicationName: '替格瑞洛片',
    dosage: '90mg',
    frequency: '每日 2 次',
    route: '口服',
    duration: '12 个月 (双抗疗程)',
    prescribedBy: '赵主任',
    prescribedAt: daysAgo(102, 10, 41),
  },
  {
    id: 'demo-rx-005-c',
    patientId: 'demo-patient-005',
    externalOrderId: 'RX-20260213-DC-0009-3',
    encounterRecordId: 'demo-encounter-005-a',
    medicationName: '阿托伐他汀钙片',
    dosage: '20mg',
    frequency: '每日 1 次, 睡前服用',
    route: '口服',
    duration: '长期',
    prescribedBy: '赵主任',
    prescribedAt: daysAgo(102, 10, 42),
  },
  {
    id: 'demo-rx-005-d',
    patientId: 'demo-patient-005',
    externalOrderId: 'RX-20260515-0033-1',
    encounterRecordId: 'demo-encounter-005-b',
    medicationName: '美托洛尔缓释片',
    dosage: '47.5mg',
    frequency: '每日 1 次',
    route: '口服',
    duration: '30 天',
    prescribedBy: '赵主任',
    prescribedAt: daysAgo(10, 14, 50),
  },
  {
    id: 'demo-rx-005-e',
    patientId: 'demo-patient-005',
    externalOrderId: 'RX-20260515-0033-2',
    encounterRecordId: 'demo-encounter-005-b',
    medicationName: '硝酸甘油片',
    dosage: '0.5mg',
    frequency: '胸痛时舌下含服, 必要时 5 分钟后重复 1 次, 最多 3 次',
    route: '舌下含服',
    duration: '随身备用',
    prescribedBy: '赵主任',
    prescribedAt: daysAgo(10, 14, 51),
  },
];


// ============================================================================
// hospital-records-seed (gateway-driven)
//
// Background:
//   生产环境中, 医院 HIS / EMR / LIS 通过下面四个通道把就诊 / 病历 / 检查 / 处方
//   推到我们的网关:
//
//     1) POST /gateway/his/events/*     (简化 REST,本 seed 模拟的是这条)
//     2) POST /gateway/fhir/* (FHIR R4 资源)
//     3) HL7 v2 over MLLP TCP
//     4) 中间表 / 前置机 cron 拉取
//
//   网关收到事件后:
//     - InboundEventService 写 IntegrationSyncBatch + IntegrationSyncRecord
//       (审计层, promotionStatus = PENDING)
//     - IntegrationPromoteService 读审计层, 落到正式业务表
//       (EncounterRecord / MedicalRecordSummary / ExamReportRecord /
//        HospitalMedicationOrder), 并回写 localTargetType / localTargetId /
//       promotionStatus = PROMOTED
//
//   之前的 seed 直接 prisma.encounterRecord.createMany(...) 绕过了这条链路,
//   导致【接口中心】里看不到对应的网关流水, 也无法演示「审计 + promote 双状态」。
//
// 这个 helper 重现生产行为:
//   每条 encounterSeeds / medicalRecordSummarySeeds / examReportSeeds /
//   hospitalMedicationOrderSeeds 都会被翻译成一个 NormalizedEvent, 然后:
//     (a) upsert 一条 IntegrationSyncBatch (单条记录批次, 对应 REST 一次性推送)
//     (b) 写 IntegrationSyncRecord, 状态 SUCCESS + PROMOTED
//     (c) 写业务表行
//     (d) 回填审计行的 localTargetType + localTargetId + promotedAt
//   最终 demo 数据库的"端到端形状"和生产跑了一阵子后完全一致。
//
//   注意: 我们不走真实的 InboundEventService / IntegrationPromoteService TS 代码,
//   因为 seed 是脱离 NestJS 上下文的纯 Node 脚本, 拉 DI 容器代价过大。
//   这里手动复刻了 promote 流水线在 happy-path 下的最终落库形状, FK / 字段映射
//   都和 integration-promote.service.ts 中的 promoteEncounter / promoteDocument /
//   promoteExamReport / promoteMedication 严格对齐。
// ============================================================================

const GATEWAY_CHANNEL_HIS_EVENT_REST = 'GATEWAY_HIS_EVENT_REST';
const GATEWAY_SOURCE_CODE_HIS_EVENT_REST = 'GATEWAY_HIS_EVENT_REST';
const GATEWAY_RESOURCE_ENCOUNTER = 'ENCOUNTER';
const GATEWAY_RESOURCE_DOCUMENT = 'DOCUMENT';
const GATEWAY_RESOURCE_EXAM_REPORT = 'EXAM_REPORT';
const GATEWAY_RESOURCE_MEDICATION = 'MEDICATION';

// 用于事务清理 + 反查校验: 所有 demo 院内病历事件的 externalRecordId 全量集合。
// 注意 hospitalMedicationOrderSeeds 的 externalOrderId 同时是 IntegrationSyncRecord
// 的 externalRecordId, 所以一并放进来。
const HOSPITAL_RECORD_DEMO_EXTERNAL_IDS = [
  ...encounterSeeds.map((s) => s.externalVisitId),
  ...medicalRecordSummarySeeds.map((s) => s.externalRecordId),
  ...examReportSeeds.map((s) => s.externalExamId),
  ...hospitalMedicationOrderSeeds.map((s) => s.externalOrderId),
].filter(Boolean);

/**
 * 网关在 InboundEventService 启动时会 upsert 一条 GATEWAY_HIS_EVENT_REST
 * 的 IntegrationSource 行 (见 GatewaySourceRegistryService.onModuleInit)。
 * 但 seed-all.js 是脱离 NestJS 的脚本, 那段 init 不会跑, 所以这里手动复刻。
 */
async function getOrSeedGatewayHisEventSource() {
  const tenant = await ensurePrimaryDemoTenant();
  return prisma.integrationSource.upsert({
    where: {
      hospitalTenantId_code: {
        hospitalTenantId: tenant.id,
        code: GATEWAY_SOURCE_CODE_HIS_EVENT_REST,
      },
    },
    update: { hospitalTenantId: tenant.id },
    create: {
      hospitalTenantId: tenant.id,
      code: GATEWAY_SOURCE_CODE_HIS_EVENT_REST,
      name: '数据接入网关 - 简化 HIS 事件 REST',
      systemType: IntegrationSystemType.HIS,
      description:
        '医院端在患者出院 / 开具处方 / 检查报告等事件触发时通过 HTTPS JSON 调用 /gateway/his/events/*。',
      isEnabled: true,
      // demo 默认 false (手动 promote), 但 seed 在这里同步完成了 promote 工作。
      // 上线时管理员在【接口中心】勾选 autoPromote 即可改为自动。
      autoPromote: false,
    },
  });
}

/**
 * 把一条 NormalizedEvent 走完"审计 + promote"的最终形状:
 *   batch (1 record) → syncRecord (PROMOTED) → business row → 回写 localTarget*
 *
 * @param {object} args
 * @param {object} args.source       - IntegrationSource row
 * @param {string} args.resourceType - GATEWAY_RESOURCE_* 常量值
 * @param {string} args.triggerEvent - 触发事件标签, 例如 "HIS_EVENT.ENCOUNTER"
 * @param {string} args.externalRecordId - 上游 eventId = 业务表里的 externalVisitId/...
 * @param {object} args.patientIdentifier - { hospitalPatientId, idCardNo?, phone? }
 * @param {object} args.normalizedPayload - 规范化后的业务字段
 * @param {Date}   args.receivedAt   - 网关接收事件的时间 (用于 batch + audit 行)
 * @param {(prismaClient) => Promise<{type: string, id: string}>} args.writeBusinessRow
 *        创建业务表行的 callback, 返回 { type: 'EncounterRecord', id: '...' }
 */
async function emitGatewayEvent({
  source,
  resourceType,
  triggerEvent,
  externalRecordId,
  patientIdentifier,
  normalizedPayload,
  receivedAt,
  writeBusinessRow,
}) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.integrationSyncBatch.create({
      data: {
        sourceId: source.id,
        batchType: GATEWAY_CHANNEL_HIS_EVENT_REST,
        status: 'SUCCESS',
        startedAt: receivedAt,
        finishedAt: receivedAt,
        totalCount: 1,
        successCount: 1,
        failedCount: 0,
      },
    });

    // normalizedData 形状必须和 InboundEventService.writeRecord 一致, 否则
    // IntegrationPromoteService.unwrapNormalized 解包时会拿不到 patient / payload。
    const normalizedData = {
      channel: GATEWAY_CHANNEL_HIS_EVENT_REST,
      triggerEvent,
      patient: patientIdentifier,
      payload: normalizedPayload,
      receivedAt: receivedAt.toISOString(),
    };

    const auditRow = await tx.integrationSyncRecord.create({
      data: {
        sourceId: source.id,
        batchId: batch.id,
        externalRecordType: resourceType,
        externalRecordId,
        status: 'SUCCESS',
        rawData: normalizedPayload, // 简化:不再造一份外层 DTO, 用 normalizedPayload 充当
        normalizedData,
        promotionStatus: 'PROMOTED',
        promotionMessage: 'demo seed: 模拟生产链路, 审计 + promote 同步完成。',
        promotedAt: receivedAt,
        createdAt: receivedAt,
      },
    });

    const businessRow = await writeBusinessRow(tx);

    // 回写 localTargetType / localTargetId, 完成"审计 → 业务"的双向追溯。
    await tx.integrationSyncRecord.update({
      where: { id: auditRow.id },
      data: {
        localTargetType: businessRow.type,
        localTargetId: businessRow.id,
      },
    });

    return { batchId: batch.id, auditRowId: auditRow.id, businessRow };
  });
}

/**
 * 把 encounterSeeds / medicalRecordSummarySeeds / examReportSeeds /
 * hospitalMedicationOrderSeeds 4 组数据全部通过网关流水线落库。
 * 与生产的差别仅在于:
 *   - 没有走真实 HTTP POST 到 /gateway/his/events/* (省掉网络一跳)
 *   - autoPromote 被 seed 主动当作 true 处理 (生产中默认 false, 由管理员入库)
 *
 * 行为差别:
 *   - 业务表行的 sourceSystem 字段从 'HIS_DEMO' 改成 'GATEWAY_HIS_EVENT_REST',
 *     表示"这条数据是通过网关流水线进来的", 和 IntegrationSyncRecord 上的
 *     normalizedData.channel 完全对齐, 在接口中心点 audit 行能跳回业务表。
 */
async function seedHospitalRecordsViaGateway() {
  const source = await getOrSeedGatewayHisEventSource();
  let events = 0;
  let promoted = 0;

  // ── 1) Encounter events ──────────────────────────────────────────────────
  for (const s of encounterSeeds) {
    await emitGatewayEvent({
      source,
      resourceType: GATEWAY_RESOURCE_ENCOUNTER,
      triggerEvent: 'HIS_EVENT.ENCOUNTER',
      externalRecordId: s.externalVisitId,
      patientIdentifier: { hospitalPatientId: s.hospitalPatientId },
      normalizedPayload: {
        encounterType: s.visitType,
        startedAt: s.visitTime.toISOString(),
        department: s.departmentName,
        doctor: s.doctorName,
        chiefComplaint: s.chiefComplaint,
        diagnosisText: s.diagnosisSummary,
        summary: s.treatmentSummary,
      },
      receivedAt: s.visitTime,
      writeBusinessRow: async (tx) => {
        const row = await tx.encounterRecord.create({
          data: {
            id: s.id,
            patientId: s.patientId,
            hospitalPatientId: s.hospitalPatientId,
            externalVisitId: s.externalVisitId,
            visitType: s.visitType,
            departmentName: s.departmentName,
            doctorName: s.doctorName,
            visitTime: s.visitTime,
            chiefComplaint: s.chiefComplaint,
            diagnosisSummary: s.diagnosisSummary,
            treatmentSummary: s.treatmentSummary,
            dataSource: 'HIS',
            sourceSystem: GATEWAY_CHANNEL_HIS_EVENT_REST,
          },
        });
        return { type: 'EncounterRecord', id: row.id };
      },
    });
    events += 1;
    promoted += 1;
  }

  // ── 2) Document events → MedicalRecordSummary ────────────────────────────
  // documentType keyword 用于在 promote 流程里映射 MedicalRecordType:
  //   discharge → DISCHARGE_SUMMARY, inpatient → INPATIENT_RECORD,
  //   progress  → PROGRESS_NOTE,     consult   → CONSULTATION_NOTE,
  //   其余       → OUTPATIENT_NOTE
  const RECORD_TYPE_TO_DOC_KEYWORD = {
    OUTPATIENT_NOTE: 'outpatient',
    INPATIENT_RECORD: 'inpatient',
    DISCHARGE_SUMMARY: 'discharge',
    PROGRESS_NOTE: 'progress',
    CONSULTATION_NOTE: 'consultation',
  };
  for (const s of medicalRecordSummarySeeds) {
    const hpId = demoPatients.find((p) => p.id === s.patientId)?.hospitalPatientId;
    await emitGatewayEvent({
      source,
      resourceType: GATEWAY_RESOURCE_DOCUMENT,
      triggerEvent: 'HIS_EVENT.DOCUMENT',
      externalRecordId: s.externalRecordId,
      patientIdentifier: { hospitalPatientId: hpId },
      normalizedPayload: {
        documentType: RECORD_TYPE_TO_DOC_KEYWORD[s.recordType] || 'outpatient',
        createdAt: s.recordTime.toISOString(),
        documentTitle: s.title,
        department: s.departmentName,
        summary: s.summary,
        diagnosisText: s.diagnosisText,
        treatmentPlan: s.treatmentPlan,
        doctorAdvice: s.doctorAdvice,
      },
      receivedAt: s.recordTime,
      writeBusinessRow: async (tx) => {
        const row = await tx.medicalRecordSummary.create({
          data: {
            id: s.id,
            patientId: s.patientId,
            externalRecordId: s.externalRecordId,
            recordType: s.recordType,
            recordTime: s.recordTime,
            departmentName: s.departmentName,
            title: s.title,
            summary: s.summary,
            diagnosisText: s.diagnosisText,
            treatmentPlan: s.treatmentPlan,
            doctorAdvice: s.doctorAdvice,
            dataSource: 'EMR',
            sourceSystem: GATEWAY_CHANNEL_HIS_EVENT_REST,
          },
        });
        return { type: 'MedicalRecordSummary', id: row.id };
      },
    });
    events += 1;
    promoted += 1;
  }

  // ── 3) Exam-report events → ExamReportRecord ─────────────────────────────
  for (const s of examReportSeeds) {
    const hpId = demoPatients.find((p) => p.id === s.patientId)?.hospitalPatientId;
    await emitGatewayEvent({
      source,
      resourceType: GATEWAY_RESOURCE_EXAM_REPORT,
      triggerEvent: 'HIS_EVENT.EXAM_REPORT',
      externalRecordId: s.externalExamId,
      patientIdentifier: { hospitalPatientId: hpId },
      normalizedPayload: {
        examType: s.examType,
        examName: s.examName,
        examTime: s.examTime.toISOString(),
        department: s.departmentName,
        finding: s.finding,
        conclusion: s.conclusion,
        reportUrl: s.reportUrl,
      },
      receivedAt: s.examTime,
      writeBusinessRow: async (tx) => {
        const row = await tx.examReportRecord.create({
          data: {
            id: s.id,
            patientId: s.patientId,
            externalExamId: s.externalExamId,
            examType: s.examType,
            examName: s.examName,
            examTime: s.examTime,
            departmentName: s.departmentName,
            finding: s.finding,
            conclusion: s.conclusion,
            reportUrl: s.reportUrl,
            dataSource: 'HIS',
            sourceSystem: GATEWAY_CHANNEL_HIS_EVENT_REST,
          },
        });
        return { type: 'ExamReportRecord', id: row.id };
      },
    });
    events += 1;
    promoted += 1;
  }

  // ── 4) Medication events → HospitalMedicationOrder ───────────────────────
  // 注意: 处方有 FK 引用 encounterRecord, 而 encounter 已在第 1 步建好,
  // 所以这一步可以直接引用 encounterRecordId。
  for (const s of hospitalMedicationOrderSeeds) {
    const hpId = demoPatients.find((p) => p.id === s.patientId)?.hospitalPatientId;
    await emitGatewayEvent({
      source,
      resourceType: GATEWAY_RESOURCE_MEDICATION,
      triggerEvent: 'HIS_EVENT.PRESCRIPTION',
      externalRecordId: s.externalOrderId,
      patientIdentifier: { hospitalPatientId: hpId },
      normalizedPayload: {
        drugName: s.medicationName,
        dosage: s.dosage,
        frequency: s.frequency,
        instructions: `${s.route ?? ''} ${s.duration ?? ''}`.trim() || undefined,
        startDate: s.prescribedAt.toISOString(),
      },
      receivedAt: s.prescribedAt,
      writeBusinessRow: async (tx) => {
        const row = await tx.hospitalMedicationOrder.create({
          data: {
            id: s.id,
            patientId: s.patientId,
            externalOrderId: s.externalOrderId,
            encounterRecordId: s.encounterRecordId,
            medicationName: s.medicationName,
            dosage: s.dosage,
            frequency: s.frequency,
            route: s.route,
            duration: s.duration,
            prescribedBy: s.prescribedBy,
            prescribedAt: s.prescribedAt,
            dataSource: 'HIS',
            sourceSystem: GATEWAY_CHANNEL_HIS_EVENT_REST,
          },
        });
        return { type: 'HospitalMedicationOrder', id: row.id };
      },
    });
    events += 1;
    promoted += 1;
  }

  return { events, promoted };
}

async function seedClinicalDemo() {
  const patientIds = demoPatients.map((p) => p.id);
  const chronicLeadIds = chronicLeadSeeds.map((l) => l.id);
  const consentIds = consentSeeds.map((c) => c.id);
  const consentOpenIds = [...new Set(consentSeeds.map((c) => c.demoOpenId))];

  await prisma.$transaction([
    prisma.medicationCheckIn.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.questionnaireResult.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.patientSession.deleteMany({ where: { patientId: { in: patientIds } } }),

    // hospital-records-seed (gateway-driven): 删除顺序很关键。
    //   1. 先删审计层 IntegrationSyncRecord, 因为他们携带 localTargetId 指向业务表;
    //      留下来会出现"审计在但主数据没了"的悬挂引用, 导致【接口中心】点详情时 500。
    //   2. HospitalMedicationOrder 有 FK → EncounterRecord, 先删处方再删就诊。
    //   3. 业务表按 patientId 清, 跟之前一致。
    prisma.integrationSyncRecord.deleteMany({
      where: { externalRecordId: { in: HOSPITAL_RECORD_DEMO_EXTERNAL_IDS } },
    }),
    prisma.hospitalMedicationOrder.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.encounterRecord.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.medicalRecordSummary.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.examReportRecord.deleteMany({ where: { patientId: { in: patientIds } } }),


    // patient-self-consent-bind: PatientConsent 没有 FK，按 demoOpenId / id / patientId
    // 三个维度兜底清理，保证多次跑 seed 不残留旧 demo 数据。
    prisma.patientConsent.deleteMany({
      where: {
        OR: [
          { id: { in: consentIds } },
          { demoOpenId: { in: consentOpenIds } },
          { patientId: { in: patientIds } },
        ],
      },
    }),

    prisma.patientBindingRequest.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.task.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.followUpRecord.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.hospitalVisitReminder.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.riskAlert.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.vitalRecord.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.vitalMonitoringPlan.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.medicationRecord.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.diseaseProfile.deleteMany({ where: { patientId: { in: patientIds } } }),

    // patient-prestart-gate: 先清掉 demo ChronicLead，再删 Patient，避免遗留
    // promotedPatientId 指向已删除的 patient（虽 onDelete 是 SetNull，留干净更稳）。
    prisma.chronicLead.deleteMany({ where: { id: { in: chronicLeadIds } } }),

    prisma.patient.deleteMany({ where: { id: { in: patientIds } } }),
  ]);

  for (const patient of demoPatients) {
    await prisma.patient.create({ data: { ...patient, hospitalTenantId: 'demo-tenant-001' } });
  }

  for (const [index, seed] of profileSeeds.entries()) {
    const [id, patientId, diseaseType, riskLevel, diseaseStage, complications, comorbidities] = seed;
    await prisma.diseaseProfile.create({
      data: {
        id,
        patientId,
        diseaseType,
        riskLevel,
        diseaseStage,
        complications,
        comorbidities,
        diagnosisDate: daysAgo(365 * (2 + (index % 6)), 0, 0),
        dataSource: patientId === 'demo-patient-001' || patientId === 'demo-patient-002' ? 'EMR' : 'NURSE_INPUT',
        createdAt: daysAgo(14, 9, 0),
      },
    });
  }

  for (const plan of planSeeds) {
    await prisma.vitalMonitoringPlan.create({
      data: {
        ...plan,
        reminderLeadMinutes: 180,
        checkInWindowBeforeMinutes: 180,
        missedWindowAfterMinutes: 180,
        evidenceSource: 'clinical-demo-v2-seed',
        isActive: true,
        createdAt: daysAgo(14, 10, 0),
      },
    });
  }

  for (const med of medicationSeeds) {
    await prisma.medicationRecord.create({
      data: {
        ...med,
        reminderLeadMinutes: 180,
        checkInWindowBeforeMinutes: 180,
        missedWindowAfterMinutes: 180,
        dataSource: 'EMR',
        isActive: true,
        startDate: daysAgo(45, 0, 0),
        createdAt: daysAgo(14, 10, 30),
      },
    });
  }

  for (const [id, patientId, type, value, unit, measuredAt, isAbnormal, monitoringPlanId, note] of vitalSeeds) {
    await prisma.vitalRecord.create({
      data: {
        id,
        patientId,
        type,
        value,
        unit,
        measuredAt,
        dataSource: type === 'LDL_C' ? 'LIS' : 'MINI_PROGRAM',
        isAbnormal,
        monitoringPlanId: monitoringPlanId || undefined,
        scheduledAt: monitoringPlanId ? measuredAt : undefined,
        note,
        createdAt: measuredAt,
      },
    });
  }

  for (const alert of alertSeeds) {
    await prisma.riskAlert.create({ data: alert });
  }

  for (const reminder of hospitalVisitReminderSeeds) {
    await prisma.hospitalVisitReminder.create({ data: reminder });
  }

  for (const task of taskSeeds) {
    await prisma.task.create({ data: task });
  }

  await prisma.followUpRecord.createMany({ data: followUpSeeds });
  await prisma.medicationCheckIn.createMany({ data: buildMedicationCheckIns() });
  await prisma.questionnaireResult.createMany({ data: questionnaireSeeds });
  await prisma.patientBindingRequest.createMany({ data: bindingSeeds });
  await prisma.patientSession.createMany({ data: sessionSeeds });

  // patient-prestart-gate: 必须在 Patient 都建好后再建 ChronicLead，因为
  // demo-lead-signed-001.promotedPatientId 引用 demo-patient-002 (FK)。
  for (const lead of chronicLeadSeeds) {
    await prisma.chronicLead.create({ data: lead });
  }

  // patient-self-consent-bind: 同意书在绑定申请和线索建好之后落，
  // 这样 chronicLeadId / bindingRequestId 的反向链都不会变成悬挂引用。
  await prisma.patientConsent.createMany({ data: consentSeeds });

  // hospital-records-seed (gateway-driven):
  // 不再绕过网关直接 createMany 院内病历表 — 改为模拟「医院 HIS 通过
  // POST /gateway/his/events/* 把事件推到网关 → 审计层落库 → promote 到主数据」
  // 这条生产链路，让 demo 行为和真实接入一致。详见 seedHospitalRecordsViaGateway。
  const gatewayCounts = await seedHospitalRecordsViaGateway();
  console.log(
    `  ✓ Gateway-driven hospital records: ${gatewayCounts.events} events ingested, `
    + `${gatewayCounts.promoted} promoted to business tables`,
  );

  // 落库后立即按 demo-patient-001 (王建国) 反查 4 张业务表 + 审计表, 确认前端
  // GET /patients/demo-patient-001/encounter-records 等接口能拿到数据。
  const verifyPatientId = 'demo-patient-001';
  const [vEnc, vMed, vExm, vRx, vAudit] = await Promise.all([
    prisma.encounterRecord.findMany({ where: { patientId: verifyPatientId }, orderBy: { visitTime: 'desc' } }),
    prisma.medicalRecordSummary.findMany({ where: { patientId: verifyPatientId }, orderBy: { recordTime: 'desc' } }),
    prisma.examReportRecord.findMany({ where: { patientId: verifyPatientId }, orderBy: { examTime: 'desc' } }),
    prisma.hospitalMedicationOrder.findMany({ where: { patientId: verifyPatientId }, orderBy: { prescribedAt: 'desc' } }),
    prisma.integrationSyncRecord.count({
      where: {
        promotionStatus: 'PROMOTED',
        externalRecordId: { in: HOSPITAL_RECORD_DEMO_EXTERNAL_IDS },
      },
    }),
  ]);
  console.log(
    `  ✓ Verify ${verifyPatientId} (王建国): enc=${vEnc.length} medrec=${vMed.length} `
    + `exam=${vExm.length} rx=${vRx.length}  |  audit-rows PROMOTED=${vAudit}`,
  );

  console.log('Clinical demo v2 seed completed:');
  console.log(`- ${demoPatients.length} patients`);
  console.log(`- ${profileSeeds.length} disease profiles`);
  console.log(`- ${planSeeds.length} monitoring plans`);
  console.log(`- ${vitalSeeds.length} vital records with 14-day trends`);
  console.log(`- ${buildMedicationCheckIns().length} medication check-ins`);
  console.log(`- ${taskSeeds.length} tasks, including hospital-visit follow-up tasks`);
  console.log(`- ${hospitalVisitReminderSeeds.filter((item) => item.status === 'ACTIVE').length} active hospital-visit reminders`);
  console.log(
    `- ${chronicLeadSeeds.length} chronic leads (pending/contacted/deferred/signed/rejected/expired)`,
  );
  console.log(
    `- ${encounterSeeds.length} encounter records (就诊记录)`,
  );
  console.log(
    `- ${medicalRecordSummarySeeds.length} medical record summaries (病历摘要)`,
  );
  console.log(
    `- ${examReportSeeds.length} exam reports (检查报告)`,
  );
  console.log(
    `- ${hospitalMedicationOrderSeeds.length} hospital medication orders (院内处方)`,
  );
  console.log(
    `- ${consentSeeds.length} patient consents (consent version ${PATIENT_CONSENT_VERSION})`,
  );
}



// patient-engagement-wechat-h5-v1 seed
//
// 创建 demo HospitalTenant, 把现有 demo users/patients 归到该 tenant,
// 给前 2 个 patient 创建 PatientWechatIdentity (本院服务号已关注),
// 给若干 patient 创建 PatientFormLink + PatientOutboundMessage 演示数据。
async function seedPatientEngagement() {
  const cryptoLib = require('crypto');

  function tokenHashFor(token) {
    return cryptoLib.createHash('sha256').update(token, 'utf8').digest('hex');
  }

  const tenant = await ensurePrimaryDemoTenant();

  // Users remain nullable for platform administrators; clinical patients are
  // tenant-required as of v9.2 and are created with an explicit tenant.
  await prisma.user.updateMany({
    where: { hospitalTenantId: null },
    data: { hospitalTenantId: tenant.id },
  });

  // patient_engagement_hospital_wechat_v2:
  //   per-hospital WeChat 服务号. dev 用 mock 配置 + dev-encrypted secret.
  //   secret-crypto.util 使用相同的 PATIENT_ENGAGEMENT_SECRET_KEY 派生密钥.
  //   这里手写一份 envelope (v1.<iv>.<ct>.<tag>) 太脆弱 — 改在 patient-engagement
  //   service 启动时再加密一次也行; 但 seed 想 idempotent 不依赖运行时, 所以
  //   存一段 base64 marker "dev-encrypted-secret" 占位, 让 decryptSecret 安全失败
  //   回退到"请重新设置". 真实开发只要在 UI 上重新填写 appSecret 即可.
  await prisma.hospitalWechatOfficialAccount.upsert({
    where: { hospitalTenantId: tenant.id },
    update: {
      accountName: '某某市人民医院 · 健康随访',
      appId: 'wx_demo_hospital_001',
      isEnabled: true,
      isVerified: true,
      templateQuestionnaireId: 'tmpl_demo_questionnaire',
      templateVitalId: 'tmpl_demo_vital',
      templateMedicationId: 'tmpl_demo_medication',
      templateHospitalVisitId: 'tmpl_demo_hospital_visit',
    },
    create: {
      hospitalTenantId: tenant.id,
      accountName: '某某市人民医院 · 健康随访',
      originalId: 'gh_demo_hospital_001',
      appId: 'wx_demo_hospital_001',
      // Placeholder ciphertext — decryptSecret will gracefully return null;
      // hospital admin should re-enter the appSecret in the UI on first use.
      appSecretEncrypted: 'v1.AAAA.AAAA.AAAA',
      qrCodeUrl: null,
      h5BaseUrl: process.env.PATIENT_ENGAGEMENT_BASE_URL || 'http://localhost:5173',
      oauthCallbackDomain: 'localhost:3000',
      templateQuestionnaireId: 'tmpl_demo_questionnaire',
      templateVitalId: 'tmpl_demo_vital',
      templateMedicationId: 'tmpl_demo_medication',
      templateHospitalVisitId: 'tmpl_demo_hospital_visit',
      isEnabled: true,
      isVerified: true,
    },
  });


  const wechatIdentities = [
    { patientId: 'demo-patient-001', openId: 'demo-openid-wjg-001' },
    { patientId: 'demo-patient-002', openId: 'demo-openid-lxl-002' },
  ];
  // patient_engagement_hospital_wechat_v2_1: second tenant + bindings
  const tenant2 = await prisma.hospitalTenant.upsert({
    where: { code: 'demo-clinic-2' },
    update: { name: '示例三甲医院 · 慢病随访', displayName: '示例三甲医院 · 慢病随访', isActive: true },
    create: {
      id: 'demo-tenant-002',
      code: 'demo-clinic-2',
      name: '示例三甲医院 · 慢病随访',
      displayName: '示例三甲医院 · 慢病随访',
      isActive: true,
    },
  });
  await prisma.user.update({
    where: { username: 'nurse2' },
    data: { hospitalTenantId: tenant2.id },
  });
  await prisma.hospitalWechatOfficialAccount.upsert({
    where: { hospitalTenantId: tenant2.id },
    update: {
      accountName: '示例三甲医院 · 健康随访',
      appId: 'wx_demo_hospital_002',
      isEnabled: true,
      isVerified: true,
      templateQuestionnaireId: 'tmpl_demo_questionnaire_2',
      templateVitalId: 'tmpl_demo_vital_2',
      templateMedicationId: 'tmpl_demo_medication_2',
      templateHospitalVisitId: 'tmpl_demo_hospital_visit_2',
    },
    create: {
      hospitalTenantId: tenant2.id,
      accountName: '示例三甲医院 · 健康随访',
      originalId: 'gh_demo_hospital_002',
      appId: 'wx_demo_hospital_002',
      appSecretEncrypted: 'v1.AAAA.AAAA.AAAA',
      h5BaseUrl: process.env.PATIENT_ENGAGEMENT_BASE_URL || 'http://localhost:5173',
      oauthCallbackDomain: 'localhost:3000',
      templateQuestionnaireId: 'tmpl_demo_questionnaire_2',
      templateVitalId: 'tmpl_demo_vital_2',
      templateMedicationId: 'tmpl_demo_medication_2',
      templateHospitalVisitId: 'tmpl_demo_hospital_visit_2',
      isEnabled: true,
      isVerified: true,
    },
  });
  await prisma.patient.upsert({
    where: { id: 'demo-patient-101' },
    update: {
      hospitalTenant: { connect: { id: tenant2.id } },
      name: '示例患者 · 三甲',
      phone: '13700001011',
    },
    create: {
      id: 'demo-patient-101',
      hospitalPatientId: 'CLINIC2-001',
      hospitalTenant: { connect: { id: tenant2.id } },
      name: '示例患者 · 三甲',
      gender: 'MALE',
      birthDate: new Date('1965-03-20'),
      phone: '13700001011',
    },
  });

  for (const ident of wechatIdentities) {
    // patient_engagement_hospital_wechat_v2: openId 归属到具体医院.
    await prisma.patientWechatIdentity.upsert({
      where: {
        hospitalTenantId_appId_openId: {
          hospitalTenantId: 'demo-tenant-001',
          appId: 'wx_demo_hospital_001',
          openId: ident.openId,
        },
      },
      update: {
        patientId: ident.patientId,
        hospitalTenantId: 'demo-tenant-001',
        isVerified: true,
        verifiedAt: new Date(),
        source: 'OFFICIAL_ACCOUNT_H5',
      },
      create: {
        patientId: ident.patientId,
        hospitalTenantId: 'demo-tenant-001',
        appId: 'wx_demo_hospital_001',
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
        errorMessage: '患者尚未关注本院服务号 (没有 openId)',
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
        content: `${seed.title}
（演示数据，dev 模式 mock 发送）`,
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


/* care-reminders v3 demo seed (idempotent — relies on upsert + skipDuplicates) */
async function seedCareReminders() {
  // 1) Backfill timezone on both demo tenants (the column is NOT NULL with a
  // default, so this is mostly cosmetic, but it makes the value explicit).
  await prisma.hospitalTenant.update({
    where: { id: 'demo-tenant-001' },
    data: { timezone: 'Asia/Shanghai' },
  }).catch(() => {});
  await prisma.hospitalTenant.update({
    where: { id: 'demo-tenant-002' },
    data: { timezone: 'Asia/Shanghai' },
  }).catch(() => {});

  // 2) Schedules
  const sched1 = await prisma.careReminderSchedule.upsert({
    where: { id: 'demo-care-sched-001-med' },
    update: {},
    create: {
      id: 'demo-care-sched-001-med',
      hospitalTenantId: 'demo-tenant-001',
      patientId: 'demo-patient-001',
      sourceType: 'MEDICATION',
      sourceId: 'demo-med-001',
      title: '服药提醒: 苯磺酸氨氯地平片 5mg',
      description: '请按时服用降压药，并在小程序或本链接确认。',
      reminderType: 'MEDICATION_CHECKIN',
      frequencyUnit: 'DAY',
      timesPerUnit: 1,
      scheduledTimes: ['08:00'],
      payload: { medicationId: 'demo-med-001', medicationName: '苯磺酸氨氯地平片', dosage: '5mg' },
      checkInWindowBeforeMinutes: 60,
      checkInWindowAfterMinutes: 240,
      escalationAfterMinutes: 240,
      isActive: true,
      createdBy: 'demo-care-nurse-a',
    },
  });

  const sched2 = await prisma.careReminderSchedule.upsert({
    where: { id: 'demo-care-sched-001-bp' },
    update: {},
    create: {
      id: 'demo-care-sched-001-bp',
      hospitalTenantId: 'demo-tenant-001',
      patientId: 'demo-patient-001',
      sourceType: 'VITAL',
      sourceId: 'demo-vital-plan-001-bp',
      title: '血压（收缩压/舒张压）打卡提醒',
      description: '请每日早晚各测量并上传血压。',
      reminderType: 'VITAL_RECHECK',
      frequencyUnit: 'DAY',
      timesPerUnit: 2,
      scheduledTimes: ['07:30', '19:30'],
      payload: {
        vitalPlanId: 'demo-vital-plan-001-bp',
        vitalType: 'BLOOD_PRESSURE',
        displayName: '血压（收缩压/舒张压）',
        unit: 'mmHg',
      },
      checkInWindowBeforeMinutes: 60,
      checkInWindowAfterMinutes: 360,
      escalationAfterMinutes: 360,
      isActive: true,
      createdBy: 'demo-care-nurse-a',
    },
  });

  await prisma.careReminderSchedule.upsert({
    where: { id: 'demo-care-sched-003-glu' },
    update: {},
    create: {
      id: 'demo-care-sched-003-glu',
      hospitalTenantId: 'demo-tenant-001',
      patientId: 'demo-patient-003',
      sourceType: 'VITAL',
      sourceId: 'demo-vital-plan-003-spo2',
      title: '血氧打卡提醒 (短信兜底)',
      description: '请按时打卡血氧。',
      reminderType: 'VITAL_RECHECK',
      frequencyUnit: 'DAY',
      timesPerUnit: 1,
      scheduledTimes: ['09:00'],
      payload: {
        vitalPlanId: 'demo-vital-plan-003-spo2',
        vitalType: 'SPO2',
        displayName: '血氧',
        unit: '%',
      },
      checkInWindowBeforeMinutes: 30,
      checkInWindowAfterMinutes: 180,
      escalationAfterMinutes: 180,
      isActive: true,
      createdBy: 'demo-care-nurse-a',
    },
  });

  const demoMedication101 = await prisma.medicationRecord.upsert({
    where: { id: 'demo-med-101' },
    update: {
      patientId: 'demo-patient-101',
      medicationName: '示例药物',
      dosage: '示例剂量',
      frequency: '每日 1 次',
      frequencyUnit: 'DAY',
      timesPerUnit: 1,
      timingRelation: 'NONE',
      customDoseTimes: ['09:00'],
      reminderLeadMinutes: 180,
      checkInWindowBeforeMinutes: 60,
      missedWindowAfterMinutes: 240,
      dataSource: 'EMR',
      isActive: true,
    },
    create: {
      id: 'demo-med-101',
      patientId: 'demo-patient-101',
      medicationName: '示例药物',
      dosage: '示例剂量',
      frequency: '每日 1 次',
      frequencyUnit: 'DAY',
      timesPerUnit: 1,
      timingRelation: 'NONE',
      customDoseTimes: ['09:00'],
      reminderLeadMinutes: 180,
      checkInWindowBeforeMinutes: 60,
      missedWindowAfterMinutes: 240,
      dataSource: 'EMR',
      isActive: true,
    },
  });

  await prisma.careReminderSchedule.upsert({
    where: { id: 'demo-care-sched-101-med' },
    update: {
      sourceId: demoMedication101.id,
      payload: {
        medicationId: demoMedication101.id,
        medicationName: demoMedication101.medicationName,
        dosage: demoMedication101.dosage,
      },
    },
    create: {
      id: 'demo-care-sched-101-med',
      hospitalTenantId: 'demo-tenant-002',
      patientId: 'demo-patient-101',
      sourceType: 'MEDICATION',
      sourceId: demoMedication101.id,
      title: '服药提醒 (示例三甲)',
      description: '示例三甲医院的演示提醒，用于跨租户验证。',
      reminderType: 'MEDICATION_CHECKIN',
      frequencyUnit: 'DAY',
      timesPerUnit: 1,
      scheduledTimes: ['09:00'],
      payload: {
        medicationId: demoMedication101.id,
        medicationName: demoMedication101.medicationName,
        dosage: demoMedication101.dosage,
      },
      checkInWindowBeforeMinutes: 60,
      checkInWindowAfterMinutes: 240,
      escalationAfterMinutes: 240,
      isActive: true,
      createdBy: 'demo-care-nurse-a',
    },
  });

  // 3) Sample occurrences for the UI demo. Use deterministic ids so re-running
  //    is a no-op via upsert.
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  const yesterday20 = new Date(now.getTime() - 26 * 60 * 60 * 1000);
  const yesterday8 = new Date(now.getTime() - 38 * 60 * 60 * 1000);
  const twoDaysAgo8 = new Date(now.getTime() - 62 * 60 * 60 * 1000);

  const sampleOccurrences = [
    {
      id: 'demo-care-occ-pending-001',
      scheduleId: sched1.id,
      occurrenceType: 'MEDICATION_CHECKIN',
      title: sched1.title,
      dueAt: inOneHour,
      availableFrom: new Date(inOneHour.getTime() - 60 * 60 * 1000),
      availableUntil: new Date(inOneHour.getTime() + 4 * 60 * 60 * 1000),
      status: 'PENDING',
    },
    {
      id: 'demo-care-occ-completed-001',
      scheduleId: sched1.id,
      occurrenceType: 'MEDICATION_CHECKIN',
      title: sched1.title,
      dueAt: yesterday8,
      availableFrom: new Date(yesterday8.getTime() - 60 * 60 * 1000),
      availableUntil: new Date(yesterday8.getTime() + 4 * 60 * 60 * 1000),
      status: 'COMPLETED',
      completedAt: new Date(yesterday8.getTime() + 30 * 60 * 1000),
      resultType: 'MedicationCheckIn',
      resultId: 'demo-med-check-001-d01',
    },
    {
      id: 'demo-care-occ-missed-001',
      scheduleId: sched2.id,
      occurrenceType: 'VITAL_RECHECK',
      title: sched2.title,
      dueAt: yesterday20,
      availableFrom: new Date(yesterday20.getTime() - 60 * 60 * 1000),
      availableUntil: new Date(yesterday20.getTime() + 6 * 60 * 60 * 1000),
      status: 'MISSED',
      missedAt: new Date(yesterday20.getTime() + 6 * 60 * 60 * 1000),
    },
    {
      id: 'demo-care-occ-pending-002',
      scheduleId: sched1.id,
      occurrenceType: 'MEDICATION_CHECKIN',
      title: sched1.title,
      dueAt: twoDaysAgo8,
      availableFrom: new Date(twoDaysAgo8.getTime() - 60 * 60 * 1000),
      availableUntil: new Date(twoDaysAgo8.getTime() + 4 * 60 * 60 * 1000),
      status: 'MISSED',
      missedAt: new Date(twoDaysAgo8.getTime() + 4 * 60 * 60 * 1000),
    },
  ];

  for (const seed of sampleOccurrences) {
    await prisma.careReminderOccurrence.upsert({
      where: { id: seed.id },
      update: {},
      create: {
        ...seed,
        hospitalTenantId: 'demo-tenant-001',
        patientId: 'demo-patient-001',
      },
    });
  }

  // 4) One demo direct message (requiresAck) from demo-care-nurse-a to demo-patient-001.
  // Skip if it exists.
  const existingDirect = await prisma.patientDirectMessage.findFirst({
    where: { id: 'demo-direct-msg-001' },
    select: { id: true },
  });
  if (!existingDirect) {
    await prisma.patientDirectMessage.create({
      data: {
        id: 'demo-direct-msg-001',
        hospitalTenantId: 'demo-tenant-001',
        patientId: 'demo-patient-001',
        senderId: 'demo-care-nurse-a',
        title: '请确认本周复查时间',
        content: '王先生您好, 您本周三上午 9:00 复查门诊, 请按时来院。如有疑问请回复或致电护士站。',
        priority: 'IMPORTANT',
        channel: 'WECHAT_OFFICIAL_ACCOUNT',
        status: 'SENT',
        requiresAck: true,
      },
    });
  }

  console.log('Care reminders v3 demo seeded:');
  console.log('- 4 CareReminderSchedule rows (med×2, vital×2)');
  console.log('- 4 CareReminderOccurrence rows (PENDING / COMPLETED / MISSED ×2)');
  console.log('- 1 PatientDirectMessage (requiresAck=true)');
}

async function main() {
  console.log('🚀 Starting unified clinical demo seed...');
  await seedAuth();
  await ensurePrimaryDemoTenant();
  await seedClinicalRules();
  await seedIntegrations();
  await seedClinicalDemo();
  await seedPatientEngagement();
  await seedCareReminders();
  console.log('\n✅ Unified clinical demo seed completed.');
  console.log('   Login users: admin/admin123, doctor/doctor123, nurse/nurse123, manager/manager123');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });




