import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { maskPatientForList } from '../security/data-masking';
import { ClinicalAccessScopeService } from '../security/clinical-access-scope.service';
import type { RequestUser } from '../security/request-user.type';

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClinicalAccessScopeService,
  ) {}

  async create(dto: CreatePatientDto, user: RequestUser) {
    const hospitalTenantId = await this.access.resolveCreatePatientTenant(user, dto.hospitalTenantId);
    await this.access.validatePatientAssignment(
      user,
      hospitalTenantId,
      dto.responsibleDoctorId,
      dto.responsibleNurseId,
    );
    return this.prisma.patient.create({
      data: {
        ...dto,
        hospitalTenantId,
        // No hidden default nurse. Unassigned patients remain in the pending-allocation queue.
        responsibleDoctorId: dto.responsibleDoctorId || undefined,
        responsibleNurseId: dto.responsibleNurseId || undefined,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
      },
    });
  }

  async findAll(user: RequestUser, hospitalTenantId?: string) {
    const patients = await this.prisma.patient.findMany({
      where: await this.access.buildPatientScope(user, hospitalTenantId),
      orderBy: { createdAt: 'desc' },
      include: {
        diseaseProfiles: true,
        vitalRecords: { orderBy: { measuredAt: 'desc' }, take: 5 },
        tasks: { where: { status: 'PENDING' }, orderBy: { dueAt: 'asc' } },
      },
    });
    return patients.map((patient) => maskPatientForList(patient));
  }

  async findOne(id: string) {
    return this.prisma.patient.findUnique({
      where: { id },
      include: {
        diseaseProfiles: true,
        vitalRecords: {
          orderBy: {
            measuredAt: 'desc',
          },
        },
        followUps: {
          orderBy: {
            followUpTime: 'desc',
          },
        },
        tasks: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
  }

  async getClinicalTimeline(patientId: string, taskType?: string) {
    // Determine relevant vital types and risk types based on task type
    let relevantVitalTypes: string[] = [];
    let relevantRiskTypes: string[] = [];
    let relevantMedicationKeywords: string[] = [];

    if (taskType) {
      if (taskType.includes('BLOOD_PRESSURE') || taskType.includes('HYPERTENSION')) {
        relevantVitalTypes = ['SYSTOLIC_BP', 'DIASTOLIC_BP'];
        relevantRiskTypes = ['HYPERTENSION_HIGH_RISK', 'BLOOD_PRESSURE_ABNORMAL'];
        relevantMedicationKeywords = ['降压', '氨氯地平', '缬沙坦', '厄贝沙坦', '硝苯地平'];
      } else if (taskType.includes('GLUCOSE') || taskType.includes('DIABETES')) {
        relevantVitalTypes = ['BLOOD_GLUCOSE'];
        relevantRiskTypes = ['DIABETES_HIGH_RISK', 'BLOOD_GLUCOSE_ABNORMAL'];
        relevantMedicationKeywords = ['降糖', '二甲双胍', '格列', '胰岛素'];
      } else if (taskType.includes('SPO2') || taskType.includes('OXYGEN')) {
        relevantVitalTypes = ['SPO2'];
        relevantRiskTypes = ['COPD_HIGH_RISK', 'SPO2_ABNORMAL'];
        relevantMedicationKeywords = ['吸入', '沙丁胺醇', '布地奈德', '噻托溴铵'];
      } else if (taskType.includes('HEART_RATE')) {
        relevantVitalTypes = ['HEART_RATE'];
        relevantRiskTypes = ['HEART_RATE_ABNORMAL'];
        relevantMedicationKeywords = [];
      }
    }

    const cutoff90Days = new Date();
    cutoff90Days.setDate(cutoff90Days.getDate() - 90);

    // Fetch all data in parallel
    const [
      allVitalRecords,
      riskAlerts,
      followUps,
      activeMedications,
      inactiveMedications,
      encounterRecords,
      examReports,
      medicalRecordSummaries,
      hospitalMedications,
    ] = await Promise.all([
      this.prisma.vitalRecord.findMany({
        where: {
          patientId,
          measuredAt: { gte: cutoff90Days },
        },
        orderBy: { measuredAt: 'desc' },
      }),
      this.prisma.riskAlert.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.followUpRecord.findMany({
        where: { patientId },
        orderBy: { followUpTime: 'desc' },
        take: 20,
      }),
      this.prisma.medicationRecord.findMany({
        where: {
          patientId,
          isActive: true,
        },
        include: {
          checkIns: {
            orderBy: { checkedAt: 'desc' },
            take: 30,
          },
        },
      }),
      this.prisma.medicationRecord.findMany({
        where: {
          patientId,
          isActive: false,
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      this.prisma.encounterRecord.findMany({
        where: { patientId },
        orderBy: { visitTime: 'desc' },
        take: 10,
      }),
      this.prisma.examReportRecord.findMany({
        where: { patientId },
        orderBy: { examTime: 'desc' },
        take: 10,
      }),
      this.prisma.medicalRecordSummary.findMany({
        where: { patientId },
        orderBy: { recordTime: 'desc' },
        take: 10,
      }),
      this.prisma.hospitalMedicationOrder.findMany({
        where: { patientId },
        orderBy: { prescribedAt: 'desc' },
        take: 20,
      }),
    ]);

    // Group vitals by type for vitalTrends tab
    const vitalTrends: Record<string, any[]> = {};
    const vitalTypes = ['SYSTOLIC_BP', 'DIASTOLIC_BP', 'BLOOD_GLUCOSE', 'SPO2', 'HEART_RATE', 'WEIGHT'];
    vitalTypes.forEach((type) => {
      vitalTrends[type] = allVitalRecords
        .filter((v) => v.type === type)
        .map((v) => ({
          time: v.measuredAt.toISOString(),
          data: { value: v.value, unit: v.unit, type: v.type, isAbnormal: v.isAbnormal },
        }));
    });

    // Build task-related data
    const taskRelated: any = {};
    if (relevantVitalTypes.length > 0) {
      const relevantVitals = allVitalRecords.filter((v) => relevantVitalTypes.includes(v.type));
      taskRelated.vitalTrend = relevantVitals.map((v) => ({
        time: v.measuredAt.toISOString(),
        data: { value: v.value, unit: v.unit, type: v.type, isAbnormal: v.isAbnormal },
      }));
      taskRelated.vitalType = relevantVitalTypes[0];
      taskRelated.unit = relevantVitals[0]?.unit || '';
    }

    if (relevantRiskTypes.length > 0) {
      taskRelated.relatedAlerts = riskAlerts.filter((alert) =>
        relevantRiskTypes.some((type) => alert.riskType.includes(type)),
      );
    } else {
      taskRelated.relatedAlerts = [];
    }

    if (relevantMedicationKeywords.length > 0) {
      taskRelated.relatedMedications = activeMedications.filter((med) =>
        relevantMedicationKeywords.some((keyword) => med.medicationName.includes(keyword)),
      );
    } else {
      taskRelated.relatedMedications = [];
    }

    taskRelated.relatedFollowUps = followUps.filter(
      (f) =>
        relevantVitalTypes.some((type) => f.content?.includes(type) || f.result?.includes(type)) ||
        relevantMedicationKeywords.some((keyword) => f.content?.includes(keyword) || f.result?.includes(keyword)),
    );

    // Build medications data with adherence summary
    const medicationsWithAdherence = activeMedications.map((med) => {
      const recentCheckIns = med.checkIns.slice(0, 14);
      const takenCount = recentCheckIns.filter((c) => c.taken).length;
      const totalCount = recentCheckIns.length;
      const adherenceRate = totalCount > 0 ? Math.round((takenCount / totalCount) * 100) : 0;
      const lastMissedCheckIn = med.checkIns.find((c) => !c.taken);

      return {
        ...med,
        adherenceSummary: {
          recentCheckInCount: totalCount,
          recentTakenCount: takenCount,
          recentMissedCount: totalCount - takenCount,
          adherenceRate,
        },
        lastMissedCheckIn,
      };
    });

    return {
      taskRelated,
      vitalTrends,
      riskAlerts,
      followUps,
      medications: {
        active: medicationsWithAdherence,
        inactive: inactiveMedications,
      },
      hospitalRecords: {
        encounters: encounterRecords,
        examReports,
        summaries: medicalRecordSummaries,
        medications: hospitalMedications,
      },
    };
  }
}


