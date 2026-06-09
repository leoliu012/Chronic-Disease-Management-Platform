import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DiseaseType, RiskLevel, VitalMonitoringPlan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyVitalRecommendationsDto } from './dto/apply-vital-recommendations.dto';
import { CreateVitalMonitoringPlanDto } from './dto/create-vital-monitoring-plan.dto';
import { MarkVitalMonitoringMissedDto } from './dto/mark-vital-monitoring-missed.dto';
import { UpdateVitalMonitoringPlanDto } from './dto/update-vital-monitoring-plan.dto';

type VitalRecommendation = {
  vitalType: string;
  displayName: string;
  unit: string;
  frequencyUnit: 'DAY' | 'WEEK' | 'MONTH';
  timesPerUnit: number;
  customMeasureTimes?: string[];
  customMeasureDays?: number[];
  sourcePreset: string;
  evidenceBasis: string;
  evidenceSource: string;
};

const vitalTypeLabelMap: Record<string, string> = {
  BLOOD_PRESSURE: '血压（收缩压/舒张压）',
  SYSTOLIC_BP: '收缩压',
  DIASTOLIC_BP: '舒张压',
  BLOOD_GLUCOSE: '血糖',
  WEIGHT: '体重',
  HEART_RATE: '心率',
  SPO2: '血氧',
};

const diseaseLabelMap: Record<string, string> = {
  HYPERTENSION: '高血压',
  TYPE_2_DIABETES: '2型糖尿病',
  COPD: '慢阻肺',
  CORONARY_HEART_DISEASE: '冠心病',
  HYPERLIPIDEMIA: '高脂血症',
  OBESITY: '肥胖/代谢综合征',
  OTHER: '其他',
};

