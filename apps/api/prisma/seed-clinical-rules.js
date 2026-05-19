/*
 * Clinical Rules/Templates v1 seed data.
 * Run from apps/api:
 *   node prisma/seed-clinical-rules.js
 */

const { PrismaClient, DiseaseType, RiskLevel } = require('@prisma/client');

const prisma = new PrismaClient();

const templates = [
  {
    id: 'rule-template-hypertension-v1',
    diseaseType: DiseaseType.HYPERTENSION,
    templateName: '高血压分层管理模板',
    description: '家庭血压上传后的自动异常识别、风险分层和护士随访任务生成。',
    managementGoal: '识别收缩压/舒张压异常，优先处理高危和极高危患者。',
    riskBasis: '演示规则参考常见慢病管理阈值，正式上线时由医院按指南配置。',
    vitalThresholdRules: [
      ['thr-htn-sbp-vhigh', 'SYSTOLIC_BP', '收缩压', 'mmHg', 'GTE', 180, null, RiskLevel.VERY_HIGH, '收缩压极高危预警', '4 小时内电话复核，必要时建议急诊/门诊复诊。', 10],
      ['thr-htn-sbp-high', 'SYSTOLIC_BP', '收缩压', 'mmHg', 'GTE', 160, null, RiskLevel.HIGH, '收缩压高危预警', '24 小时内电话随访，提醒复测并核对用药。', 20],
      ['thr-htn-sbp-medium', 'SYSTOLIC_BP', '收缩压', 'mmHg', 'GTE', 140, null, RiskLevel.MEDIUM, '收缩压异常提醒', '3 日内提醒复测，持续异常则升级。', 30],
      ['thr-htn-dbp-vhigh', 'DIASTOLIC_BP', '舒张压', 'mmHg', 'GTE', 110, null, RiskLevel.VERY_HIGH, '舒张压极高危预警', '4 小时内电话复核，确认危险症状。', 40],
      ['thr-htn-dbp-high', 'DIASTOLIC_BP', '舒张压', 'mmHg', 'GTE', 100, null, RiskLevel.HIGH, '舒张压高危预警', '24 小时内电话随访，提醒复测并核对用药。', 50],
      ['thr-htn-dbp-medium', 'DIASTOLIC_BP', '舒张压', 'mmHg', 'GTE', 90, null, RiskLevel.MEDIUM, '舒张压异常提醒', '3 日内提醒复测。', 60],
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
      ['thr-chd-sbp-high', 'SYSTOLIC_BP', '收缩压', 'mmHg', 'GTE', 160, null, RiskLevel.HIGH, '冠心病合并血压高危预警', '当日随访并建议复测。', 20],
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

async function main() {
  for (const template of templates) {
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

  console.log(`Clinical rules seeded: ${templates.length} disease templates`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
