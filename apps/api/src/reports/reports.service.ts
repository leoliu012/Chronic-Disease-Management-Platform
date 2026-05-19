import { Injectable } from '@nestjs/common';
import { AlertStatus, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryReportDto } from './dto/query-report.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private buildDateFilter(from?: string, to?: string) {
    if (!from && !to) {
      return undefined;
    }

    return {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  async getOverview(query: QueryReportDto) {
    const createdAtFilter = this.buildDateFilter(query.from, query.to);

    const patientWhere: Prisma.PatientWhereInput = {};
    const diseaseWhere: Prisma.DiseaseProfileWhereInput = {};
    const vitalWhere: Prisma.VitalRecordWhereInput = {};
    const riskAlertWhere: Prisma.RiskAlertWhereInput = {};
    const taskWhere: Prisma.TaskWhereInput = {};
    const followUpWhere: Prisma.FollowUpRecordWhereInput = {};

    if (query.nurseId) {
      patientWhere.responsibleNurseId = query.nurseId;

      diseaseWhere.patient = {
        responsibleNurseId: query.nurseId,
      };

      vitalWhere.patient = {
        responsibleNurseId: query.nurseId,
      };

      riskAlertWhere.patient = {
        responsibleNurseId: query.nurseId,
      };

      taskWhere.assigneeId = query.nurseId;

      followUpWhere.patient = {
        responsibleNurseId: query.nurseId,
      };
    }

    if (createdAtFilter) {
      patientWhere.createdAt = createdAtFilter;
      diseaseWhere.createdAt = createdAtFilter;
      riskAlertWhere.createdAt = createdAtFilter;
      taskWhere.createdAt = createdAtFilter;
      followUpWhere.createdAt = createdAtFilter;

      vitalWhere.measuredAt = createdAtFilter;
    }

    const [
      patientCount,
      diseaseProfileCount,
      diseaseDistribution,
      riskLevelDistribution,
      vitalRecordCount,
      abnormalVitalRecordCount,
      openRiskAlertCount,
      resolvedRiskAlertCount,
      pendingTaskCount,
      completedTaskCount,
      followUpCount,
      recentAbnormalVitals,
      recentOpenRiskAlerts,
    ] = await Promise.all([
      this.prisma.patient.count({
        where: patientWhere,
      }),

      this.prisma.diseaseProfile.count({
        where: diseaseWhere,
      }),

      this.prisma.diseaseProfile.groupBy({
        by: ['diseaseType'],
        where: diseaseWhere,
        _count: {
          _all: true,
        },
      }),

      this.prisma.diseaseProfile.groupBy({
        by: ['riskLevel'],
        where: diseaseWhere,
        _count: {
          _all: true,
        },
      }),

      this.prisma.vitalRecord.count({
        where: vitalWhere,
      }),

      this.prisma.vitalRecord.count({
        where: {
          ...vitalWhere,
          isAbnormal: true,
        },
      }),

      this.prisma.riskAlert.count({
        where: {
          ...riskAlertWhere,
          status: AlertStatus.OPEN,
        },
      }),

      this.prisma.riskAlert.count({
        where: {
          ...riskAlertWhere,
          status: AlertStatus.RESOLVED,
        },
      }),

      this.prisma.task.count({
        where: {
          ...taskWhere,
          status: TaskStatus.PENDING,
        },
      }),

      this.prisma.task.count({
        where: {
          ...taskWhere,
          status: TaskStatus.DONE,
        },
      }),

      this.prisma.followUpRecord.count({
        where: followUpWhere,
      }),

      this.prisma.vitalRecord.findMany({
        where: {
          ...vitalWhere,
          isAbnormal: true,
        },
        include: {
          patient: true,
        },
        orderBy: {
          measuredAt: 'desc',
        },
        take: 10,
      }),

      this.prisma.riskAlert.findMany({
        where: {
          ...riskAlertWhere,
          status: AlertStatus.OPEN,
        },
        include: {
          patient: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
      }),
    ]);

    return {
      filters: {
        nurseId: query.nurseId ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
      },
      summary: {
        patientCount,
        diseaseProfileCount,
        vitalRecordCount,
        abnormalVitalRecordCount,
        openRiskAlertCount,
        resolvedRiskAlertCount,
        pendingTaskCount,
        completedTaskCount,
        followUpCount,
      },
      diseaseDistribution: diseaseDistribution.map((item) => ({
        diseaseType: item.diseaseType,
        count: item._count._all,
      })),
      riskLevelDistribution: riskLevelDistribution.map((item) => ({
        riskLevel: item.riskLevel,
        count: item._count._all,
      })),
      recentAbnormalVitals,
      recentOpenRiskAlerts,
    };
  }
}
