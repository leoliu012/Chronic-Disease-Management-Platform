import { DiseaseType, RiskLevel } from '@prisma/client';

export type DefaultVitalThresholdRule = {
  id: string;
  vitalType: string;
  displayName: string;
  unit: string;
  operator: string;
  thresholdValue: number;
  thresholdValueMax?: number | null;
  riskLevel: RiskLevel;
  alertTitle: string;
  alertDescription: string;
  followUpAction: string;
  sortOrder: number;
};

export type DefaultFollowUpPolicy = {
  id: string;
  riskLevel: RiskLevel;
  followUpType: string;
  dueWithinHours: number;
  frequencyDescription: string;
  taskTitle: string;
  instruction: string;
};

export type DefaultQuestionnaireTemplate = {
  id: string;
  questionnaireType: string;
  title: string;
  description: string;
  scoringRule: unknown;
  riskBands: unknown;
};

export type DefaultDiseaseRuleTemplate = {
  id: string;
  diseaseType: DiseaseType;
  templateName: string;
  description: string;
  managementGoal: string;
  riskBasis: string;
  vitalThresholdRules: DefaultVitalThresholdRule[];
  followUpPolicies: DefaultFollowUpPolicy[];
  questionnaireTemplates: DefaultQuestionnaireTemplate[];
};

