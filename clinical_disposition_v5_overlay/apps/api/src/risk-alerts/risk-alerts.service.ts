import { Injectable, NotFoundException } from '@nestjs/common';
import { AlertStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRiskAlertDto } from './dto/create-risk-alert.dto';
import { HandleRiskAlertDto } from './dto/handle-risk-alert.dto';
import { QueryRiskAlertsDto } from './dto/query-risk-alerts.dto';
import { ClinicalAccessScopeService } from '../security/clinical-access-scope.service';
import { ClinicalDispositionService } from '../clinical-disposition/clinical-disposition.service';
import type { RequestUser } from '../security/request-user.type';

@Injectable()
export class RiskAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClinicalAccessScopeService,
    private readonly disposition: ClinicalDispositionService,
  ) {}

  async create(patientId: string, dto: CreateRiskAlertDto) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient not found');
    if (dto.sourceVitalRecordId) {
      const vital = await this.prisma.vitalRecord.findUnique({ where: { id: dto.sourceVitalRecordId } });
      if (!vital || vital.patientId !== patientId) {
        throw new NotFoundException('Source vital record not found for this patient');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await this.disposition.signalRisk(tx, {
        patientId,
        riskCategory: dto.riskType,
        correlationKey: `MANUAL:${dto.riskType}:${dto.triggerRule ?? dto.title}`,
        riskLevel: dto.riskLevel,
        title: dto.title,
        description: dto.description,
        triggerRule: dto.triggerRule,
        sourceVitalRecordId: dto.sourceVitalRecordId,
        evidence: { sourceType: 'ManualRiskAlert', sourceVitalRecordId: dto.sourceVitalRecordId ?? null },
        createTask: false,
      });
      return result.alert;
    });
  }

  async findAll(query: QueryRiskAlertsDto, user: RequestUser) {
    const accessScope = await this.access.buildAlertScope(user, query.hospitalTenantId);
    return this.prisma.riskAlert.findMany({
      where: {
        AND: [
          accessScope,
          { status: query.status, riskLevel: query.riskLevel, riskType: query.riskType },
        ],
      },
      include: { patient: true, riskEpisode: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByPatient(patientId: string, query: QueryRiskAlertsDto) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient not found');
    return this.prisma.riskAlert.findMany({
      where: { patientId, status: query.status, riskLevel: query.riskLevel, riskType: query.riskType },
      include: { riskEpisode: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const alert = await this.prisma.riskAlert.findUnique({
      where: { id },
      include: { patient: true, riskEpisode: true },
    });
    if (!alert) throw new NotFoundException('Risk alert not found');
    return alert;
  }

  async markInProgress(id: string, dto: HandleRiskAlertDto, user: RequestUser) {
    return this.prisma.$transaction((tx) =>
      this.disposition.markAlertInProgress(tx, id, user.id, dto.handlingNote),
    );
  }

  async resolve(id: string, dto: HandleRiskAlertDto, user: RequestUser) {
    return this.prisma.$transaction((tx) =>
      this.disposition.closeByAlert(tx, id, AlertStatus.RESOLVED, user.id, dto.handlingNote),
    );
  }

  async dismiss(id: string, dto: HandleRiskAlertDto, user: RequestUser) {
    return this.prisma.$transaction((tx) =>
      this.disposition.closeByAlert(tx, id, AlertStatus.DISMISSED, user.id, dto.handlingNote),
    );
  }
}
