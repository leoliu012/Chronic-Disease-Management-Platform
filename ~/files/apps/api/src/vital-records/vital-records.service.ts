import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RiskLevel, RiskAlert, Task } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicalRulesService } from '../clinical-rules/clinical-rules.service';
import { CreateVitalRecordDto } from './dto/create-vital-record.dto';
import { QueryVitalRecordsDto } from './dto/query-vital-records.dto';

type VitalRuleEvaluation = {
  isAbnormal: boolean;
  riskLevel: RiskLevel;
  title: string;
  description: string;
  triggerRule: string;
  matchedRuleId?: string;
  matchedTemplateId?: string;
  matchedTemplateName?: string;
  followUpDueWithinHours?: number;
  followUpTaskTitle?: string;
};

const vitalTypeLabelMap: Record<string, string> = {
  BLOOD_PRESSURE: '血压',
  SYSTOLIC_BP: '血压',
  DIASTOLIC_BP: '血压',
  BLOOD_GLUCOSE: '血糖',
  WEIGHT: '体重',
  HEART_RATE: '心率',
  SPO2: '血氧',
};


const riskRank: Record<RiskLevel, number> = {
  [RiskLevel.LOW]: 0,
  [RiskLevel.MEDIUM]: 1,
  [RiskLevel.HIGH]: 2,
  [RiskLevel.VERY_HIGH]: 3,
};

function getNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