export const defaultDiseaseRuleTemplates: DefaultDiseaseRuleTemplate[] = [
  {
    id: 'rule-template-hypertension-v1',
    diseaseType: DiseaseType.HYPERTENSION,
    templateName: '高血压分层管理模板',
    description: '用于家庭血压上传后的自动异常识别、风险分层和护士随访任务生成。',
    managementGoal: '识别收缩压/舒张压异常，优先处理高危和极高危患者。',
    riskBasis: '演示规则参考常见慢病管理阈值，正式上线时由医院按指南和院内规范配置。',
    vitalThresholdRules: [
      {
        id: 'thr-htn-sbp-vhigh',
        vitalType: 'SYSTOLIC_BP',
        displayName: '血压（收缩压）',
        unit: 'mmHg',
        operator: 'GTE',
        thresholdValue: 180,
        riskLevel: RiskLevel.VERY_HIGH,
        alertTitle: '血压极高危预警',
        alertDescription: '收缩压达到极高危阈值，需尽快复核症状和近期用药。',
        followUpAction: '4 小时内电话复核，必要时建议急诊/门诊复诊。',
        sortOrder: 10,
      },
      {
        id: 'thr-htn-sbp-high',
        vitalType: 'SYSTOLIC_BP',
        displayName: '血压（收缩压）',
        unit: 'mmHg',
        operator: 'GTE',
        thresholdValue: 160,
        riskLevel: RiskLevel.HIGH,
        alertTitle: '血压高危预警',
        alertDescription: '收缩压达到高危阈值，需要护士当日随访。',
        followUpAction: '24 小时内电话随访，提醒复测并核对用药依从性。',
        sortOrder: 20,
      },
      {
        id: 'thr-htn-sbp-medium',
        vitalType: 'SYSTOLIC_BP',
        displayName: '血压（收缩压）',
        unit: 'mmHg',
        operator: 'GTE',
        thresholdValue: 140,
        riskLevel: RiskLevel.MEDIUM,
        alertTitle: '血压异常提醒',
        alertDescription: '收缩压高于常规管理目标，建议复测观察趋势。',
        followUpAction: '3 日内提醒复测，持续异常则转高危随访。',
        sortOrder: 30,
      },
      {
        id: 'thr-htn-dbp-vhigh',
        vitalType: 'DIASTOLIC_BP',
        displayName: '血压（舒张压）',
        unit: 'mmHg',
        operator: 'GTE',
        thresholdValue: 110,
        riskLevel: RiskLevel.VERY_HIGH,
        alertTitle: '血压极高危预警',
        alertDescription: '舒张压达到极高危阈值，需要紧急复核。',
        followUpAction: '4 小时内电话复核，确认头痛、胸闷等危险症状。',
        sortOrder: 40,
      },
      {
        id: 'thr-htn-dbp-high',
        vitalType: 'DIASTOLIC_BP',
        displayName: '血压（舒张压）',
        unit: 'mmHg',
        operator: 'GTE',
        thresholdValue: 100,
        riskLevel: RiskLevel.HIGH,
        alertTitle: '血压高危预警',
        alertDescription: '舒张压达到高危阈值，需要护士随访。',
        followUpAction: '24 小时内电话随访，提醒复测并核对用药。',
        sortOrder: 50,
      },
      {
        id: 'thr-htn-dbp-medium',
        vitalType: 'DIASTOLIC_BP',
        displayName: '血压（舒张压）',
        unit: 'mmHg',
        operator: 'GTE',
        thresholdValue: 90,
        riskLevel: RiskLevel.MEDIUM,
        alertTitle: '血压异常提醒',
        alertDescription: '舒张压高于常规管理目标，建议复测。',
        followUpAction: '3 日内提醒复测。',
        sortOrder: 60,
      },
    ],
    followUpPolicies: [
      {
        id: 'fup-htn-vhigh',
        riskLevel: RiskLevel.VERY_HIGH,
        followUpType: '紧急电话复核',
        dueWithinHours: 4,
        frequencyDescription: '立即复核，必要时转诊/急诊。',
        taskTitle: '立即复核：高血压极高危指标',
        instruction: '确认症状、复测数据、近期用药和是否需要急诊处理。',
      },
      {
        id: 'fup-htn-high',
        riskLevel: RiskLevel.HIGH,
        followUpType: '当日电话随访',
        dueWithinHours: 24,
        frequencyDescription: '当日随访并要求患者复测。',
        taskTitle: '今日随访：高血压高危指标',
        instruction: '确认复测值、用药依从性和生活方式诱因。',
      },
      {
        id: 'fup-htn-medium',
        riskLevel: RiskLevel.MEDIUM,
        followUpType: '异常复测提醒',
        dueWithinHours: 72,
        frequencyDescription: '3 日内复测，持续异常时升级。',
        taskTitle: '异常复测随访：血压异常',
        instruction: '提醒规范测量并观察连续 3 日趋势。',
      },
    ],
    questionnaireTemplates: [
      {
        id: 'q-htn-monthly',
        questionnaireType: 'HYPERTENSION_MONTHLY',
        title: '高血压月度随访问卷',
        description: '记录头痛、头晕、胸闷、服药和家庭血压趋势。',
        scoringRule: { maxScore: 20, fields: ['症状', '用药依从性', '复测情况'] },
        riskBands: [{ min: 0, max: 6, riskLevel: 'LOW' }, { min: 7, max: 13, riskLevel: 'MEDIUM' }, { min: 14, max: 20, riskLevel: 'HIGH' }],
      },
    ],
  },
  {
    id: 'rule-template-diabetes-v1',
    diseaseType: DiseaseType.TYPE_2_DIABETES,
    templateName: '2 型糖尿病分层管理模板',
    description: '用于血糖上传后的自动异常识别、低血糖/高血糖预警和随访安排。',
    managementGoal: '识别血糖明显升高、低血糖风险和持续控制不佳患者。',
    riskBasis: '演示规则参考慢病随访常用阈值，正式上线时由内分泌/慢病中心配置。',
    vitalThresholdRules: [
      {
        id: 'thr-dm-glu-vhigh',
        vitalType: 'BLOOD_GLUCOSE',
        displayName: '血糖',
        unit: 'mmol/L',
        operator: 'GTE',
        thresholdValue: 16.7,
        riskLevel: RiskLevel.VERY_HIGH,
        alertTitle: '血糖极高危预警',
        alertDescription: '血糖显著升高，需要尽快复核症状和处理方案。',
        followUpAction: '4 小时内复核，评估是否需要就医。',
        sortOrder: 10,
      },
      {
        id: 'thr-dm-glu-high',
        vitalType: 'BLOOD_GLUCOSE',
        displayName: '血糖',
        unit: 'mmol/L',
        operator: 'GTE',
        thresholdValue: 11.1,
        riskLevel: RiskLevel.HIGH,
        alertTitle: '血糖高危预警',
        alertDescription: '血糖达到高危阈值，需护士随访。',
        followUpAction: '24 小时内随访饮食、用药和复测情况。',
        sortOrder: 20,
      },
      {
        id: 'thr-dm-glu-medium',
        vitalType: 'BLOOD_GLUCOSE',
        displayName: '血糖',
        unit: 'mmol/L',
        operator: 'GTE',
        thresholdValue: 7.0,
        riskLevel: RiskLevel.MEDIUM,
        alertTitle: '血糖异常提醒',
        alertDescription: '血糖高于管理目标，建议连续复测。',
        followUpAction: '3 日内提醒复测并记录饮食。',
        sortOrder: 30,
      },
      {
        id: 'thr-dm-glu-low',
        vitalType: 'BLOOD_GLUCOSE',
        displayName: '血糖',
        unit: 'mmol/L',
        operator: 'LT',
        thresholdValue: 3.9,
        riskLevel: RiskLevel.HIGH,
        alertTitle: '低血糖风险预警',
        alertDescription: '血糖低于低血糖阈值，需确认症状和处理。',
        followUpAction: '当日联系患者，确认是否已补糖及是否反复发生。',
        sortOrder: 40,
      },
    ],
    followUpPolicies: [
      { id: 'fup-dm-vhigh', riskLevel: RiskLevel.VERY_HIGH, followUpType: '紧急电话复核', dueWithinHours: 4, frequencyDescription: '立即复核症状和酮症风险。', taskTitle: '立即复核：糖尿病极高危血糖', instruction: '确认多饮、多尿、恶心、乏力等症状和近期用药。' },
      { id: 'fup-dm-high', riskLevel: RiskLevel.HIGH, followUpType: '当日电话随访', dueWithinHours: 24, frequencyDescription: '当日随访并安排复测。', taskTitle: '今日随访：糖尿病高危血糖', instruction: '核对饮食、运动、服药和复测结果。' },
      { id: 'fup-dm-medium', riskLevel: RiskLevel.MEDIUM, followUpType: '复测提醒', dueWithinHours: 72, frequencyDescription: '3 日内复测。', taskTitle: '异常复测随访：血糖异常', instruction: '提醒记录空腹/餐后血糖并观察趋势。' },
    ],
    questionnaireTemplates: [
      { id: 'q-dm-monthly', questionnaireType: 'DIABETES_MONTHLY', title: '糖尿病月度随访问卷', description: '记录低血糖、足部症状、饮食运动和服药情况。', scoringRule: { maxScore: 24, fields: ['低血糖', '足部症状', '用药依从性'] }, riskBands: [{ min: 0, max: 8, riskLevel: 'LOW' }, { min: 9, max: 16, riskLevel: 'MEDIUM' }, { min: 17, max: 24, riskLevel: 'HIGH' }] },
    ],
  },
  {
    id: 'rule-template-copd-v1',
    diseaseType: DiseaseType.COPD,
    templateName: '慢阻肺急性加重风险模板',
    description: '用于血氧、心率和症状变化后的风险预警。',
    managementGoal: '识别低血氧和可能急性加重患者。',
    riskBasis: '演示规则用于慢阻肺院外监测场景。',
    vitalThresholdRules: [
      { id: 'thr-copd-spo2-vhigh', vitalType: 'SPO2', displayName: '血氧', unit: '%', operator: 'LT', thresholdValue: 90, riskLevel: RiskLevel.VERY_HIGH, alertTitle: '血氧极高危预警', alertDescription: '血氧低于 90%，需紧急复核。', followUpAction: '4 小时内联系患者，确认呼吸困难程度。', sortOrder: 10 },
      { id: 'thr-copd-spo2-high', vitalType: 'SPO2', displayName: '血氧', unit: '%', operator: 'LT', thresholdValue: 95, riskLevel: RiskLevel.HIGH, alertTitle: '血氧异常预警', alertDescription: '血氧低于 95%，提示可能急性加重。', followUpAction: '24 小时内随访症状和吸入药使用。', sortOrder: 20 },
      { id: 'thr-copd-hr-high', vitalType: 'HEART_RATE', displayName: '心率', unit: 'bpm', operator: 'GTE', thresholdValue: 120, riskLevel: RiskLevel.HIGH, alertTitle: '慢阻肺心率高危预警', alertDescription: '心率明显升高，需结合呼吸症状判断。', followUpAction: '24 小时内复核活动后气促、发热和用药。', sortOrder: 30 },
    ],
    followUpPolicies: [
      { id: 'fup-copd-vhigh', riskLevel: RiskLevel.VERY_HIGH, followUpType: '紧急电话复核', dueWithinHours: 4, frequencyDescription: '立即复核呼吸困难程度。', taskTitle: '立即复核：慢阻肺极高危指标', instruction: '确认血氧复测、呼吸困难、咳痰变化和是否需要就医。' },
      { id: 'fup-copd-high', riskLevel: RiskLevel.HIGH, followUpType: '当日电话随访', dueWithinHours: 24, frequencyDescription: '当日随访症状和吸入药使用。', taskTitle: '今日随访：慢阻肺高危指标', instruction: '确认血氧趋势、吸入药依从性和急性加重表现。' },
      { id: 'fup-copd-medium', riskLevel: RiskLevel.MEDIUM, followUpType: '复测提醒', dueWithinHours: 72, frequencyDescription: '3 日内复测。', taskTitle: '异常复测随访：慢阻肺指标异常', instruction: '提醒固定时间复测血氧和症状。' },
    ],
    questionnaireTemplates: [
      { id: 'q-copd-cat', questionnaireType: 'COPD_CAT', title: '慢阻肺 CAT 症状评估', description: '记录咳嗽、咳痰、胸闷、活动耐量和睡眠影响。', scoringRule: { maxScore: 40, fields: ['咳嗽', '咳痰', '活动耐量'] }, riskBands: [{ min: 0, max: 9, riskLevel: 'LOW' }, { min: 10, max: 20, riskLevel: 'MEDIUM' }, { min: 21, max: 40, riskLevel: 'HIGH' }] },
    ],
  },
  {
    id: 'rule-template-chd-v1',
    diseaseType: DiseaseType.CORONARY_HEART_DISEASE,
    templateName: '冠心病二级预防模板',
    description: '用于冠心病患者血压、心率及胸痛相关随访。',
    managementGoal: '识别胸痛风险和二级预防管理异常。',
    riskBasis: '演示规则用于冠心病长期管理。',
    vitalThresholdRules: [
      { id: 'thr-chd-hr-high', vitalType: 'HEART_RATE', displayName: '心率', unit: 'bpm', operator: 'GTE', thresholdValue: 120, riskLevel: RiskLevel.HIGH, alertTitle: '冠心病心率高危预警', alertDescription: '冠心病患者心率明显升高，需要随访胸痛和用药。', followUpAction: '24 小时内联系患者，确认胸闷胸痛和急救药使用。', sortOrder: 10 },
      { id: 'thr-chd-sbp-high', vitalType: 'SYSTOLIC_BP', displayName: '血压（收缩压）', unit: 'mmHg', operator: 'GTE', thresholdValue: 160, riskLevel: RiskLevel.HIGH, alertTitle: '冠心病合并血压高危预警', alertDescription: '冠心病患者血压高危，需关注胸痛风险。', followUpAction: '当日随访并建议复测。', sortOrder: 20 },
    ],
    followUpPolicies: [
      { id: 'fup-chd-high', riskLevel: RiskLevel.HIGH, followUpType: '当日电话随访', dueWithinHours: 24, frequencyDescription: '当日确认胸痛和二级预防用药。', taskTitle: '今日随访：冠心病风险指标', instruction: '确认胸闷胸痛、硝酸甘油使用和阿司匹林/他汀依从性。' },
      { id: 'fup-chd-medium', riskLevel: RiskLevel.MEDIUM, followUpType: '复测提醒', dueWithinHours: 72, frequencyDescription: '3 日内复测。', taskTitle: '异常复测随访：冠心病指标异常', instruction: '提醒复测血压心率并记录症状。' },
    ],
    questionnaireTemplates: [
      { id: 'q-chd-monthly', questionnaireType: 'CHD_MONTHLY', title: '冠心病月度随访问卷', description: '记录胸痛、活动耐量、急救药和二级预防用药。', scoringRule: { maxScore: 20, fields: ['胸痛', '活动耐量', '用药依从性'] }, riskBands: [{ min: 0, max: 6, riskLevel: 'LOW' }, { min: 7, max: 13, riskLevel: 'MEDIUM' }, { min: 14, max: 20, riskLevel: 'HIGH' }] },
    ],
  },
  {
    id: 'rule-template-hyperlipidemia-v1',
    diseaseType: DiseaseType.HYPERLIPIDEMIA,
    templateName: '高脂血症管理模板',
    description: '用于血脂异常、生活方式和用药依从性管理。',
    managementGoal: '跟踪血脂达标与动脉粥样硬化风险。',
    riskBasis: '演示版保留血脂指标接口，正式上线接入 LIS 后启用。',
    vitalThresholdRules: [
      { id: 'thr-lipid-ldl-high', vitalType: 'LDL_C', displayName: '低密度脂蛋白胆固醇', unit: 'mmol/L', operator: 'GTE', thresholdValue: 4.1, riskLevel: RiskLevel.HIGH, alertTitle: 'LDL-C 高危预警', alertDescription: 'LDL-C 明显升高，需要复核用药和复查计划。', followUpAction: '7 日内随访生活方式和他汀用药依从性。', sortOrder: 10 },
    ],
    followUpPolicies: [
      { id: 'fup-lipid-high', riskLevel: RiskLevel.HIGH, followUpType: '用药依从性随访', dueWithinHours: 168, frequencyDescription: '7 日内随访。', taskTitle: '血脂异常随访：复核用药依从性', instruction: '确认他汀用药、不良反应和复查计划。' },
      { id: 'fup-lipid-medium', riskLevel: RiskLevel.MEDIUM, followUpType: '生活方式提醒', dueWithinHours: 168, frequencyDescription: '7 日内提醒。', taskTitle: '生活方式提醒：血脂异常', instruction: '提醒低脂饮食、运动和定期复查。' },
    ],
    questionnaireTemplates: [
      { id: 'q-lipid-lifestyle', questionnaireType: 'LIPID_LIFESTYLE', title: '血脂生活方式问卷', description: '记录饮食、运动、体重和用药依从性。', scoringRule: { maxScore: 16, fields: ['饮食', '运动', '用药依从性'] }, riskBands: [{ min: 0, max: 5, riskLevel: 'LOW' }, { min: 6, max: 10, riskLevel: 'MEDIUM' }, { min: 11, max: 16, riskLevel: 'HIGH' }] },
    ],
  },
  {
    id: 'rule-template-obesity-v1',
    diseaseType: DiseaseType.OBESITY,
    templateName: '肥胖/代谢综合征管理模板',
    description: '用于体重、BMI、腰围和代谢综合征相关随访。',
    managementGoal: '跟踪体重趋势和生活方式干预效果。',
    riskBasis: '演示版先支持体重阈值，后续可接入 BMI/腰围。',
    vitalThresholdRules: [
      { id: 'thr-obesity-weight-high', vitalType: 'WEIGHT', displayName: '体重', unit: 'kg', operator: 'GTE', thresholdValue: 90, riskLevel: RiskLevel.MEDIUM, alertTitle: '体重管理异常提醒', alertDescription: '体重高于管理阈值，需要生活方式干预随访。', followUpAction: '7 日内进行生活方式随访。', sortOrder: 10 },
    ],
    followUpPolicies: [
      { id: 'fup-obesity-medium', riskLevel: RiskLevel.MEDIUM, followUpType: '生活方式随访', dueWithinHours: 168, frequencyDescription: '7 日内随访。', taskTitle: '生活方式随访：体重管理', instruction: '记录饮食、运动、睡眠和体重趋势。' },
    ],
    questionnaireTemplates: [
      { id: 'q-obesity-lifestyle', questionnaireType: 'OBESITY_LIFESTYLE', title: '体重管理生活方式问卷', description: '记录饮食、运动、睡眠和体重变化。', scoringRule: { maxScore: 20, fields: ['饮食', '运动', '睡眠', '体重变化'] }, riskBands: [{ min: 0, max: 6, riskLevel: 'LOW' }, { min: 7, max: 13, riskLevel: 'MEDIUM' }, { min: 14, max: 20, riskLevel: 'HIGH' }] },
    ],
  },
];


