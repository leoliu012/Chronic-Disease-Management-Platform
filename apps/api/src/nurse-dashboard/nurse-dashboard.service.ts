import { Injectable } from '@nestjs/common';
import { AlertStatus, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NurseDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(nurseId: string) {
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const [
      myPatients,
      pendingTasks,
      todayTasks,
      overdueTasks,
      openRiskAlerts,
      recentAbnormalVitals,
      completedTasksCount,
    ] = await Promise.all([
      this.prisma.patient.findMany({
        where: {
          responsibleNurseId: nurseId,
        },
        include: {
          diseaseProfiles: true,
          vitalRecords: {
            orderBy: {
              measuredAt: 'desc',
            },
            take: 3,
          },
          riskAlerts: {
            where: {
              status: AlertStatus.OPEN,
            },
            orderBy: {
              createdAt: 'desc',
            },
            take: 3,
          },
          tasks: {
            where: {
              status: TaskStatus.PENDING,
            },
            orderBy: {
              dueAt: 'asc',
            },
            take: 3,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),

      this.prisma.task.findMany({
        where: {
          assigneeId: nurseId,
          status: TaskStatus.PENDING,
        },
        include: {
          patient: true,
        },
        orderBy: [
          {
            dueAt: 'asc',
          },
          {
            createdAt: 'desc',
          },
        ],
      }),

      this.prisma.task.findMany({
        where: {
          assigneeId: nurseId,
          status: TaskStatus.PENDING,
          dueAt: {
            gte: todayStart,
            lte: todayEnd,
          },
        },
        include: {
          patient: true,
        },
        orderBy: {
          dueAt: 'asc',
        },
      }),

      this.prisma.task.findMany({
        where: {
          assigneeId: nurseId,
          status: TaskStatus.PENDING,
          dueAt: {
            lt: todayStart,
          },
        },
        include: {
          patient: true,
        },
        orderBy: {
          dueAt: 'asc',
        },
      }),

      this.prisma.riskAlert.findMany({
        where: {
          status: AlertStatus.OPEN,
          patient: {
            responsibleNurseId: nurseId,
          },
        },
        include: {
          patient: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),

      this.prisma.vitalRecord.findMany({
        where: {
          isAbnormal: true,
          patient: {
            responsibleNurseId: nurseId,
          },
        },
        include: {
          patient: true,
        },
        orderBy: {
          measuredAt: 'desc',
        },
        take: 10,
      }),

      this.prisma.task.count({
        where: {
          assigneeId: nurseId,
          status: TaskStatus.DONE,
        },
      }),
    ]);

    return {
      nurseId,
      summary: {
        patientCount: myPatients.length,
        pendingTaskCount: pendingTasks.length,
        todayTaskCount: todayTasks.length,
        overdueTaskCount: overdueTasks.length,
        openRiskAlertCount: openRiskAlerts.length,
        recentAbnormalVitalCount: recentAbnormalVitals.length,
        completedTaskCount: completedTasksCount,
      },
      myPatients,
      pendingTasks,
      todayTasks,
      overdueTasks,
      openRiskAlerts,
      recentAbnormalVitals,
    };
  }
}
