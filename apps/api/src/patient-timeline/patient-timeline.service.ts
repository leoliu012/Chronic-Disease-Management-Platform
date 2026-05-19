import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
    ]);

    const diseaseEvents = diseaseProfiles.map((item) => ({
      type: 'DISEASE_PROFILE',
      time: item.createdAt,
      title: `慢病档案：${item.diseaseType}`,
      description: `风险等级：${item.riskLevel}${
        item.diagnosisDate
          ? `；确诊日期：${item.diagnosisDate.toISOString().slice(0, 10)}`
          : ''
      }；数据来源：${item.dataSource}`,
      data: item,
    }));

    const vitalEvents = vitalRecords.map((item) => ({
      type: 'VITAL_RECORD',
      time: item.measuredAt,
      title: `健康指标：${item.type}`,
      description: `${item.value} ${item.unit}${item.isAbnormal ? '，异常' : ''}`,
      data: item,
    }));

    const alertEvents = riskAlerts.map((item) => ({
      type: 'RISK_ALERT',
      time: item.createdAt,
      title: item.title,
      description: `${item.description ?? '暂无说明'}；状态：${item.status}`,
      data: item,
    }));

    const followUpEvents = followUps.map((item) => ({
      type: 'FOLLOW_UP',
      time: item.followUpTime,
      title: `随访记录：${item.followUpType}`,
      description: item.result ?? item.content ?? '',
      data: item,
    }));

    const taskEvents = tasks.map((item) => ({
      type: 'TASK',
      time: item.createdAt,
      title: item.title,
      description: `任务状态：${item.status}${
        item.dueAt ? `；截止时间：${item.dueAt.toISOString()}` : ''
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
      description: `${item.taken ? '已按时服药' : '漏服/未服药'}${
        item.note ? `；备注：${item.note}` : ''
      }`,
      data: item,
    }));

    const questionnaireEvents = questionnaireResults.map((item) => ({
      type: 'QUESTIONNAIRE_RESULT',
      time: item.createdAt,
      title: `问卷结果：${item.questionnaireType}`,
      description: `评分：${item.score}/10；风险等级：${item.riskLevel}；${item.riskConclusion}`,
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
    ].sort((a, b) => {
      return new Date(b.time).getTime() - new Date(a.time).getTime();
    });

    return {
      patient,
      timeline,
    };
  }
}

