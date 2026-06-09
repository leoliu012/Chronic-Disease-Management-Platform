import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const diseaseLabelMap: Record<string, string> = {
  HYPERTENSION: '高血压',
  TYPE_2_DIABETES: '2型糖尿病',
  COPD: '慢阻肺',
  CORONARY_HEART_DISEASE: '冠心病',
  HYPERLIPIDEMIA: '高脂血症',
  OBESITY: '肥胖',
  OTHER: '其他',
};

const riskLabelMap: Record<string, string> = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危',
};

const dataSourceLabelMap: Record<string, string> = {
  HIS: '院内信息系统',
  EMR: '电子病历',
  LIS: '检验系统',
  MINI_PROGRAM: '患者小程序',
  NURSE_INPUT: '护士录入',
  MANUAL_IMPORT: '人工导入',
};

const vitalTypeLabelMap: Record<string, string> = {
  BLOOD_PRESSURE: '血压',
  SYSTOLIC_BP: '血压（收缩压/舒张压）',
  DIASTOLIC_BP: '血压（收缩压/舒张压）',
  BLOOD_GLUCOSE: '血糖',
  WEIGHT: '体重',
  HEART_RATE: '心率',
  SPO2: '血氧',
  LDL_C: '低密度脂蛋白胆固醇',
};

const taskTypeLabelMap: Record<string, string> = {
  FOLLOW_UP: '随访任务',
  RISK_ALERT_FOLLOW_UP: '风险预警处理',
  RECHECK_REMINDER: '复查提醒',
  MEDICATION_REMINDER: '用药提醒',
  MEDICATION_ADHERENCE_FOLLOW_UP: '用药依从性随访',
  VITAL_RECHECK_FOLLOW_UP: '指标复测随访',
  VITAL_MEASUREMENT_MISSED: '指标漏测复核',
  QUESTIONNAIRE_REVIEW: '问卷复核',
  LAB_TEST_REMINDER: '检查提醒',
  HOSPITAL_VISIT_FOLLOW_UP: '到院提醒任务',
};

const followUpTypeLabelMap: Record<string, string> = {
  PHONE: '电话随访',
  WECHAT: '微信随访',
  OUTPATIENT: '门诊随访',
  HOME_VISIT: '上门随访',
};

const statusLabelMap: Record<string, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '处理中',
  DONE: '已完成',
  CANCELED: '已取消',
  OPEN: '未处理',
  RESOLVED: '已处理',
  DISMISSED: '已忽略',
};

const questionnaireTypeLabelMap: Record<string, string> = {
  HYPERTENSION_MONTHLY: '高血压月度随访问卷',
  DIABETES_MONTHLY: '糖尿病月度随访问卷',
  COPD_CAT: '慢阻肺症状评估',
  CHD_MONTHLY: '冠心病月度随访问卷',
  LIPID_LIFESTYLE: '血脂生活方式问卷',
  OBESITY_LIFESTYLE: '体重管理生活方式问卷',
};

const encounterTypeLabelMap: Record<string, string> = {
  OUTPATIENT: '门诊',
  INPATIENT: '住院',
  EMERGENCY: '急诊',
  CHECKUP: '体检',
};

const medicalRecordTypeLabelMap: Record<string, string> = {
  OUTPATIENT_NOTE: '门诊病历',
  INPATIENT_RECORD: '住院病历',
  DISCHARGE_SUMMARY: '出院小结',
  PROGRESS_NOTE: '病程记录',
  CONSULTATION_NOTE: '会诊记录',
};

function label(map: Record<string, string>, value?: string | null) {
  if (!value) return '-';
  return map[value] ?? value;
}

function isBloodPressureComponent(type?: string | null) {
  return type === 'SYSTOLIC_BP' || type === 'DIASTOLIC_BP' || type === 'BLOOD_PRESSURE';
}

