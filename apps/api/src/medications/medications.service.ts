import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RiskAlert, RiskLevel, Task } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMedicationCheckInDto } from './dto/create-medication-check-in.dto';
import { CreateMedicationDto } from './dto/create-medication.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';

type FrequencyUnit = 'DAY' | 'WEEK' | 'MONTH';
type TimingRelation = 'NONE' | 'BEFORE_MEAL' | 'AFTER_MEAL' | 'WITH_MEAL';

type MedicationForSchedule = {
  id: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  frequencyUnit?: string | null;
  timesPerUnit?: number | null;
  timingRelation?: string | null;
  customDoseTimes?: any;
  customDoseDays?: any;
  reminderLeadMinutes?: number | null;
  checkInWindowBeforeMinutes?: number | null;
  missedWindowAfterMinutes?: number | null;
  checkIns?: Array<{
    id: string;
    taken: boolean;
    checkedAt: Date;
    scheduledAt?: Date | null;
  }>;
};

@Injectable()
export class MedicationsService {
  constructor(private readonly prisma: PrismaService) {}

  private getMedicationFollowUpDueAt() {
    const dueAt = new Date();
    dueAt.setHours(dueAt.getHours() + 24);
    return dueAt;
  }

  private clampNumber(value: unknown, min: number, max: number, fallback: number) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.round(numeric)));
  }

  private normalizeFrequencyUnit(value?: string | null): FrequencyUnit {
    if (value === 'WEEK' || value === 'MONTH') return value;
    return 'DAY';
  }

  private normalizeTimingRelation(value?: string | null): TimingRelation {
    if (value === 'BEFORE_MEAL' || value === 'AFTER_MEAL' || value === 'WITH_MEAL') return value;
    return 'NONE';
  }

  private normalizeDoseTimes(value: unknown) {
    const raw = Array.isArray(value) ? value : [];
    return raw
      .map((item) => String(item).trim())
      .filter((item) => /^([01]\d|2[0-3]):[0-5]\d$/.test(item));
  }

  private normalizeDoseDays(value: unknown, unit: FrequencyUnit) {
    const max = unit === 'WEEK' ? 7 : 31;
    const raw = Array.isArray(value) ? value : [];
    return Array.from(
      new Set(
        raw
          .map((item) => Number(item))
          .filter((item) => Number.isInteger(item) && item >= 1 && item <= max),
      ),
    ).sort((a, b) => a - b);
  }

  private getDefaultDoseTimes(timesPerUnit: number) {
    if (timesPerUnit <= 1) return ['08:00'];
    if (timesPerUnit === 2) return ['08:00', '18:00'];
    if (timesPerUnit === 3) return ['08:00', '13:00', '18:00'];
    if (timesPerUnit === 4) return ['08:00', '12:00', '16:00', '20:00'];

    const result: string[] = [];
    const start = 8 * 60;
    const end = 20 * 60;
    const step = (end - start) / (timesPerUnit - 1);

    for (let index = 0; index < timesPerUnit; index += 1) {
      const minutes = Math.round(start + step * index);
      const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
      const minute = String(minutes % 60).padStart(2, '0');
      result.push(`${hour}:${minute}`);
    }

    return result;
  }

  private getDefaultDoseDays(timesPerUnit: number, unit: FrequencyUnit) {
    if (unit === 'DAY') return [];

    const max = unit === 'WEEK' ? 7 : 28;
    if (timesPerUnit <= 1) return [unit === 'WEEK' ? 1 : 1];

    const result: number[] = [];
    for (let index = 0; index < timesPerUnit; index += 1) {
      const day = Math.round(1 + ((max - 1) * index) / (timesPerUnit - 1));
      result.push(day);
    }

    return Array.from(new Set(result)).slice(0, timesPerUnit);
  }

  private relationLabel(value: TimingRelation) {
    const map: Record<TimingRelation, string> = {
      NONE: '',
      BEFORE_MEAL: '饭前',
      AFTER_MEAL: '饭后',
      WITH_MEAL: '随餐',
    };
    return map[value];
  }

  private unitLabel(value: FrequencyUnit) {
    const map: Record<FrequencyUnit, string> = {
      DAY: '日',
      WEEK: '周',
      MONTH: '月',
    };
    return map[value];
  }

  private buildFrequencyText(params: {
    frequencyUnit: FrequencyUnit;
    timesPerUnit: number;
    timingRelation: TimingRelation;
    customDoseTimes: string[];
    customDoseDays: number[];
  }) {
    const relationText = this.relationLabel(params.timingRelation);
    const dayText = params.frequencyUnit === 'WEEK'
      ? params.customDoseDays.map((day) => `周${'一二三四五六日'[day - 1]}`).join('、')
      : params.frequencyUnit === 'MONTH'
        ? params.customDoseDays.map((day) => `${day}日`).join('、')
        : '';
    const timeText = params.customDoseTimes.length ? params.customDoseTimes.join('、') : '系统自动均摊';

    return [
      `每${this.unitLabel(params.frequencyUnit)} ${params.timesPerUnit} 次`,
      relationText,
      dayText ? `指定：${dayText}` : '',
      `时间：${timeText}`,
    ]
      .filter(Boolean)
      .join('；');
  }

  private parseMedicationSchedule(dto: CreateMedicationDto) {
    const frequencyUnit = this.normalizeFrequencyUnit(dto.frequencyUnit);
    const maxTimes = frequencyUnit === 'DAY' ? 8 : frequencyUnit === 'WEEK' ? 7 : 31;
    const timesPerUnit = this.clampNumber(dto.timesPerUnit, 1, maxTimes, 1);
    const timingRelation = this.normalizeTimingRelation(dto.timingRelation);
    const customDoseTimes = this.normalizeDoseTimes(dto.customDoseTimes);
    const customDoseDays = this.normalizeDoseDays(dto.customDoseDays, frequencyUnit);

    return {
      frequencyUnit,
      timesPerUnit,
      timingRelation,
      customDoseTimes: customDoseTimes.length ? customDoseTimes : undefined,
      customDoseDays: customDoseDays.length ? customDoseDays : undefined,
      frequency: dto.frequency || this.buildFrequencyText({
        frequencyUnit,
        timesPerUnit,
        timingRelation,
        customDoseTimes,
        customDoseDays,
      }),
    };
  }

  private buildAdherenceSummary(checkIns: Array<{ taken: boolean }>) {
    const total = checkIns.length;
    const takenCount = checkIns.filter((item) => item.taken).length;

    return {
      recentCheckInCount: total,
      recentTakenCount: takenCount,
      recentMissedCount: total - takenCount,
      adherenceRate: total > 0 ? Math.round((takenCount / total) * 100) : null,
    };
  }

  private getMonthLastDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }

  private setTimeOnDate(date: Date, hhmm: string) {
    const [hour, minute] = hhmm.split(':').map((item) => Number(item));
    const next = new Date(date);
    next.setHours(hour, minute, 0, 0);
    return next;
  }

  private getWeekDay(date: Date) {
    const day = date.getDay();
    return day === 0 ? 7 : day;
  }

  private getDoseTimesForMedication(medication: MedicationForSchedule) {
    const unit = this.normalizeFrequencyUnit(medication.frequencyUnit);
    const timesPerUnit = this.clampNumber(
      medication.timesPerUnit,
      1,
      unit === 'DAY' ? 8 : unit === 'WEEK' ? 7 : 31,
      1,
    );
    const customTimes = this.normalizeDoseTimes(medication.customDoseTimes);

    if (customTimes.length > 0) {
      return customTimes.slice(0, unit === 'DAY' ? timesPerUnit : Math.max(timesPerUnit, customTimes.length));
    }

    return unit === 'DAY' ? this.getDefaultDoseTimes(timesPerUnit) : ['08:00'];
  }

  private getDoseDaysForMedication(medication: MedicationForSchedule) {
    const unit = this.normalizeFrequencyUnit(medication.frequencyUnit);
    const timesPerUnit = this.clampNumber(
      medication.timesPerUnit,
      1,
      unit === 'DAY' ? 8 : unit === 'WEEK' ? 7 : 31,
      1,
    );
    const customDays = this.normalizeDoseDays(medication.customDoseDays, unit);

    if (unit === 'DAY') return [];
    return customDays.length ? customDays.slice(0, timesPerUnit) : this.getDefaultDoseDays(timesPerUnit, unit);
  }

  private buildOccurrences(medication: MedicationForSchedule, from: Date, daysForward = 60) {
    const unit = this.normalizeFrequencyUnit(medication.frequencyUnit);
    const times = this.getDoseTimesForMedication(medication);
    const days = this.getDoseDaysForMedication(medication);
    const result: Date[] = [];

    const cursor = new Date(from);
    cursor.setHours(0, 0, 0, 0);

    for (let offset = 0; offset <= daysForward; offset += 1) {
      const date = new Date(cursor);
      date.setDate(cursor.getDate() + offset);

      if (unit === 'WEEK' && !days.includes(this.getWeekDay(date))) {
        continue;
      }

      if (unit === 'MONTH') {
        const monthDay = date.getDate();
        const lastDay = this.getMonthLastDay(date);
        const normalizedDays = days.map((day) => Math.min(day, lastDay));
        if (!normalizedDays.includes(monthDay)) {
          continue;
        }
      }

      if (unit === 'DAY') {
        times.forEach((time) => result.push(this.setTimeOnDate(date, time)));
      } else {
        const indexForDay = days.indexOf(unit === 'WEEK' ? this.getWeekDay(date) : date.getDate());
        const time = times[indexForDay >= 0 && times[indexForDay] ? indexForDay : 0] ?? '08:00';
        result.push(this.setTimeOnDate(date, time));
      }
    }

    return result.sort((a, b) => a.getTime() - b.getTime());
  }

  private isSameDoseSlot(a?: Date | null, b?: Date | null) {
    if (!a || !b) return false;
    return Math.abs(a.getTime() - b.getTime()) < 60 * 1000;
  }

  private hasCheckInForDose(medication: MedicationForSchedule, scheduledAt: Date) {
    const checkIns = medication.checkIns ?? [];

    return checkIns.some((item) => {
      if (item.scheduledAt && this.isSameDoseSlot(item.scheduledAt, scheduledAt)) return true;

      const checkedAt = item.checkedAt;
      return (
        checkedAt.getFullYear() === scheduledAt.getFullYear() &&
        checkedAt.getMonth() === scheduledAt.getMonth() &&
        checkedAt.getDate() === scheduledAt.getDate() &&
        Math.abs(checkedAt.getTime() - scheduledAt.getTime()) <= 6 * 60 * 60 * 1000
      );
    });
  }

  private buildNextDose(medication: MedicationForSchedule) {
    const now = new Date();
    const beforeMinutes = this.clampNumber(medication.checkInWindowBeforeMinutes, 0, 24 * 60, 180);
    const afterMinutes = this.clampNumber(medication.missedWindowAfterMinutes, 0, 24 * 60, 180);
    const reminderMinutes = this.clampNumber(medication.reminderLeadMinutes, 0, 24 * 60, 180);

    const occurrences = this.buildOccurrences(medication, now, 60);
    const nextScheduledAt = occurrences.find((item) => !this.hasCheckInForDose(medication, item));

    if (!nextScheduledAt) return null;

    const checkInAvailableAt = new Date(nextScheduledAt.getTime() - beforeMinutes * 60 * 1000);
    const missedAvailableAt = new Date(nextScheduledAt.getTime() + afterMinutes * 60 * 1000);
    const reminderAt = new Date(nextScheduledAt.getTime() - reminderMinutes * 60 * 1000);

    return {
      scheduledAt: nextScheduledAt.toISOString(),
      reminderAt: reminderAt.toISOString(),
      checkInAvailableAt: checkInAvailableAt.toISOString(),
      missedAvailableAt: missedAvailableAt.toISOString(),
      canCheckIn: now >= checkInAvailableAt,
      canReportMissed: now >= missedAvailableAt,
      wechatReminderStatus: 'RESERVED_SUBSCRIBE_MESSAGE_NOT_SENT',
    };
  }

  private withSchedulePresentation<T extends MedicationForSchedule>(medication: T) {
    return {
      ...medication,
      adherenceSummary: this.buildAdherenceSummary(medication.checkIns ?? []),
      schedule: {
        frequencyUnit: this.normalizeFrequencyUnit(medication.frequencyUnit),
        timesPerUnit: this.clampNumber(medication.timesPerUnit, 1, 31, 1),
        timingRelation: this.normalizeTimingRelation(medication.timingRelation),
        doseTimes: this.getDoseTimesForMedication(medication),
        doseDays: this.getDoseDaysForMedication(medication),
        reminderLeadMinutes: this.clampNumber(medication.reminderLeadMinutes, 0, 1440, 180),
        checkInWindowBeforeMinutes: this.clampNumber(medication.checkInWindowBeforeMinutes, 0, 1440, 180),
        missedWindowAfterMinutes: this.clampNumber(medication.missedWindowAfterMinutes, 0, 1440, 180),
      },
      nextDose: this.buildNextDose(medication),
    };
  }


  private normalizeMedicationForUpdate(
    existing: any,
    dto: UpdateMedicationDto,
  ): CreateMedicationDto {
    return {
      medicationName: dto.medicationName ?? existing.medicationName,
      dosage: dto.dosage ?? existing.dosage,
      frequency: dto.frequency,
      frequencyUnit: dto.frequencyUnit ?? existing.frequencyUnit ?? 'DAY',
      timesPerUnit: dto.timesPerUnit ?? existing.timesPerUnit ?? 1,
      timingRelation: dto.timingRelation ?? existing.timingRelation ?? 'NONE',
      customDoseTimes: dto.customDoseTimes ?? existing.customDoseTimes ?? undefined,
      customDoseDays: dto.customDoseDays ?? existing.customDoseDays ?? undefined,
      instructions: dto.instructions ?? existing.instructions ?? undefined,
      startDate: dto.startDate ?? (existing.startDate ? existing.startDate.toISOString() : undefined),
      endDate: dto.endDate ?? (existing.endDate ? existing.endDate.toISOString() : undefined),
      dataSource: dto.dataSource ?? existing.dataSource,
      isActive: dto.isActive ?? existing.isActive,
    };
  }

  async createMedication(patientId: string, dto: CreateMedicationDto) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    const schedule = this.parseMedicationSchedule(dto);

    const medication = await this.prisma.medicationRecord.create({
      data: {
        patientId,
        medicationName: dto.medicationName,
        dosage: dto.dosage,
        frequency: schedule.frequency,
        frequencyUnit: schedule.frequencyUnit,
        timesPerUnit: schedule.timesPerUnit,
        timingRelation: schedule.timingRelation,
        customDoseTimes: schedule.customDoseTimes,
        customDoseDays: schedule.customDoseDays,
        instructions: dto.instructions,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        dataSource: dto.dataSource,
        isActive: dto.isActive ?? true,
      },
      include: {
        checkIns: {
          orderBy: { checkedAt: 'desc' },
          take: 14,
        },
      },
    });

    return this.withSchedulePresentation(medication);
  }


  async updateMedication(id: string, dto: UpdateMedicationDto) {
    const existingMedication = await this.prisma.medicationRecord.findUnique({
      where: { id },
      include: {
        checkIns: {
          orderBy: { checkedAt: 'desc' },
          take: 14,
        },
      },
    });

    if (!existingMedication) {
      throw new NotFoundException('Medication not found');
    }

    const normalized = this.normalizeMedicationForUpdate(existingMedication, dto);
    const schedule = this.parseMedicationSchedule(normalized);

    const medication = await this.prisma.medicationRecord.update({
      where: { id },
      data: {
        medicationName: normalized.medicationName,
        dosage: normalized.dosage,
        frequency: schedule.frequency,
        frequencyUnit: schedule.frequencyUnit,
        timesPerUnit: schedule.timesPerUnit,
        timingRelation: schedule.timingRelation,
        customDoseTimes: schedule.customDoseTimes ?? [],
        customDoseDays: schedule.customDoseDays ?? [],
        instructions: normalized.instructions,
        startDate: normalized.startDate ? new Date(normalized.startDate) : existingMedication.startDate,
        endDate: dto.endDate
          ? new Date(dto.endDate)
          : dto.isActive === false && !existingMedication.endDate
            ? new Date()
            : dto.isActive === true
              ? null
              : existingMedication.endDate,
        dataSource: normalized.dataSource,
        isActive: normalized.isActive ?? true,
      },
      include: {
        checkIns: {
          orderBy: { checkedAt: 'desc' },
          take: 14,
        },
      },
    });

    return this.withSchedulePresentation(medication);
  }

  async deleteMedication(id: string) {
    const existingMedication = await this.prisma.medicationRecord.findUnique({
      where: { id },
      include: {
        checkIns: {
          orderBy: { checkedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!existingMedication) {
      throw new NotFoundException('Medication not found');
    }

    // If the medication already has patient check-in history, keep the audit trail and remove it from the active patient-facing plan.
    // If there is no history yet, hard-delete the draft plan.
    if (existingMedication.checkIns.length > 0) {
      const medication = await this.prisma.medicationRecord.update({
        where: { id },
        data: {
          isActive: false,
          endDate: existingMedication.endDate ?? new Date(),
        },
        include: {
          checkIns: {
            orderBy: { checkedAt: 'desc' },
            take: 14,
          },
        },
      });

      return {
        mode: 'SOFT_DISABLED_WITH_HISTORY',
        message: '该用药计划已有患者打卡记录，已停用并从患者端当前用药中移除，历史记录已保留。',
        medication: this.withSchedulePresentation(medication),
      };
    }

    const deletedMedication = await this.prisma.medicationRecord.delete({
      where: { id },
    });

    return {
      mode: 'HARD_DELETED_EMPTY_PLAN',
      message: '该用药计划尚无患者打卡记录，已删除。',
      medication: deletedMedication,
    };
  }

  async findMedicationsByPatient(patientId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    const medications = await this.prisma.medicationRecord.findMany({
      where: { patientId },
      include: {
        checkIns: {
          orderBy: { checkedAt: 'desc' },
          take: 14,
        },
      },
      orderBy: [
        { isActive: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return medications.map((item) => this.withSchedulePresentation(item));
  }

  async findCheckInsByPatient(patientId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    return this.prisma.medicationCheckIn.findMany({
      where: { patientId },
      include: {
        medication: true,
      },
      orderBy: { checkedAt: 'desc' },
      take: 50,
    });
  }


  async findDueMedicationReminders(patientId: string) {
    const medications = await this.findMedicationsByPatient(patientId);
    const now = new Date();

    return medications
      .filter((item: any) => {
        if (!item.nextDose?.reminderAt || !item.nextDose?.scheduledAt) return false;
        const reminderAt = new Date(item.nextDose.reminderAt);
        const scheduledAt = new Date(item.nextDose.scheduledAt);
        return reminderAt <= now && scheduledAt > now;
      })
      .map((item: any) => ({
        medicationId: item.id,
        patientId: item.patientId,
        medicationName: item.medicationName,
        dosage: item.dosage,
        scheduledAt: item.nextDose.scheduledAt,
        reminderAt: item.nextDose.reminderAt,
        message: `请按时服用 ${item.medicationName}（${item.dosage}）`,
        channelStatus: 'WECHAT_SUBSCRIBE_MESSAGE_RESERVED',
      }));
  }

  async findOne(id: string) {
    const medication = await this.prisma.medicationRecord.findUnique({
      where: { id },
      include: {
        patient: true,
        checkIns: {
          orderBy: { checkedAt: 'desc' },
          take: 14,
        },
      },
    });

    if (!medication) {
      throw new NotFoundException('Medication not found');
    }

    return this.withSchedulePresentation(medication);
  }

  async createCheckIn(id: string, dto: CreateMedicationCheckInDto) {
    const medication = await this.prisma.medicationRecord.findUnique({
      where: { id },
      include: {
        patient: true,
      },
    });

    if (!medication) {
      throw new NotFoundException('Medication not found');
    }

    if (dto.scheduledAt) {
      const scheduledAt = new Date(dto.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime())) {
        throw new BadRequestException('Invalid scheduledAt');
      }
    }

    const checkedAt = dto.checkedAt ? new Date(dto.checkedAt) : new Date();
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : undefined;

    return this.prisma.$transaction(async (tx) => {
      const checkIn = await tx.medicationCheckIn.create({
        data: {
          medicationId: medication.id,
          patientId: medication.patientId,
          taken: dto.taken,
          checkedAt,
          scheduledAt,
          note: dto.note,
        },
      });

      const updatedMedication = await tx.medicationRecord.update({
        where: { id: medication.id },
        data: {
          lastCheckInAt: checkedAt,
        },
        include: {
          checkIns: {
            orderBy: { checkedAt: 'desc' },
            take: 14,
          },
        },
      });

      let generatedRiskAlert: RiskAlert | null = null;
      let generatedTask: Task | null = null;

      if (!dto.taken) {
        generatedRiskAlert = await tx.riskAlert.create({
          data: {
            patientId: medication.patientId,
            riskType: 'MEDICATION_ADHERENCE',
            riskLevel: RiskLevel.MEDIUM,
            title: `用药依从性异常：${medication.medicationName}`,
            description: `患者反馈本次未按时服用 ${medication.medicationName}；剂量：${medication.dosage}；频次：${medication.frequency}`,
            triggerRule: '患者微信小程序提交漏服/未服药打卡',
          },
        });

        generatedTask = await tx.task.create({
          data: {
            patientId: medication.patientId,
            title: `用药随访：${medication.medicationName}`,
            type: 'MEDICATION_ADHERENCE_FOLLOW_UP',
            dueAt: this.getMedicationFollowUpDueAt(),
            assigneeId: medication.patient.responsibleNurseId ?? 'nurse-001',
            relatedAlertId: generatedRiskAlert.id,
          },
        });
      }

      return {
        checkIn,
        medication: this.withSchedulePresentation(updatedMedication),
        generatedRiskAlert,
        generatedTask,
      };
    });
  }
}
