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
 */

const {
  PrismaClient,
  DiseaseType,
  IntegrationSystemType,
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
    id: 'nurse-001',
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
];

async function seedAuth() {
  for (const user of authDemoUsers) {
    const salt = `auth-demo-v1-${user.username}`;
    await prisma.user.upsert({
      where: { username: user.username },
      update: {
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

async function seedClinicalRules() {
  for (const template of clinicalRuleTemplates) {
    const dbTemplate = await prisma.diseaseRuleTemplate.upsert({
      where: { diseaseType_version: { diseaseType: template.diseaseType, version: 'v1' } },
      update: {
        templateName: template.templateName,
        description: template.description,
        managementGoal: template.managementGoal,
        riskBasis: template.riskBasis,
        isActive: true,
      },
      create: {
        id: template.id,
        diseaseType: template.diseaseType,
        templateName: template.templateName,
        description: template.description,
        managementGoal: template.managementGoal,
        riskBasis: template.riskBasis,
        version: 'v1',
        isActive: true,
      },
    });

    for (const [id, vitalType, displayName, unit, operator, thresholdValue, thresholdValueMax, riskLevel, alertTitle, followUpAction, sortOrder] of template.vitalThresholdRules) {
      await prisma.vitalThresholdRule.upsert({
        where: { id },
        update: { templateId: dbTemplate.id, vitalType, displayName, unit, operator, thresholdValue, thresholdValueMax, riskLevel, alertTitle, alertDescription: followUpAction, followUpAction, sortOrder, isActive: true },
        create: { id, templateId: dbTemplate.id, vitalType, displayName, unit, operator, thresholdValue, thresholdValueMax, riskLevel, alertTitle, alertDescription: followUpAction, followUpAction, sortOrder, isActive: true },
      });
    }

    for (const [id, riskLevel, followUpType, dueWithinHours, frequencyDescription, taskTitle, instruction] of template.followUpPolicies) {
      await prisma.followUpPolicy.upsert({
        where: { id },
        update: { templateId: dbTemplate.id, riskLevel, followUpType, dueWithinHours, frequencyDescription, taskTitle, instruction, isActive: true },
        create: { id, templateId: dbTemplate.id, riskLevel, followUpType, dueWithinHours, frequencyDescription, taskTitle, instruction, isActive: true },
      });
    }

    for (const [id, questionnaireType, title, description] of template.questionnaires) {
      await prisma.questionnaireTemplate.upsert({
        where: { id },
        update: { templateId: dbTemplate.id, questionnaireType, title, description, scoringRule: { demo: true }, riskBands: [{ riskLevel: 'LOW' }, { riskLevel: 'MEDIUM' }, { riskLevel: 'HIGH' }], isActive: true },
        create: { id, templateId: dbTemplate.id, questionnaireType, title, description, scoringRule: { demo: true }, riskBands: [{ riskLevel: 'LOW' }, { riskLevel: 'MEDIUM' }, { riskLevel: 'HIGH' }], isActive: true },
      });
    }
  }

  console.log(`Clinical rules seeded: ${clinicalRuleTemplates.length} disease templates`);
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

async function seedIntegrations() {
  for (const source of integrationSources) {
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

  for (const [sourceCode, targetModel, externalField, localField, displayName, isRequired] of integrationMappings) {
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


const nurseId = 'nurse-001';
const doctorId = 'doctor-001';
const demoOpenId = 'demo-openid-patient-001';

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

async function seedClinicalDemo() {
  const patientIds = demoPatients.map((p) => p.id);

  await prisma.$transaction([
    prisma.medicationCheckIn.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.questionnaireResult.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.patientSession.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.patientBindingRequest.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.task.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.followUpRecord.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.hospitalVisitReminder.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.riskAlert.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.vitalRecord.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.vitalMonitoringPlan.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.medicationRecord.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.diseaseProfile.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.patient.deleteMany({ where: { id: { in: patientIds } } }),
  ]);

  for (const patient of demoPatients) {
    await prisma.patient.create({ data: patient });
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

  console.log('Clinical demo v2 seed completed:');
  console.log(`- ${demoPatients.length} patients`);
  console.log(`- ${profileSeeds.length} disease profiles`);
  console.log(`- ${planSeeds.length} monitoring plans`);
  console.log(`- ${vitalSeeds.length} vital records with 14-day trends`);
  console.log(`- ${buildMedicationCheckIns().length} medication check-ins`);
  console.log(`- ${taskSeeds.length} tasks, including hospital-visit follow-up tasks`);
  console.log(`- ${hospitalVisitReminderSeeds.filter((item) => item.status === 'ACTIVE').length} active hospital-visit reminders`);
}


async function main() {
  console.log('🚀 Starting unified clinical demo seed...');
  await seedAuth();
  await seedClinicalRules();
  await seedIntegrations();
  await seedClinicalDemo();
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