function getVitalRecordTitle(type?: string | null) {
  return isBloodPressureComponent(type) ? '健康指标：血压' : `健康指标：${label(vitalTypeLabelMap, type)}`;
}

function getVitalRecordDescription(item: { type?: string | null; value: number; unit: string; isAbnormal: boolean }) {
  const component = item.type === 'SYSTOLIC_BP' ? '收缩压 ' : item.type === 'DIASTOLIC_BP' ? '舒张压 ' : '';
  return `${component}${item.value} ${item.unit}${item.isAbnormal ? '，异常' : '，正常'}`;
}

function formatDate(value?: Date | null) {
  if (!value) return '-';
  return value.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function formatTime(value?: Date | null) {
  if (!value) return '-';
  return value.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}

@Injectable()
export class PatientTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async getTimeline(patientId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    const [
      diseaseProfiles,
      vitalRecords,
      riskAlerts,
      followUps,
      tasks,
      medicationRecords,
      medicationCheckIns,
      questionnaireResults,
      vitalMonitoringPlans,
      encounterRecords,
      medicalRecordSummaries,
      examReports,
      hospitalMedications,
      riskEpisodes,
      careReminderOccurrences,
      outboundMessages,
      taskProcessingEvents,
      hospitalVisitFeedbacks,
    ] = await Promise.all([
      this.prisma.diseaseProfile.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
      }),

      this.prisma.vitalRecord.findMany({
        where: { patientId },
        orderBy: { measuredAt: 'desc' },
      }),

      this.prisma.riskAlert.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
      }),

      this.prisma.followUpRecord.findMany({
        where: { patientId },
        orderBy: { followUpTime: 'desc' },
      }),

      this.prisma.task.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
      }),

      this.prisma.medicationRecord.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
      }),

      this.prisma.medicationCheckIn.findMany({
        where: { patientId },
        include: { medication: true },
        orderBy: { checkedAt: 'desc' },
      }),

      this.prisma.questionnaireResult.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
      }),

      this.prisma.vitalMonitoringPlan.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
      }),

      this.prisma.encounterRecord.findMany({
        where: { patientId },
        orderBy: { visitTime: 'desc' },
      }),

      this.prisma.medicalRecordSummary.findMany({
        where: { patientId },
        orderBy: { recordTime: 'desc' },
      }),

      this.prisma.examReportRecord.findMany({
        where: { patientId },
        orderBy: { examTime: 'desc' },
      }),

      this.prisma.hospitalMedicationOrder.findMany({
        where: { patientId },
        orderBy: { prescribedAt: 'desc' },
      }),

      this.prisma.riskEpisode.findMany({
        where: { patientId },
        orderBy: { lastTriggeredAt: 'desc' },
      }),

      this.prisma.careReminderOccurrence.findMany({
        where: { patientId },
        orderBy: { dueAt: 'desc' },
      }),

      this.prisma.patientOutboundMessage.findMany({
        where: { patientId },
        include: { attempts: { orderBy: { createdAt: 'asc' } }, formLink: true },
        orderBy: { createdAt: 'desc' },
      }),

      this.prisma.taskProcessingEvent.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
      }),

      this.prisma.hospitalVisitFeedback.findMany({
        where: { patientId },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);

    const diseaseEvents = diseaseProfiles.map((item) => ({
      type: 'DISEASE_PROFILE',
      time: item.createdAt,
      title: `慢病档案：${label(diseaseLabelMap, item.diseaseType)}`,
      description: `风险等级：${label(riskLabelMap, item.riskLevel)}${
        item.diagnosisDate ? `；确诊日期：${formatDate(item.diagnosisDate)}` : ''
      }；数据来源：${label(dataSourceLabelMap, item.dataSource)}`,
      data: item,
    }));

    const vitalEvents = vitalRecords.map((item) => ({
      type: 'VITAL_RECORD',
      time: item.measuredAt,
      title: getVitalRecordTitle(item.type),
      description: getVitalRecordDescription(item),
      data: item,
    }));

    const alertEvents = riskAlerts.map((item) => ({
      type: 'RISK_ALERT',
      time: item.createdAt,
      title: item.title,
      description: `${item.description ?? '暂无说明'}；状态：${label(statusLabelMap, item.status)}`,
      data: item,
    }));

    const followUpEvents = followUps.map((item) => ({
      type: 'FOLLOW_UP',
      time: item.followUpTime,
      title: `随访记录：${label(followUpTypeLabelMap, item.followUpType)}`,
      description: item.result ?? item.content ?? '',
      data: item,
    }));

    const taskEvents = tasks.map((item) => ({
      type: 'TASK',
      time: item.createdAt,
      title: item.title,
      description: `任务状态：${label(statusLabelMap, item.status)}${
        item.dueAt ? `；截止时间：${formatTime(item.dueAt)}` : ''
      }${item.relatedAlertId ? '；已关联风险预警' : ''}`,
      data: item,
    }));

    const vitalPlanEvents = vitalMonitoringPlans.map((item) => ({
      type: 'VITAL_MONITORING_PLAN',
      time: item.createdAt,
      title: `指标打卡计划：${item.displayName}`,
      description: `频次：每${item.frequencyUnit === 'DAY' ? '日' : item.frequencyUnit === 'WEEK' ? '周' : '月'} ${item.timesPerUnit} 次；状态：${item.isActive ? '启用' : '停用'}${
        item.evidenceBasis ? `；依据：${item.evidenceBasis}` : ''
      }`,
      data: item,
    }));

    const medicationEvents = medicationRecords.map((item) => ({
      type: 'MEDICATION_RECORD',
      time: item.createdAt,
      title: `用药计划：${item.medicationName}`,
      description: `剂量：${item.dosage}；频次：${item.frequency}${
        item.instructions ? `；说明：${item.instructions}` : ''
      }；状态：${item.isActive ? '启用' : '停用'}`,
      data: item,
    }));

    const medicationCheckInEvents = medicationCheckIns.map((item) => ({
      type: 'MEDICATION_CHECK_IN',
      time: item.checkedAt,
      title: `用药打卡：${item.medication.medicationName}`,
      description: `${item.taken ? '已按时服药' : '漏服/未服药'}${item.note ? `；备注：${item.note}` : ''}`,
      data: item,
    }));

    const questionnaireEvents = questionnaireResults.map((item) => ({
      type: 'QUESTIONNAIRE_RESULT',
      time: item.createdAt,
      title: `问卷结果：${label(questionnaireTypeLabelMap, item.questionnaireType)}`,
      description: `评分：${item.score}/10；风险等级：${label(riskLabelMap, item.riskLevel)}；${item.riskConclusion}`,
      data: item,
    }));

    const encounterEvents = encounterRecords.map((item) => ({
      type: 'ENCOUNTER_RECORD',
      time: item.visitTime,
      title: `就诊记录：${label(encounterTypeLabelMap, item.visitType)}`,
      description: `${item.departmentName ? `科室：${item.departmentName}` : ''}${
        item.doctorName ? `；医生：${item.doctorName}` : ''
      }${item.diagnosisSummary ? `；诊断：${item.diagnosisSummary}` : ''}`,
      data: item,
    }));

    const medicalRecordEvents = medicalRecordSummaries.map((item) => ({
      type: 'MEDICAL_RECORD_SUMMARY',
      time: item.recordTime,
      title: `病历摘要：${label(medicalRecordTypeLabelMap, item.recordType)}`,
      description: `${item.title}${item.diagnosisText ? `；诊断：${item.diagnosisText}` : ''}${
        item.departmentName ? `；科室：${item.departmentName}` : ''
      }`,
      data: item,
    }));

    const examReportEvents = examReports.map((item) => ({
      type: 'EXAM_REPORT',
      time: item.examTime,
      title: `检查报告：${item.examName}`,
      description: `${item.examType}${item.conclusion ? `；结论：${item.conclusion}` : ''}${
        item.departmentName ? `；科室：${item.departmentName}` : ''
      }`,
      data: item,
    }));

    const hospitalMedicationEvents = hospitalMedications.map((item) => ({
      type: 'HOSPITAL_MEDICATION',
      time: item.prescribedAt,
      title: `院内处方：${item.medicationName}`,
      description: `剂量：${item.dosage}；频次：${item.frequency}${
        item.route ? `；途径：${item.route}` : ''
      }${item.prescribedBy ? `；开方医生：${item.prescribedBy}` : ''}`,
      data: item,
    }));

    const riskEpisodeEvents = riskEpisodes.map((item) => ({
      type: 'RISK_EPISODE',
      time: item.lastTriggeredAt,
      title: `风险 Episode：${item.riskCategory}`,
      description: `累计触发 ${item.triggerCount} 次；峰值风险：${label(riskLabelMap, item.peakRiskLevel)}；状态：${item.status}`,
      data: item,
    }));

    const careReminderOccurrenceEvents = careReminderOccurrences.map((item) => ({
      type: 'CARE_REMINDER_OCCURRENCE',
      time: item.dueAt,
      title: `患者自管理提醒：${item.title}`,
      description: `状态：${item.status}${item.escalatedTaskId ? '；已升级为护士任务' : ''}${item.resultType ? `；结果：${item.resultType}` : ''}`,
      data: item,
    }));

    const outboundMessageEvents = outboundMessages.map((item) => ({
      type: 'PATIENT_OUTBOUND_MESSAGE',
      time: item.createdAt,
      title: `患者触达：${item.title}`,
      description: `渠道：${item.channel}；状态：${item.status}；发送尝试 ${item.attempts.length} 次${item.formLink ? `；表单凭证：${item.formLink.status}` : ''}`,
      data: item,
    }));

    const outboundAttemptEvents = outboundMessages.flatMap((message) =>
      message.attempts.map((attempt) => ({
        type: 'PATIENT_OUTBOUND_ATTEMPT',
        time: attempt.createdAt,
        title: `患者触达尝试：${attempt.channel}`,
        description: `状态：${attempt.status}${attempt.triggerReason ? `；原因：${attempt.triggerReason}` : ''}${attempt.errorMessage ? `；错误：${attempt.errorMessage}` : ''}`,
        data: { ...attempt, messageId: message.id },
      })),
    );

    const taskProcessingEventsTimeline = taskProcessingEvents.map((item) => ({
      type: 'TASK_PROCESSING_EVENT',
      time: item.createdAt,
      title: `处置过程：${item.title}`,
      description: item.description ?? '',
      data: item,
    }));

    const hospitalVisitFeedbackEvents = hospitalVisitFeedbacks.map((item) => ({
      type: 'HOSPITAL_VISIT_FEEDBACK',
      time: item.submittedAt,
      title: `患者到院反馈：${item.action}`,
      description: item.note ?? '患者已提交到院安排反馈',
      data: item,
    }));

    const timeline = [
      ...diseaseEvents,
      ...vitalEvents,
      ...alertEvents,
      ...followUpEvents,
      ...taskEvents,
      ...vitalPlanEvents,
      ...medicationEvents,
      ...medicationCheckInEvents,
      ...questionnaireEvents,
      ...encounterEvents,
      ...medicalRecordEvents,
      ...examReportEvents,
      ...hospitalMedicationEvents,
      ...riskEpisodeEvents,
      ...careReminderOccurrenceEvents,
      ...outboundMessageEvents,
      ...outboundAttemptEvents,
      ...taskProcessingEventsTimeline,
      ...hospitalVisitFeedbackEvents,
    ].sort((a, b) => {
      return new Date(b.time).getTime() - new Date(a.time).getTime();
    });

    return {
      patient,
      timeline,
    };
  }
}
