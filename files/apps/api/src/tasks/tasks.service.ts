import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AlertStatus, HospitalVisitReminderStatus, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { CreateTaskProcessingEventDto } from './dto/create-task-processing-event.dto';
import { StartTaskProcessingDto } from './dto/start-task-processing.dto';
import { ClinicalAccessScopeService } from '../security/clinical-access-scope.service';
import type { RequestUser } from '../security/request-user.type';
import { CompleteTaskProcessingDto } from './dto/complete-task-processing.dto';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService, private readonly access: ClinicalAccessScopeService) {}

  private async createProcessingEvent(
    taskId: string,
    dto: CreateTaskProcessingEventDto,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const task = await tx.task.findUnique({ where: { id: taskId } });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return tx.taskProcessingEvent.create({
      data: {
        taskId,
        patientId: task.patientId,
        eventType: dto.eventType,
        title: dto.title,
        description: dto.description,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
        operatorId: dto.operatorId,
        electronicSignature: dto.electronicSignature,
      },
    });
  }

  async listProcessingEvents(taskId: string) {
    const task = await this.findOne(taskId);

    const relatedTaskIds = task.relatedAlertId
      ? (await this.prisma.task.findMany({
          where: { patientId: task.patientId, relatedAlertId: task.relatedAlertId },
          select: { id: true },
        })).map((item) => item.id)
      : [taskId];

    return this.prisma.taskProcessingEvent.findMany({
      where: { taskId: { in: relatedTaskIds.length ? relatedTaskIds : [taskId] } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async recordProcessingEvent(taskId: string, dto: CreateTaskProcessingEventDto) {
    return this.createProcessingEvent(taskId, dto);
  }

  async startProcessing(taskId: string, dto: StartTaskProcessingDto) {
    const existingTask = await this.findOne(taskId);

    if (existingTask.status === TaskStatus.DONE || existingTask.status === TaskStatus.CANCELED) {
      throw new BadRequestException('Closed task cannot be started again');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedTask = existingTask.status === TaskStatus.PENDING
        ? await tx.task.update({
            where: { id: taskId },
            data: { status: TaskStatus.IN_PROGRESS },
          })
        : existingTask;

      const existingStartEvent = await tx.taskProcessingEvent.findFirst({
        where: { taskId, eventType: 'START_PROCESSING' },
        orderBy: { createdAt: 'asc' },
      });

      if (!existingStartEvent) {
        await this.createProcessingEvent(
          taskId,
          {
            eventType: 'START_PROCESSING',
            title: '开始处理',
            description: dto.note || '医护已开始处理该待办，后续患者档案内操作将自动归入本次处理流程。',
            operatorId: dto.operatorId,
            electronicSignature: dto.electronicSignature,
          },
          tx,
        );
      }

      return updatedTask;
    });
  }

  async completeProcessing(taskId: string, dto: CompleteTaskProcessingDto) {
    const existingTask = await this.findOne(taskId);

    if (existingTask.status === TaskStatus.DONE || existingTask.status === TaskStatus.CANCELED) {
      throw new BadRequestException('Task is already closed');
    }

    const finalStatus = dto.status === TaskStatus.CANCELED ? TaskStatus.CANCELED : TaskStatus.DONE;
    const relatedAlertHandlingNote = [
      `任务处理总结：${dto.summary}`,
      `电子签名：${dto.electronicSignature}`,
    ].join('；');

    return this.prisma.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: { status: finalStatus },
      });

      if (existingTask.relatedAlertId) {
        await tx.task.updateMany({
          where: {
            patientId: existingTask.patientId,
            relatedAlertId: existingTask.relatedAlertId,
            status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
            id: { not: taskId },
          },
          data: { status: finalStatus },
        });
      }

      await this.createProcessingEvent(
        taskId,
        {
          eventType: finalStatus === TaskStatus.DONE ? 'COMPLETE_PROCESSING' : 'CANCEL_PROCESSING',
          title: finalStatus === TaskStatus.DONE ? '处理完成' : '取消/误报结案',
          description: dto.summary,
          operatorId: dto.operatorId,
          electronicSignature: dto.electronicSignature,
        },
        tx,
      );

      if (existingTask.relatedAlertId && dto.syncRelatedAlert === true) {
        await tx.riskAlert.update({
          where: { id: existingTask.relatedAlertId },
          data: {
            status: finalStatus === TaskStatus.DONE ? AlertStatus.RESOLVED : AlertStatus.DISMISSED,
            handledAt: new Date(),
            handledBy: existingTask.assigneeId,
            handlingNote: relatedAlertHandlingNote,
          },
        });

        await tx.hospitalVisitReminder.updateMany({
          where: {
            patientId: existingTask.patientId,
            sourceRiskAlertId: existingTask.relatedAlertId,
            status: HospitalVisitReminderStatus.ACTIVE,
          },
          data: {
            status: HospitalVisitReminderStatus.REVOKED,
            revokedAt: new Date(),
            revokedBy: existingTask.assigneeId,
            revokeReason: '关联风险预警已完成处置，自动关闭仍处于有效状态的到院提醒。',
          },
        });
      }

      return updatedTask;
    });
  }

  async create(patientId: string, dto: CreateTaskDto, user: RequestUser) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    if (dto.relatedAlertId) {
      const relatedAlert = await this.prisma.riskAlert.findUnique({ where: { id: dto.relatedAlertId } });
      if (!relatedAlert || relatedAlert.patientId !== patientId) {
        throw new NotFoundException('Related risk alert not found for this patient');
      }
      const existingOpenTask = await this.prisma.task.findFirst({
        where: {
          relatedAlertId: dto.relatedAlertId,
          type: dto.type,
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        },
        include: { patient: true },
      });

      if (existingOpenTask) {
        return existingOpenTask;
      }
    }

    const assigneeId = await this.access.resolveTaskAssignee(user, patientId, dto.assigneeId);
    return this.prisma.task.create({
      data: {
        patientId,
        title: dto.title,
        type: dto.type,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        assigneeId,
        relatedAlertId: dto.relatedAlertId,
      },
    });
  }

  async findAll(query: QueryTasksDto, user: RequestUser) {
    const accessScope = await this.access.buildTaskScope(user, query.hospitalTenantId);
    return this.prisma.task.findMany({
      where: { AND: [accessScope, { status: query.status, type: query.type }] },
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
    });
  }

  async findByPatient(patientId: string, query: QueryTasksDto) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    return this.prisma.task.findMany({
      where: {
        patientId,
        status: query.status,
        type: query.type,
        assigneeId: query.assigneeId,
      },
      orderBy: [
        {
          dueAt: 'asc',
        },
        {
          createdAt: 'desc',
        },
      ],
    });
  }

  async findOne(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        patient: {
          include: {
            responsibleDoctor: true,
            responsibleNurse: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }

  async updateStatus(id: string, dto: UpdateTaskStatusDto) {
    const existingTask = await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          status: dto.status,
        },
      });

      if (existingTask.relatedAlertId && dto.syncRelatedAlert === true) {
        if (dto.status === TaskStatus.DONE) {
          await tx.riskAlert.update({
            where: { id: existingTask.relatedAlertId },
            data: {
              status: AlertStatus.RESOLVED,
              handledAt: new Date(),
              handledBy: existingTask.assigneeId,
              handlingNote:
                dto.relatedAlertHandlingNote ||
                '关联待办任务已完成，经护士确认同步标记该风险预警为已处理。',
            },
          });
        }

        if (dto.status === TaskStatus.CANCELED) {
          await tx.riskAlert.update({
            where: { id: existingTask.relatedAlertId },
            data: {
              status: AlertStatus.DISMISSED,
              handledAt: new Date(),
              handledBy: existingTask.assigneeId,
              handlingNote:
                dto.relatedAlertHandlingNote ||
                '关联待办任务已取消，经护士确认同步标记该风险预警为忽略/误报。',
            },
          });
        }
      }

      return updatedTask;
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.task.delete({
      where: { id },
    });
  }

  async getClinicalContext(taskId: string, trendDays: number = 7, historyLimit: number = 5) {
    const task = await this.findOne(taskId);
    const patientId = task.patientId;

    // Get patient with disease profiles
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      include: {
        diseaseProfiles: true,
        responsibleDoctor: true,
        responsibleNurse: true,
      },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    // Calculate age
    const age = patient.birthDate
      ? Math.floor((Date.now() - new Date(patient.birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      : 0;

    // Get disease labels
    const diseaseLabelMap: Record<string, string> = {
      HYPERTENSION: '高血压',
      TYPE_2_DIABETES: '2型糖尿病',
      COPD: '慢阻肺',
      CORONARY_HEART_DISEASE: '冠心病',
      HYPERLIPIDEMIA: '高脂血症',
      OBESITY: '肥胖',
    };

    const diseases = patient.diseaseProfiles.map(
      (d) => diseaseLabelMap[d.diseaseType] || d.diseaseType,
    );

    // Determine highest risk level
    const riskLevels = patient.diseaseProfiles.map((d) => d.riskLevel);
    const riskLevel = riskLevels.includes('VERY_HIGH')
      ? 'VERY_HIGH'
      : riskLevels.includes('HIGH')
      ? 'HIGH'
      : riskLevels.includes('MEDIUM')
      ? 'MEDIUM'
      : 'LOW';

    // Determine task-relevant vital types based on task type
    let vitalTypes: string[] = [];
    let vitalType: string | undefined;
    if (task.type.includes('BLOOD_PRESSURE') || task.type.includes('HYPERTENSION')) {
      vitalTypes = ['SYSTOLIC_BP', 'DIASTOLIC_BP'];
      vitalType = 'SYSTOLIC_BP';
    } else if (task.type.includes('GLUCOSE') || task.type.includes('DIABETES')) {
      vitalTypes = ['BLOOD_GLUCOSE'];
      vitalType = 'BLOOD_GLUCOSE';
    } else if (task.type.includes('SPO2') || task.type.includes('OXYGEN')) {
      vitalTypes = ['SPO2'];
      vitalType = 'SPO2';
    } else if (task.type.includes('HEART_RATE')) {
      vitalTypes = ['HEART_RATE'];
      vitalType = 'HEART_RATE';
    }

    // Get recent vitals for trend
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - trendDays);

    const recentVitals = vitalTypes.length > 0
      ? await this.prisma.vitalRecord.findMany({
          where: {
            patientId,
            type: { in: vitalTypes },
            measuredAt: { gte: cutoffDate },
          },
          orderBy: { measuredAt: 'asc' },
        })
      : [];

    // Calculate trend direction
    let trendDirection: 'RISING' | 'FALLING' | 'STABLE' | 'FLUCTUATING' = 'STABLE';
    if (recentVitals.length >= 3) {
      const values = recentVitals.map((v) => v.value);
      const firstHalf = values.slice(0, Math.floor(values.length / 2));
      const secondHalf = values.slice(Math.floor(values.length / 2));
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      const change = ((secondAvg - firstAvg) / firstAvg) * 100;

      if (change > 10) trendDirection = 'RISING';
      else if (change < -10) trendDirection = 'FALLING';
      else if (Math.max(...values) - Math.min(...values) > firstAvg * 0.2) trendDirection = 'FLUCTUATING';
    }

    const abnormalCount = recentVitals.filter((v) => v.isAbnormal).length;
    const latestVital = recentVitals[recentVitals.length - 1];
    const latestValue = latestVital ? `${latestVital.value} ${latestVital.unit}` : undefined;

    // Convert vitals to timeline event format for frontend mini charts
    const recentTrend = recentVitals.map((v) => ({
      time: v.measuredAt.toISOString(),
      data: { value: v.value, unit: v.unit, type: v.type },
    }));

    // For blood pressure tasks, separate systolic and diastolic trends
    const systolicTrend = vitalTypes.includes('SYSTOLIC_BP')
      ? recentTrend.filter((v) => v.data.type === 'SYSTOLIC_BP')
      : undefined;
    const diastolicTrend = vitalTypes.includes('DIASTOLIC_BP')
      ? recentTrend.filter((v) => v.data.type === 'DIASTOLIC_BP')
      : undefined;

    // Get recent history (alerts, follow-ups, encounters)
    const [recentAlerts, recentFollowUps, recentEncounters] = await Promise.all([
      this.prisma.riskAlert.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: historyLimit,
      }),
      this.prisma.followUpRecord.findMany({
        where: { patientId },
        orderBy: { followUpTime: 'desc' },
        take: historyLimit,
      }),
      this.prisma.encounterRecord.findMany({
        where: { patientId },
        orderBy: { visitTime: 'desc' },
        take: historyLimit,
      }),
    ]);

    const recentHistory = [
      ...recentAlerts.map((a) => ({
        date: a.createdAt.toISOString(),
        type: '风险预警',
        description: a.title,
      })),
      ...recentFollowUps.map((f) => ({
        date: f.followUpTime.toISOString(),
        type: '随访记录',
        description: f.result || f.content || '随访完成',
      })),
      ...recentEncounters.map((e) => ({
        date: e.visitTime.toISOString(),
        type: '就诊记录',
        description: `${e.departmentName || ''}${e.diagnosisSummary ? '：' + e.diagnosisSummary : ''}`,
      })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, historyLimit);

    // Get current medications with adherence
    const activeMedications = await this.prisma.medicationRecord.findMany({
      where: {
        patientId,
        isActive: true,
      },
      include: {
        checkIns: {
          where: {
            checkedAt: { gte: cutoffDate },
          },
          orderBy: { checkedAt: 'desc' },
        },
      },
      take: 3,
    });

    const currentMedications = activeMedications.map((med) => {
      const totalDays = trendDays;
      const takenDays = med.checkIns.filter((c) => c.taken).length;
      const lastMissed = med.checkIns.find((c) => !c.taken);

      return {
        name: med.medicationName,
        dosage: med.dosage,
        adherence: {
          taken: takenDays,
          total: totalDays,
        },
        lastMissed: lastMissed?.checkedAt.toISOString(),
      };
    });

    return {
      patientSummary: {
        name: patient.name,
        gender: patient.gender,
        age,
        diseases,
        riskLevel,
        responsibleDoctor: patient.responsibleDoctor?.displayName,
        responsibleNurse: patient.responsibleNurse?.displayName,
      },
      taskRelevantData: {
        vitalType,
        recentTrend: vitalTypes.length === 1 ? recentTrend : undefined,
        systolicTrend,
        diastolicTrend,
        latestValue,
        abnormalCount,
        trendDirection,
      },
      recentHistory,
      currentMedications,
    };
  }
}












