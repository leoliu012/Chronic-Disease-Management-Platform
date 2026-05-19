/*
 * Stable Demo v1 seed data for the smart chronic-disease platform.
 * Run from apps/api:
 *   node prisma/seed-demo.js
 *
 * This script is intentionally plain CommonJS so it works without adding tsx/ts-node.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const nurseId = 'nurse-001';
const doctorId = 'doctor-001';

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
  ['demo-profile-001-a', 'demo-patient-001', 'HYPERTENSION', 'HIGH', '2级高血压，近期家庭血压波动', '高血压性心脏病风险', '高脂血症'],
  ['demo-profile-001-b', 'demo-patient-001', 'HYPERLIPIDEMIA', 'MEDIUM', 'LDL-C 控制一般', '', '高血压'],
  ['demo-profile-002-a', 'demo-patient-002', 'TYPE_2_DIABETES', 'VERY_HIGH', '2型糖尿病病程 11 年，近期血糖偏高', '糖尿病周围神经病变风险', '高血压'],
  ['demo-profile-003-a', 'demo-patient-003', 'COPD', 'HIGH', '慢阻肺稳定期，近期活动后气促', '急性加重风险', '冠心病'],
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
    id: 'demo-vital-plan-003-spo2', patientId: 'demo-patient-003', vitalType: 'SPO2', displayName: '血氧', unit: '%', frequencyUnit: 'DAY', timesPerUnit: 1, customMeasureTimes: ['09:00'], sourcePreset: 'COPD', evidenceBasis: '慢阻肺患者每日血氧监测，用于识别急性加重风险。', lastCheckInAt: daysAgo(1, 9, 10),
  },
  {
    id: 'demo-vital-plan-004-weight', patientId: 'demo-patient-004', vitalType: 'WEIGHT', displayName: '体重', unit: 'kg', frequencyUnit: 'WEEK', timesPerUnit: 1, customMeasureDays: [1], customMeasureTimes: ['08:00'], sourcePreset: 'OBESITY', evidenceBasis: '体重每周固定时间监测，观察生活方式干预趋势。', lastCheckInAt: daysAgo(3, 8, 0),
  },
];

const medicationSeeds = [
  {
    id: 'demo-med-001', patientId: 'demo-patient-001', medicationName: '苯磺酸氨氯地平片', dosage: '5mg', frequency: '每日 1 次，饭后服用', frequencyUnit: 'DAY', timesPerUnit: 1, timingRelation: 'AFTER_MEAL', customDoseTimes: ['08:00'], instructions: '每日晨起后服用，注意监测血压。', lastCheckInAt: daysAgo(0, 8, 10),
  },
  {
    id: 'demo-med-002', patientId: 'demo-patient-002', medicationName: '二甲双胍片', dosage: '500mg', frequency: '每日 2 次，随餐服用', frequencyUnit: 'DAY', timesPerUnit: 2, timingRelation: 'WITH_MEAL', customDoseTimes: ['08:00', '18:00'], instructions: '随餐服用，如低血糖及时联系护士。', lastCheckInAt: daysAgo(1, 18, 10),
  },
  {
    id: 'demo-med-003', patientId: 'demo-patient-003', medicationName: '噻托溴铵吸入剂', dosage: '18μg', frequency: '每日 1 次', frequencyUnit: 'DAY', timesPerUnit: 1, timingRelation: 'NONE', customDoseTimes: ['09:00'], instructions: '按吸入装置规范使用。', lastCheckInAt: daysAgo(2, 9, 20),
  },
  {
    id: 'demo-med-004', patientId: 'demo-patient-005', medicationName: '阿司匹林肠溶片', dosage: '100mg', frequency: '每日 1 次，饭后服用', frequencyUnit: 'DAY', timesPerUnit: 1, timingRelation: 'AFTER_MEAL', customDoseTimes: ['20:00'], instructions: '如出现黑便、胃痛等需及时复诊。', lastCheckInAt: daysAgo(0, 20, 5),
  },
];

const vitalSeeds = [
  ['demo-vital-001-a', 'demo-patient-001', 'SYSTOLIC_BP', 168, 'mmHg', daysAgo(0, 7, 35), true, 'demo-vital-plan-001-bp', '患者小程序晨间上传，收缩压偏高。'],
  ['demo-vital-001-b', 'demo-patient-001', 'DIASTOLIC_BP', 96, 'mmHg', daysAgo(0, 7, 35), true, 'demo-vital-plan-001-bp', '与收缩压同次测量。'],
  ['demo-vital-001-c', 'demo-patient-001', 'SYSTOLIC_BP', 138, 'mmHg', daysAgo(2, 19, 42), false, 'demo-vital-plan-001-bp', '晚间复测较前下降。'],
  ['demo-vital-002-a', 'demo-patient-002', 'BLOOD_GLUCOSE', 15.8, 'mmol/L', daysAgo(0, 7, 15), true, 'demo-vital-plan-002-glu', '空腹血糖明显偏高。'],
  ['demo-vital-002-b', 'demo-patient-002', 'BLOOD_GLUCOSE', 8.4, 'mmol/L', daysAgo(2, 21, 10), true, 'demo-vital-plan-002-glu', '晚间血糖仍偏高。'],
  ['demo-vital-003-a', 'demo-patient-003', 'SPO2', 93, '%', daysAgo(1, 9, 10), true, 'demo-vital-plan-003-spo2', '慢阻肺患者血氧偏低。'],
  ['demo-vital-003-b', 'demo-patient-003', 'HEART_RATE', 102, 'bpm', daysAgo(1, 9, 10), true, null, '同次测量心率偏快。'],
  ['demo-vital-004-a', 'demo-patient-004', 'WEIGHT', 78.2, 'kg', daysAgo(3, 8, 0), false, 'demo-vital-plan-004-weight', '每周体重打卡。'],
  ['demo-vital-006-a', 'demo-patient-006', 'SYSTOLIC_BP', 132, 'mmHg', daysAgo(1, 8, 15), false, null, '家庭血压平稳。'],
  ['demo-vital-007-a', 'demo-patient-007', 'BLOOD_GLUCOSE', 6.8, 'mmol/L', daysAgo(1, 7, 50), false, null, '空腹血糖接近目标。'],
];

const alertSeeds = [
  {
    id: 'demo-alert-001', patientId: 'demo-patient-001', riskType: 'VITAL_ABNORMAL', riskLevel: 'HIGH', title: '异常健康指标：收缩压', description: '收缩压 168 mmHg；收缩压 ≥ 160 mmHg，高危', triggerRule: '收缩压 ≥ 160 mmHg，高危', sourceVitalRecordId: 'demo-vital-001-a', status: 'OPEN', createdAt: daysAgo(0, 7, 40),
  },
  {
    id: 'demo-alert-002', patientId: 'demo-patient-002', riskType: 'VITAL_ABNORMAL', riskLevel: 'HIGH', title: '今日随访：血糖明显偏高', description: '空腹血糖 15.8 mmol/L，需今日电话随访并提醒复测。', triggerRule: '血糖 ≥ 11.1 mmol/L，高危', sourceVitalRecordId: 'demo-vital-002-a', status: 'IN_PROGRESS', createdAt: daysAgo(0, 7, 20), handledBy: nurseId, handledAt: daysAgo(0, 8, 0), handlingNote: '护士已开始电话联系患者。',
  },
  {
    id: 'demo-alert-003', patientId: 'demo-patient-003', riskType: 'VITAL_ABNORMAL', riskLevel: 'HIGH', title: '异常健康指标：血氧', description: '血氧 93%；血氧 < 95%，异常。', triggerRule: '血氧 < 95%，异常', sourceVitalRecordId: 'demo-vital-003-a', status: 'OPEN', createdAt: daysAgo(1, 9, 15),
  },
  {
    id: 'demo-alert-004', patientId: 'demo-patient-005', riskType: 'SYMPTOM_REVIEW', riskLevel: 'MEDIUM', title: '胸闷症状复核', description: '患者问卷提示偶发胸闷，需要护士复核是否需要提前复诊。', triggerRule: '冠心病问卷胸闷症状阳性', sourceVitalRecordId: null, status: 'RESOLVED', createdAt: daysAgo(4, 10, 20), handledBy: nurseId, handledAt: daysAgo(3, 14, 30), handlingNote: '已完成电话随访，患者症状缓解。',
  },
];

const taskSeeds = [
  { id: 'demo-task-001', patientId: 'demo-patient-001', title: '今日随访：复核血压偏高', type: 'RISK_ALERT_FOLLOW_UP', status: 'PENDING', dueAt: daysFromNow(0, 18, 0), assigneeId: nurseId, relatedAlertId: 'demo-alert-001', createdAt: daysAgo(0, 7, 45) },
  { id: 'demo-task-002', patientId: 'demo-patient-002', title: '电话随访：血糖控制不佳', type: 'RISK_ALERT_FOLLOW_UP', status: 'IN_PROGRESS', dueAt: daysFromNow(0, 17, 30), assigneeId: nurseId, relatedAlertId: 'demo-alert-002', createdAt: daysAgo(0, 7, 25) },
  { id: 'demo-task-003', patientId: 'demo-patient-003', title: '血氧异常复测提醒', type: 'RECHECK_REMINDER', status: 'PENDING', dueAt: daysFromNow(0, 16, 30), assigneeId: nurseId, relatedAlertId: 'demo-alert-003', createdAt: daysAgo(1, 9, 20) },
  { id: 'demo-task-004', patientId: 'demo-patient-004', title: '本周体重管理电话随访', type: 'FOLLOW_UP', status: 'PENDING', dueAt: daysFromNow(2, 10, 0), assigneeId: nurseId, relatedAlertId: null, createdAt: daysAgo(1, 13, 0) },
  { id: 'demo-task-005', patientId: 'demo-patient-005', title: '胸闷症状电话复核已完成', type: 'RISK_ALERT_FOLLOW_UP', status: 'DONE', dueAt: daysAgo(3, 17, 0), assigneeId: nurseId, relatedAlertId: 'demo-alert-004', createdAt: daysAgo(4, 10, 30) },
];

async function main() {
  const patientIds = demoPatients.map((p) => p.id);

  await prisma.$transaction([
    prisma.medicationCheckIn.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.questionnaireResult.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.riskAlert.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.task.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.followUpRecord.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.vitalRecord.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.vitalMonitoringPlan.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.medicationRecord.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.diseaseProfile.deleteMany({ where: { patientId: { in: patientIds } } }),
    prisma.hospitalVisitReminder.deleteMany({ where: { patientId: { in: patientIds } } }),
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
        evidenceSource: 'stable-demo-v1-seed',
        isActive: true,
        createdAt: daysAgo(12, 10, 0),
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
        startDate: daysAgo(30, 0, 0),
        createdAt: daysAgo(11, 10, 30),
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
        dataSource: 'MINI_PROGRAM',
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

  for (const task of taskSeeds) {
    await prisma.task.create({ data: task });
  }

  await prisma.followUpRecord.createMany({
    data: [
      {
        id: 'demo-followup-001', patientId: 'demo-patient-001', followUpType: 'PHONE', followUpTime: daysAgo(6, 15, 10), content: '询问家庭血压监测和服药情况。', result: '患者服药规律，但近两日晨间血压偏高。', suggestion: '继续早晚监测，若持续 ≥160 mmHg 建议提前复诊。', nextFollowUpTime: daysFromNow(1, 15, 30), operatorId: nurseId,
      },
      {
        id: 'demo-followup-002', patientId: 'demo-patient-002', followUpType: 'WECHAT', followUpTime: daysAgo(5, 11, 0), content: '提醒患者完成血糖打卡和饮食记录。', result: '患者反馈晚餐后血糖偏高。', suggestion: '建议复测空腹血糖并记录饮食。', nextFollowUpTime: daysFromNow(0, 17, 30), operatorId: nurseId,
      },
      {
        id: 'demo-followup-003', patientId: 'demo-patient-005', followUpType: 'PHONE', followUpTime: daysAgo(3, 14, 35), content: '复核胸闷症状。', result: '患者胸闷症状已缓解，无持续胸痛。', suggestion: '继续规律服药，如胸痛持续或加重立即就诊。', nextFollowUpTime: daysFromNow(7, 10, 0), operatorId: nurseId,
      },
    ],
  });

  await prisma.medicationCheckIn.createMany({
    data: [
      { id: 'demo-med-check-001', medicationId: 'demo-med-001', patientId: 'demo-patient-001', taken: true, checkedAt: daysAgo(0, 8, 10), scheduledAt: daysAgo(0, 8, 0), note: '已按时服药。' },
      { id: 'demo-med-check-002', medicationId: 'demo-med-002', patientId: 'demo-patient-002', taken: false, checkedAt: daysAgo(1, 22, 10), scheduledAt: daysAgo(1, 18, 0), note: '晚餐后忘记服药，已提醒。' },
      { id: 'demo-med-check-003', medicationId: 'demo-med-003', patientId: 'demo-patient-003', taken: true, checkedAt: daysAgo(2, 9, 20), scheduledAt: daysAgo(2, 9, 0), note: '已完成吸入剂使用。' },
      { id: 'demo-med-check-004', medicationId: 'demo-med-004', patientId: 'demo-patient-005', taken: true, checkedAt: daysAgo(0, 20, 5), scheduledAt: daysAgo(0, 20, 0), note: '无不适。' },
    ],
  });

  await prisma.questionnaireResult.createMany({
    data: [
      { id: 'demo-questionnaire-001', patientId: 'demo-patient-001', questionnaireType: '高血压月度问卷', score: 7, riskLevel: 'HIGH', riskConclusion: '近期晨间血压偏高，建议护士复核。', answers: { headache: true, medicationAdherence: 'good' }, dataSource: 'MINI_PROGRAM', createdAt: daysAgo(1, 20, 0) },
      { id: 'demo-questionnaire-002', patientId: 'demo-patient-002', questionnaireType: '糖尿病月度问卷', score: 8, riskLevel: 'VERY_HIGH', riskConclusion: '血糖波动较明显，需今日电话随访。', answers: { thirst: true, hypoglycemia: false }, dataSource: 'MINI_PROGRAM', createdAt: daysAgo(0, 7, 10) },
      { id: 'demo-questionnaire-003', patientId: 'demo-patient-005', questionnaireType: '冠心病症状问卷', score: 5, riskLevel: 'MEDIUM', riskConclusion: '偶发胸闷，已电话复核。', answers: { chestTightness: true, persistentChestPain: false }, dataSource: 'MINI_PROGRAM', createdAt: daysAgo(4, 9, 0) },
    ],
  });

  console.log(`Stable demo v1 seed completed: ${demoPatients.length} patients, ${profileSeeds.length} disease profiles, ${vitalSeeds.length} vital records.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