@Injectable()
export class VitalMonitoringPlansService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeTimes(values?: string[]) {
    return Array.from(
      new Set(
        (values ?? [])
          .map((item) => String(item).trim())
          .filter((item) => /^([01]\d|2[0-3]):[0-5]\d$/.test(item)),
      ),
    );
  }

  private normalizeDays(values: number[] | undefined, frequencyUnit: string) {
    const max = frequencyUnit === 'WEEK' ? 7 : frequencyUnit === 'MONTH' ? 31 : 0;
    if (!max) return [];
    return Array.from(
      new Set(
        (values ?? [])
          .map((item) => Number(item))
          .filter((item) => Number.isInteger(item) && item >= 1 && item <= max),
      ),
    ).sort((a, b) => a - b);
  }

  private buildDefaultTimes(timesPerUnit: number) {
    const count = Math.max(1, Math.min(timesPerUnit || 1, 6));
    if (count === 1) return ['08:00'];
    const start = 7;
    const end = 21;
    const step = (end - start) / (count - 1);
    return Array.from({ length: count }).map((_, index) => {
      const hour = Math.round(start + step * index);
      return `${String(hour).padStart(2, '0')}:00`;
    });
  }

  private buildDefaultDays(frequencyUnit: string, timesPerUnit: number) {
    const count = Math.max(1, Math.min(timesPerUnit || 1, frequencyUnit === 'MONTH' ? 31 : 7));
    if (frequencyUnit === 'DAY') return [];
    const max = frequencyUnit === 'WEEK' ? 7 : 31;
    if (count === 1) return frequencyUnit === 'WEEK' ? [1] : [1];
    const step = (max - 1) / (count - 1);
    return Array.from(
      new Set(
        Array.from({ length: count }).map((_, index) => Math.max(1, Math.min(max, Math.round(1 + step * index)))),
      ),
    );
  }

  private buildCandidates(plan: any, now = new Date()) {
    const frequencyUnit = plan.frequencyUnit ?? 'DAY';
    const times = this.normalizeTimes(plan.customMeasureTimes as string[] | undefined);
    const measureTimes = times.length ? times : this.buildDefaultTimes(frequencyUnit === 'DAY' ? plan.timesPerUnit : 1);
    const explicitDays = this.normalizeDays(plan.customMeasureDays as number[] | undefined, frequencyUnit);
    const days = explicitDays.length ? explicitDays : this.buildDefaultDays(frequencyUnit, plan.timesPerUnit);
    const candidates: Date[] = [];

    const pushAt = (base: Date, hhmm: string) => {
      const [hour, minute] = hhmm.split(':').map(Number);
      const item = new Date(base);
      item.setHours(hour, minute, 0, 0);
      candidates.push(item);
    };

    for (let dayOffset = -35; dayOffset <= 45; dayOffset += 1) {
      const base = new Date(now);
      base.setDate(now.getDate() + dayOffset);
      base.setHours(0, 0, 0, 0);

      if (frequencyUnit === 'DAY') {
        measureTimes.forEach((time) => pushAt(base, time));
      }

      if (frequencyUnit === 'WEEK') {
        const jsDay = base.getDay();
        const weekDay = jsDay === 0 ? 7 : jsDay;
        if (days.includes(weekDay)) {
          measureTimes.forEach((time) => pushAt(base, time));
        }
      }

      if (frequencyUnit === 'MONTH') {
        if (days.includes(base.getDate())) {
          measureTimes.forEach((time) => pushAt(base, time));
        }
      }
    }

    return candidates.sort((a, b) => a.getTime() - b.getTime());
  }

  private decoratePlan(plan: any) {
    const now = new Date();
    const beforeMinutes = plan.checkInWindowBeforeMinutes ?? 180;
    const afterMinutes = plan.missedWindowAfterMinutes ?? 180;
    const leadMinutes = plan.reminderLeadMinutes ?? 180;
    const candidates = this.buildCandidates(plan, now);

    const currentOrNext =
      candidates.find((candidate) => now.getTime() <= candidate.getTime() + afterMinutes * 60_000) ?? candidates[0];

    if (!currentOrNext) {
      return {
        ...plan,
        displayName: plan.displayName ?? vitalTypeLabelMap[plan.vitalType] ?? plan.vitalType,
        nextDue: null,
      };
    }

    const scheduledAt = currentOrNext;
    const windowStart = new Date(scheduledAt.getTime() - beforeMinutes * 60_000);
    const missedFrom = new Date(scheduledAt.getTime() + afterMinutes * 60_000);
    const reminderAt = new Date(scheduledAt.getTime() - leadMinutes * 60_000);

    return {
      ...plan,
      displayName: plan.displayName ?? vitalTypeLabelMap[plan.vitalType] ?? plan.vitalType,
      nextDue: {
        scheduledAt: scheduledAt.toISOString(),
        reminderAt: reminderAt.toISOString(),
        windowStart: windowStart.toISOString(),
        missedFrom: missedFrom.toISOString(),
        canCheckIn: now >= windowStart && now <= missedFrom,
        canMarkMissed: now > missedFrom,
      },
    };
  }

  private makeRecommendation(
    sourceDisease: DiseaseType,
    rec: Omit<VitalRecommendation, 'sourcePreset'>,
  ): VitalRecommendation {
    return {
      ...rec,
      sourcePreset: sourceDisease,
      evidenceBasis: `${diseaseLabelMap[sourceDisease]}：${rec.evidenceBasis}`,
    };
  }

  private getRecommendationSet(diseaseType: DiseaseType, riskLevel: RiskLevel): VitalRecommendation[] {
    const highRisk = riskLevel === RiskLevel.HIGH || riskLevel === RiskLevel.VERY_HIGH;

    if (diseaseType === DiseaseType.HYPERTENSION) {
      return [
        this.makeRecommendation(diseaseType, {
          vitalType: 'BLOOD_PRESSURE',
          displayName: '血压（收缩压/舒张压）',
          unit: 'mmHg',
          frequencyUnit: 'DAY',
          timesPerUnit: 2,
          customMeasureTimes: ['07:30', '19:30'],
          evidenceBasis: '默认早晚各 1 次；血压波动、调药或近期控制不佳时可临时加密。家庭血压监测常建议早晚测量，连续 3–7 天用于评估。',
          evidenceSource: '2024 ESC Hypertension guideline; AHA/AMA home BP monitoring policy statement',
        }),
      ];
    }

    if (diseaseType === DiseaseType.TYPE_2_DIABETES) {
      return [
        this.makeRecommendation(diseaseType, {
          vitalType: 'BLOOD_GLUCOSE',
          displayName: '血糖',
          unit: 'mmol/L',
          frequencyUnit: 'DAY',
          timesPerUnit: highRisk ? 2 : 1,
          customMeasureTimes: highRisk ? ['07:00', '21:00'] : ['07:00'],
          evidenceBasis: '默认至少每日 1 次；高危、低血糖风险、用胰岛素或调药期建议更频繁，并由医生/护士个体化设置。',
          evidenceSource: 'ADA Standards of Care in Diabetes: glucose monitoring should be individualized, more intensive for insulin/high-risk patients',
        }),
      ];
    }

    if (diseaseType === DiseaseType.COPD) {
      return [
        this.makeRecommendation(diseaseType, {
          vitalType: 'SPO2',
          displayName: '血氧',
          unit: '%',
          frequencyUnit: 'DAY',
          timesPerUnit: 1,
          customMeasureTimes: ['09:00'],
          evidenceBasis: '默认每日 1 次血氧；症状加重、氧疗或急性加重风险患者可加密。',
          evidenceSource: 'COPD long-term monitoring practice: symptoms and oxygen saturation monitoring for exacerbation risk',
        }),
        this.makeRecommendation(diseaseType, {
          vitalType: 'HEART_RATE',
          displayName: '心率',
          unit: 'bpm',
          frequencyUnit: 'DAY',
          timesPerUnit: 1,
          customMeasureTimes: ['09:00'],
          evidenceBasis: '与血氧同次记录，辅助识别呼吸困难、感染或急性加重相关风险。',
          evidenceSource: 'COPD symptom/vital monitoring practice',
        }),
      ];
    }

    if (diseaseType === DiseaseType.CORONARY_HEART_DISEASE) {
      return [
        this.makeRecommendation(diseaseType, {
          vitalType: 'BLOOD_PRESSURE',
          displayName: '血压（收缩压/舒张压）',
          unit: 'mmHg',
          frequencyUnit: 'DAY',
          timesPerUnit: 1,
          customMeasureTimes: ['08:00'],
          evidenceBasis: '每日记录血压，辅助二级预防和降压治疗管理；如合并高血压可按高血压方案加密。',
          evidenceSource: 'Cardiovascular risk-factor management practice; ESC hypertension guideline',
        }),
        this.makeRecommendation(diseaseType, {
          vitalType: 'HEART_RATE',
          displayName: '心率',
          unit: 'bpm',
          frequencyUnit: 'DAY',
          timesPerUnit: 1,
          customMeasureTimes: ['08:00'],
          evidenceBasis: '每日记录心率，辅助观察胸闷、心悸或用药后反应。',
          evidenceSource: 'Coronary heart disease chronic management practice',
        }),
      ];
    }

    if (diseaseType === DiseaseType.OBESITY) {
      return [
        this.makeRecommendation(diseaseType, {
          vitalType: 'WEIGHT',
          displayName: '体重',
          unit: 'kg',
          frequencyUnit: 'WEEK',
          timesPerUnit: 1,
          customMeasureDays: [1],
          customMeasureTimes: ['08:00'],
          evidenceBasis: '默认每周固定时间 1 次，适合体重趋势和生活方式干预评估。',
          evidenceSource: 'Obesity/metabolic syndrome long-term weight management practice',
        }),
      ];
    }

    if (diseaseType === DiseaseType.HYPERLIPIDEMIA) {
      return [
        this.makeRecommendation(diseaseType, {
          vitalType: 'WEIGHT',
          displayName: '体重',
          unit: 'kg',
          frequencyUnit: 'WEEK',
          timesPerUnit: 1,
          customMeasureDays: [1],
          customMeasureTimes: ['08:00'],
          evidenceBasis: '高脂血症的患者端日常监测以体重和生活方式为主；血脂复查应主要来自 LIS/检验系统。',
          evidenceSource: 'Lipid management follow-up practice; LIS lab review',
        }),
      ];
    }

    return [];
  }

  private mergeRecommendations(recommendations: VitalRecommendation[]) {
    const priority = { MONTH: 1, WEEK: 2, DAY: 3 } as Record<string, number>;
    const map = new Map<string, VitalRecommendation>();

    for (const recommendation of recommendations) {
      const existing = map.get(recommendation.vitalType);
      if (!existing) {
        map.set(recommendation.vitalType, recommendation);
        continue;
      }

      const incomingScore = priority[recommendation.frequencyUnit] * 100 + recommendation.timesPerUnit;
      const existingScore = priority[existing.frequencyUnit] * 100 + existing.timesPerUnit;
      if (incomingScore > existingScore) {
        map.set(recommendation.vitalType, {
          ...recommendation,
          evidenceBasis: `${existing.evidenceBasis}；${recommendation.evidenceBasis}`,
        });
      } else {
        map.set(existing.vitalType, {
          ...existing,
          evidenceBasis: `${existing.evidenceBasis}；${recommendation.evidenceBasis}`,
        });
      }
    }

    return Array.from(map.values());
  }

  async getRecommendations(patientId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      include: { diseaseProfiles: true },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    const raw = patient.diseaseProfiles.flatMap((profile) =>
      this.getRecommendationSet(profile.diseaseType, profile.riskLevel),
    );

    const recommendations = this.mergeRecommendations(raw);

    return {
      patientId,
      diseaseProfiles: patient.diseaseProfiles,
      recommendations,
      message: recommendations.length
        ? '已根据患者慢病档案生成推荐监测计划，护士可一键应用或手动调整。'
        : '当前患者暂无可自动推荐的慢病档案，请先补充慢病档案或手动新增监测计划。',
    };
  }

  async applyRecommendations(patientId: string, dto: ApplyVitalRecommendationsDto) {
    const { recommendations } = await this.getRecommendations(patientId);

    if (dto.replaceExisting) {
      await this.prisma.vitalMonitoringPlan.updateMany({
        where: { patientId, isActive: true },
        data: { isActive: false },
      });
    }

    const existing = await this.prisma.vitalMonitoringPlan.findMany({
      where: { patientId, isActive: true },
      select: { vitalType: true },
    });
    const existingTypes = new Set(existing.map((item) => item.vitalType));

    const created: VitalMonitoringPlan[] = [];
    for (const rec of recommendations) {
      if (!dto.replaceExisting && existingTypes.has(rec.vitalType)) continue;
      created.push(
        await this.prisma.vitalMonitoringPlan.create({
          data: {
            patientId,
            vitalType: rec.vitalType,
            displayName: rec.displayName,
            unit: rec.unit,
            frequencyUnit: rec.frequencyUnit,
            timesPerUnit: rec.timesPerUnit,
            customMeasureTimes: rec.customMeasureTimes ?? undefined,
            customMeasureDays: rec.customMeasureDays ?? undefined,
            sourcePreset: rec.sourcePreset,
            evidenceBasis: rec.evidenceBasis,
            evidenceSource: rec.evidenceSource,
          },
        }),
      );
    }

    return {
      patientId,
      createdCount: created.length,
      skippedCount: recommendations.length - created.length,
      plans: created.map((item) => this.decoratePlan(item)),
    };
  }

  async createPlan(patientId: string, dto: CreateVitalMonitoringPlanDto) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient not found');

    const times = this.normalizeTimes(dto.customMeasureTimes);
    const days = this.normalizeDays(dto.customMeasureDays, dto.frequencyUnit);

    return this.decoratePlan(
      await this.prisma.vitalMonitoringPlan.create({
        data: {
          patientId,
          vitalType: dto.vitalType,
          displayName: dto.displayName,
          unit: dto.unit,
          frequencyUnit: dto.frequencyUnit,
          timesPerUnit: dto.timesPerUnit,
          customMeasureTimes: times.length ? times : undefined,
          customMeasureDays: days.length ? days : undefined,
          reminderLeadMinutes: dto.reminderLeadMinutes ?? 180,
          checkInWindowBeforeMinutes: dto.checkInWindowBeforeMinutes ?? 180,
          missedWindowAfterMinutes: dto.missedWindowAfterMinutes ?? 180,
          sourcePreset: dto.sourcePreset,
          evidenceBasis: dto.evidenceBasis,
          evidenceSource: dto.evidenceSource,
          isActive: dto.isActive ?? true,
        },
      }),
    );
  }

  async findByPatient(patientId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient not found');

    const plans = await this.prisma.vitalMonitoringPlan.findMany({
      where: { patientId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });

    return plans.map((plan) => this.decoratePlan(plan));
  }

  async findOne(id: string) {
    const plan = await this.prisma.vitalMonitoringPlan.findUnique({
      where: { id },
      include: {
        patient: true,
        vitalRecords: { orderBy: { measuredAt: 'desc' }, take: 10 },
      },
    });

    if (!plan) throw new NotFoundException('Vital monitoring plan not found');
    return this.decoratePlan(plan);
  }

  async updatePlan(id: string, dto: UpdateVitalMonitoringPlanDto) {
    await this.findOne(id);

    const frequencyUnit = dto.frequencyUnit ?? undefined;
    const times = this.normalizeTimes(dto.customMeasureTimes);
    const days = this.normalizeDays(dto.customMeasureDays, frequencyUnit ?? 'DAY');

    return this.decoratePlan(
      await this.prisma.vitalMonitoringPlan.update({
        where: { id },
        data: {
          displayName: dto.displayName,
          unit: dto.unit,
          frequencyUnit: dto.frequencyUnit,
          timesPerUnit: dto.timesPerUnit,
          customMeasureTimes: dto.customMeasureTimes === undefined ? undefined : times,
          customMeasureDays: dto.customMeasureDays === undefined ? undefined : days,
          reminderLeadMinutes: dto.reminderLeadMinutes,
          checkInWindowBeforeMinutes: dto.checkInWindowBeforeMinutes,
          missedWindowAfterMinutes: dto.missedWindowAfterMinutes,
          evidenceBasis: dto.evidenceBasis,
          evidenceSource: dto.evidenceSource,
          isActive: dto.isActive,
        },
      }),
    );
  }

  async deactivatePlan(id: string) {
    const plan = await this.findOne(id);
    const recordCount = await this.prisma.vitalRecord.count({ where: { monitoringPlanId: id } });

    if (recordCount === 0) {
      await this.prisma.vitalMonitoringPlan.delete({ where: { id } });
      return { id, deleted: true, deactivated: false, message: '监测计划已删除。' };
    }

    const updated = await this.prisma.vitalMonitoringPlan.update({
      where: { id },
      data: { isActive: false },
    });

    return {
      ...this.decoratePlan(updated),
      deleted: false,
      deactivated: true,
      message: `监测计划⟦${plan.displayName}⟧已有历史记录，已停用并保留历史。`,
    };
  }

  async markMissed(id: string, dto: MarkVitalMonitoringMissedDto) {
    const plan = await this.prisma.vitalMonitoringPlan.findUnique({
      where: { id },
      include: { patient: true },
    });

    if (!plan) throw new NotFoundException('Vital monitoring plan not found');
    if (!plan.isActive) throw new BadRequestException('Vital monitoring plan is inactive');

    const decorated = this.decoratePlan(plan);
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : new Date(decorated.nextDue?.scheduledAt ?? new Date());

    const task = await this.prisma.task.create({
      data: {
        patientId: plan.patientId,
        title: `指标漏测提醒：${plan.displayName}`,
        type: 'VITAL_MEASUREMENT_MISSED',
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        assigneeId: plan.patient.responsibleNurseId ?? undefined,
      },
    });

    return {
      planId: id,
      scheduledAt: scheduledAt.toISOString(),
      task,
      message: '已记录本次漏测，并生成护士端复核待办。',
      note: dto.note ?? null,
    };
  }
}




