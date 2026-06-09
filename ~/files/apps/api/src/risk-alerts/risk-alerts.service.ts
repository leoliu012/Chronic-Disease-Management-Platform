import { Injectable, NotFoundException } from '@nestjs/common';
import { AlertStatus, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRiskAlertDto } from './dto/create-risk-alert.dto';
import { HandleRiskAlertDto } from './dto/handle-risk-alert.dto';
import { QueryRiskAlertsDto } from './dto/query-risk-alerts.dto';
import { ClinicalAccessScopeService } from '../security/clinical-access-scope.service';
import type { RequestUser } from '../security/request-user.type';

const HOSPITAL_VISIT_TASK_TYPE = 'HOSPITAL_VISIT_FOLLOW_UP';

@Injectable()
export class RiskAlertsService {
  constructor(private readonly prisma: PrismaService, private readonly access: ClinicalAccessScopeService) {}

  async create(patientId: string, dto: CreateRiskAlertDto) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }
    if (dto.sourceVitalRecordId) {
      const vital = await this.prisma.vitalRecord.findUnique({ where: { id: dto.sourceVitalRecordId } });
      if (!vital || vital.patientId !== patientId) {
        throw new NotFoundException('Source vital record not found for this patient');
      }
    }

    return this.prisma.riskAlert.create({
      data: {
        patientId,
        riskType: dto.riskType,
        riskLevel: dto.riskLevel,
        title: dto.title,
        description: dto.description,
        triggerRule: dto.triggerRule,
        sourceVitalRecordId: dto.sourceVitalRecordId,
      },
    });
  }

  async findAll(query: QueryRiskAlertsDto, user: RequestUser) {
    const accessScope = await this.access.buildAlertScope(user, query.hospitalTenantId);
    return this.prisma.riskAlert.findMany({
      where: {
        AND: [
          accessScope,
          {
            status: query.status,
            riskLevel: query.riskLevel,
            riskType: query.riskType,
          },
        ],
      },
      include: { patient: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByPatient(patientId: string, query: QueryRiskAlertsDto) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    return this.prisma.riskAlert.findMany({
      where: {
        patientId,
        status: query.status,
        riskLevel: query.riskLevel,
        riskType: query.riskType,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const alert = await this.prisma.riskAlert.findUnique({
      where: { id },
      include: {
        patient: true,
      },
    });

    if (!alert) {
      throw new NotFoundException('Risk alert not found');
    }

    return alert;
  }

  async markInProgress(id: string, dto: HandleRiskAlertDto) {
    await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      const alert = await tx.riskAlert.update({
        where: { id },
        data: {
          status: AlertStatus.IN_PROGRESS,
          handledBy: dto.handledBy,
          handlingNote: dto.handlingNote,
        },
      });

      await tx.task.updateMany({
        where: {
          relatedAlertId: id,
          status: TaskStatus.PENDING,
        },
        data: {
          status: TaskStatus.IN_PROGRESS,
        },
      });

      return alert;
    });
  }

  async resolve(id: string, dto: HandleRiskAlertDto) {
    await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      const alert = await tx.riskAlert.update({
        where: { id },
        data: {
          status: AlertStatus.RESOLVED,
          handledBy: dto.handledBy,
          handledAt: new Date(),
          handlingNote: dto.handlingNote,
        },
      });

      if (dto.syncRelatedTasks === true) {
        await tx.task.updateMany({
          where: {
            relatedAlertId: id,
            type: { not: HOSPITAL_VISIT_TASK_TYPE },
            status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
          },
          data: {
            status: TaskStatus.DONE,
          },
        });
      }

      return alert;
    });
  }

  async dismiss(id: string, dto: HandleRiskAlertDto) {
    await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      const alert = await tx.riskAlert.update({
        where: { id },
        data: {
          status: AlertStatus.DISMISSED,
          handledBy: dto.handledBy,
          handledAt: new Date(),
          handlingNote: dto.handlingNote,
        },
      });

      if (dto.syncRelatedTasks === true) {
        await tx.task.updateMany({
          where: {
            relatedAlertId: id,
            type: { not: HOSPITAL_VISIT_TASK_TYPE },
            status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
          },
          data: {
            status: TaskStatus.CANCELED,
          },
        });
      }

      return alert;
    });
  }
}