@Injectable()
export class VitalRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clinicalRulesService: ClinicalRulesService,
  ) {}

  private getAlertReviewDueAt(ruleEvaluation: VitalRuleEvaluation) {
    if (ruleEvaluation.followUpDueWithinHours) {
      const dueAt = new Date();
      dueAt.setHours(dueAt.getHours() + ruleEvaluation.followUpDueWithinHours);
      return dueAt;
    }

    const riskLevel = ruleEvaluation.riskLevel;
    const dueAt = new Date();

    if (riskLevel === RiskLevel.VERY_HIGH) {
      dueAt.setHours(dueAt.getHours() + 4);
      return dueAt;
    }

    if (riskLevel === RiskLevel.HIGH) {
      dueAt.setHours(dueAt.getHours() + 24);
      return dueAt;
    }

    dueAt.setDate(dueAt.getDate() + 3);
    return dueAt;
  }

  private getAlertReviewTaskTitle(ruleEvaluation: VitalRuleEvaluation) {
    // 任务标题只表达“临床风险来源”，不要提前绑定某一种处理方式。
    // 例如不要生成“电话随访：血糖控制不佳”，否则医护会误以为该任务只能电话随访。
    // 具体处理动作会进入任务处理流程节点。
    return ruleEvaluation.title || '风险预警处理';
  }

  private evaluateVitalRuleFallback(dto: CreateVitalRecordDto): VitalRuleEvaluation {
    const type = dto.type;
    const value = Number(dto.value);
    if (!Number.isFinite(value)) {
      throw new BadRequestException('请输入有效的指标数值');
    }
    const unit = dto.unit;
    const label = vitalTypeLabelMap[type] ?? type;

    let isAbnormal = false;
    let riskLevel: RiskLevel = RiskLevel.LOW;
    let triggerRule = '未触发自动异常规则';

    if (type === 'SYSTOLIC_BP') {
      if (value >= 180) {
        isAbnormal = true;
        riskLevel = RiskLevel.VERY_HIGH;
        triggerRule = '收缩压 ≥ 180 mmHg，极高危';
      } else if (value >= 160) {
        isAbnormal = true;
        riskLevel = RiskLevel.HIGH;
        triggerRule = '收缩压 ≥ 160 mmHg，高危';
      } else if (value >= 140) {
        isAbnormal = true;
        riskLevel = RiskLevel.MEDIUM;
        triggerRule = '收缩压 ≥ 140 mmHg，异常';
      } else if (value < 90) {
        isAbnormal = true;
        riskLevel = RiskLevel.MEDIUM;
        triggerRule = '收缩压 < 90 mmHg，偏低异常';
      }
    }

    if (type === 'DIASTOLIC_BP') {
      if (value >= 110) {
        isAbnormal = true;
        riskLevel = RiskLevel.VERY_HIGH;
        triggerRule = '舒张压 ≥ 110 mmHg，极高危';
      } else if (value >= 100) {
        isAbnormal = true;
        riskLevel = RiskLevel.HIGH;
        triggerRule = '舒张压 ≥ 100 mmHg，高危';
      } else if (value >= 90) {
        isAbnormal = true;
        riskLevel = RiskLevel.MEDIUM;
        triggerRule = '舒张压 ≥ 90 mmHg，异常';
      } else if (value < 60) {
        isAbnormal = true;
        riskLevel = RiskLevel.MEDIUM;
        triggerRule = '舒张压 < 60 mmHg，偏低异常';
      }
    }

    if (type === 'BLOOD_GLUCOSE') {
      if (value >= 16.7) {
        isAbnormal = true;
        riskLevel = RiskLevel.VERY_HIGH;
        triggerRule = '血糖 ≥ 16.7 mmol/L，极高危';
      } else if (value >= 11.1) {
        isAbnormal = true;
        riskLevel = RiskLevel.HIGH;
        triggerRule = '血糖 ≥ 11.1 mmol/L，高危';
      } else if (value >= 7.0) {
        isAbnormal = true;
        riskLevel = RiskLevel.MEDIUM;
        triggerRule = '血糖 ≥ 7.0 mmol/L，异常';
      } else if (value < 3.9) {
        isAbnormal = true;
        riskLevel = RiskLevel.HIGH;
        triggerRule = '血糖 < 3.9 mmol/L，低血糖风险';
      }
    }

    if (type === 'SPO2') {
      if (value < 90) {
        isAbnormal = true;
        riskLevel = RiskLevel.VERY_HIGH;
        triggerRule = '血氧 < 90%，极高危';
      } else if (value < 95) {
        isAbnormal = true;
        riskLevel = RiskLevel.HIGH;
        triggerRule = '血氧 < 95%，异常';
      }
    }

    if (type === 'HEART_RATE') {
      if (value >= 120 || value <= 50) {
        isAbnormal = true;
        riskLevel = RiskLevel.HIGH;
        triggerRule = '心率 ≥ 120 bpm 或 ≤ 50 bpm，高危异常';
      } else if (value >= 100 || value < 60) {
        isAbnormal = true;
        riskLevel = RiskLevel.MEDIUM;
        triggerRule = '心率 ≥ 100 bpm 或 < 60 bpm，异常';
      }
    }

    if (dto.isAbnormal && !isAbnormal) {
      isAbnormal = true;
      riskLevel = RiskLevel.MEDIUM;
      triggerRule = '护士人工标记异常';
    }

    return {
      isAbnormal,
      riskLevel,
      title: `异常健康指标：${label}`,
      description: `${label} ${value} ${unit}；${triggerRule}`,
      triggerRule,
    };
  }

  private async evaluateVitalRule(patient: any, dto: CreateVitalRecordDto): Promise<VitalRuleEvaluation> {
    const configuredRuleEvaluation = await this.clinicalRulesService.evaluateVital(patient, dto);

    if (configuredRuleEvaluation) {
      return configuredRuleEvaluation;
    }

    return this.evaluateVitalRuleFallback(dto);
  }

  private async createBloodPressurePair(patient: any, patientId: string, dto: CreateVitalRecordDto) {
    const systolic = getNumber(dto.systolicValue);
    const diastolic = getNumber(dto.diastolicValue);

    if (systolic === null || diastolic === null) {
      throw new BadRequestException('选择血压时必须同时填写收缩压和舒张压');
    }

    if (systolic <= 0 || diastolic <= 0 || systolic < diastolic) {
      throw new BadRequestException('请输入有效的血压值，收缩压应大于或等于舒张压');
    }

    const measuredAt = new Date(dto.measuredAt);
    const unit = dto.unit || 'mmHg';
    const baseDto = {
      ...dto,
      unit,
      measuredAt: dto.measuredAt,
      dataSource: dto.dataSource,
      isAbnormal: dto.isAbnormal,
      monitoringPlanId: dto.monitoringPlanId,
      scheduledAt: dto.scheduledAt,
      note: dto.note,
    };

    const systolicDto: CreateVitalRecordDto = {
      ...baseDto,
      type: 'SYSTOLIC_BP',
      value: systolic,
    };
    const diastolicDto: CreateVitalRecordDto = {
      ...baseDto,
      type: 'DIASTOLIC_BP',
      value: diastolic,
    };

    const [systolicEvaluation, diastolicEvaluation] = await Promise.all([
      this.evaluateVitalRule(patient, systolicDto),
      this.evaluateVitalRule(patient, diastolicDto),
    ]);

    const abnormalEvaluations = [
      { component: '收缩压', evaluation: systolicEvaluation },
      { component: '舒张压', evaluation: diastolicEvaluation },
    ].filter((item) => item.evaluation.isAbnormal);

    abnormalEvaluations.sort(
      (a, b) => riskRank[b.evaluation.riskLevel] - riskRank[a.evaluation.riskLevel],
    );

    const top = abnormalEvaluations[0];
    const ruleEvaluation: VitalRuleEvaluation = top
      ? {
          ...top.evaluation,
          title: '异常健康指标：血压',
          description: [
            `血压 ${systolic}/${diastolic} ${unit}`,
            ...abnormalEvaluations.map((item) => `${item.component}：${item.evaluation.triggerRule}`),
          ].join('；'),
          triggerRule: abnormalEvaluations
            .map((item) => `${item.component}：${item.evaluation.triggerRule}`)
            .join('；'),
        }
      : {
          isAbnormal: false,
          riskLevel: RiskLevel.LOW,
          title: '健康指标：血压',
          description: `血压 ${systolic}/${diastolic} ${unit}，正常`,
          triggerRule: '未触发自动异常规则',
        };

    return this.prisma.$transaction(async (tx) => {
      const systolicRecord = await tx.vitalRecord.create({
        data: {
          patientId,
          type: 'SYSTOLIC_BP',
          value: systolic,
          unit,
          measuredAt,
          dataSource: dto.dataSource,
          isAbnormal: systolicEvaluation.isAbnormal,
          note: dto.note,
          monitoringPlanId: dto.monitoringPlanId,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        },
      });

      const diastolicRecord = await tx.vitalRecord.create({
        data: {
          patientId,
          type: 'DIASTOLIC_BP',
          value: diastolic,
          unit,
          measuredAt,
          dataSource: dto.dataSource,
          isAbnormal: diastolicEvaluation.isAbnormal,
          note: dto.note,
          monitoringPlanId: dto.monitoringPlanId,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        },
      });

      if (dto.monitoringPlanId) {
        await tx.vitalMonitoringPlan.update({
          where: { id: dto.monitoringPlanId },
          data: { lastCheckInAt: measuredAt },
        });
      }

      let generatedRiskAlert: RiskAlert | null = null;
      let generatedTask: Task | null = null;

      if (ruleEvaluation.isAbnormal) {
        const sourceVitalRecordId = top?.component === '舒张压' ? diastolicRecord.id : systolicRecord.id;
        generatedRiskAlert = await tx.riskAlert.create({
          data: {
            patientId,
            riskType: 'VITAL_ABNORMAL',
            riskLevel: ruleEvaluation.riskLevel,
            title: ruleEvaluation.title,
            description: ruleEvaluation.description,
            triggerRule: ruleEvaluation.triggerRule,
            sourceVitalRecordId,
          },
        });

        generatedTask = await tx.task.create({
          data: {
            patientId,
            title: this.getAlertReviewTaskTitle(ruleEvaluation),
            type: 'RISK_ALERT_FOLLOW_UP',
            dueAt: this.getAlertReviewDueAt(ruleEvaluation),
            assigneeId: patient.responsibleNurseId ?? undefined,
            relatedAlertId: generatedRiskAlert.id,
          },
        });
      }

      return {
        vitalRecord: systolicRecord,
        vitalRecords: [systolicRecord, diastolicRecord],
        bloodPressurePair: {
          systolicRecord,
          diastolicRecord,
        },
        generatedRiskAlert,
        generatedTask,
        ruleEvaluation,
        componentRuleEvaluations: {
          systolic: systolicEvaluation,
          diastolic: diastolicEvaluation,
        },
      };
    });
  }

  async create(patientId: string, dto: CreateVitalRecordDto) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      include: { diseaseProfiles: true },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    let monitoringPlan: any = null;
    if (dto.monitoringPlanId) {
      monitoringPlan = await this.prisma.vitalMonitoringPlan.findUnique({
        where: { id: dto.monitoringPlanId },
      });

      if (!monitoringPlan || monitoringPlan.patientId !== patientId) {
        throw new NotFoundException('Vital monitoring plan not found for this patient');
      }
    }

    if (dto.type === 'BLOOD_PRESSURE') {
      return this.createBloodPressurePair(patient, patientId, dto);
    }

    if (getNumber(dto.value) === null) {
      throw new BadRequestException('请输入有效的指标数值');
    }

    const ruleEvaluation = await this.evaluateVitalRule(patient, dto);
    const measuredAt = new Date(dto.measuredAt);

    return this.prisma.$transaction(async (tx) => {
      const vitalRecord = await tx.vitalRecord.create({
        data: {
          patientId,
          type: dto.type,
          value: Number(dto.value),
          unit: dto.unit,
          measuredAt,
          dataSource: dto.dataSource,
          isAbnormal: ruleEvaluation.isAbnormal,
          note: dto.note,
          monitoringPlanId: dto.monitoringPlanId,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        },
      });

      if (dto.monitoringPlanId) {
        await tx.vitalMonitoringPlan.update({
          where: { id: dto.monitoringPlanId },
          data: { lastCheckInAt: measuredAt },
        });
      }

      let generatedRiskAlert: RiskAlert | null = null;
      let generatedTask: Task | null = null;

      if (ruleEvaluation.isAbnormal) {
        generatedRiskAlert = await tx.riskAlert.create({
          data: {
            patientId,
            riskType: 'VITAL_ABNORMAL',
            riskLevel: ruleEvaluation.riskLevel,
            title: ruleEvaluation.title,
            description: ruleEvaluation.description,
            triggerRule: ruleEvaluation.triggerRule,
            sourceVitalRecordId: vitalRecord.id,
          },
        });

        generatedTask = await tx.task.create({
          data: {
            patientId,
            title: this.getAlertReviewTaskTitle(ruleEvaluation),
            type: 'RISK_ALERT_FOLLOW_UP',
            dueAt: this.getAlertReviewDueAt(ruleEvaluation),
            assigneeId: patient.responsibleNurseId ?? undefined,
            relatedAlertId: generatedRiskAlert.id,
          },
        });
      }

      return {
        vitalRecord,
        generatedRiskAlert,
        generatedTask,
        ruleEvaluation,
      };
    });
  }

  async findByPatient(patientId: string, query: QueryVitalRecordsDto) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    return this.prisma.vitalRecord.findMany({
      where: {
        patientId,
        type: query.type === 'BLOOD_PRESSURE' ? { in: ['SYSTOLIC_BP', 'DIASTOLIC_BP'] } : query.type,
      },
      include: {
        monitoringPlan: true,
      },
      orderBy: {
        measuredAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const record = await this.prisma.vitalRecord.findUnique({
      where: { id },
      include: {
        patient: true,
        monitoringPlan: true,
      },
    });

    if (!record) {
      throw new NotFoundException('Vital record not found');
    }

    return record;
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.vitalRecord.delete({
      where: { id },
    });
  }
}











