import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HospitalVisitReminderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../security/audit.service';
import type { RequestUser } from '../security/request-user.type';
import { CreateHospitalVisitReminderDto } from './dto/create-hospital-visit-reminder.dto';
import { UpdateHospitalVisitReminderDto } from './dto/update-hospital-visit-reminder.dto';

@Injectable()
export class HospitalVisitRemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private readonly includePatient = {
    patient: {
      select: {
        id: true,
        name: true,
        hospitalPatientId: true,
        phone: true,
        address: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        responsibleDoctorId: true,
        responsibleNurseId: true,
      },
    },
  } satisfies Prisma.HospitalVisitReminderInclude;

  async findAll(status?: HospitalVisitReminderStatus) {
    return this.prisma.hospitalVisitReminder.findMany({
      where: status ? { status } : undefined,
      include: this.includePatient,
      orderBy: [{ status: 'asc' }, { remindedAt: 'desc' }],
    });
  }

  async findActiveByPatient(patientId: string) {
    return this.prisma.hospitalVisitReminder.findMany({
      where: {
        patientId,
        status: HospitalVisitReminderStatus.ACTIVE,
      },
      include: this.includePatient,
      orderBy: { remindedAt: 'desc' },
    });
  }

  async create(
    patientId: string,
    dto: CreateHospitalVisitReminderDto,
    user: RequestUser,
    ipAddress?: string,
  ) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient not found');

    const reason = String(dto.reason ?? '').trim();
    const electronicSignature = String(dto.electronicSignature ?? '').trim();

    if (!reason) {
      throw new BadRequestException('请填写到院提醒原因');
    }

    if (!electronicSignature) {
      throw new BadRequestException('请填写电子签名后再发送到院提醒');
    }

    const existingActive = await this.prisma.hospitalVisitReminder.findFirst({
      where: {
        patientId,
        status: HospitalVisitReminderStatus.ACTIVE,
      },
      include: this.includePatient,
      orderBy: { remindedAt: 'desc' },
    });

    if (existingActive) {
      return {
        reminder: existingActive,
        message: '该患者当前已有有效到院提醒，未重复发送。',
      };
    }

    const reminder = await this.prisma.hospitalVisitReminder.create({
      data: {
        patientId,
        sourceRiskAlertId: dto.sourceRiskAlertId,
        reason,
        note: dto.note,
        remindedBy: user.id,
        status: HospitalVisitReminderStatus.ACTIVE,
      },
      include: this.includePatient,
    });

    await this.auditService.record({
      user,
      action: 'HOSPITAL_VISIT_REMINDER_CREATED',
      targetType: 'HospitalVisitReminder',
      targetId: reminder.id,
      ipAddress,
      afterData: {
        patientId,
        sourceRiskAlertId: dto.sourceRiskAlertId,
        reason,
        note: dto.note,
        electronicSignature,
      },
    });

    return {
      reminder,
      message: '已向患者端发送醒目到院提醒，并在护士工作台生成到院提醒横幅。',
    };
  }

  private async updateStatus(
    id: string,
    status: HospitalVisitReminderStatus,
    dto: UpdateHospitalVisitReminderDto,
    user: RequestUser,
    ipAddress?: string,
  ) {
    const reminder = await this.prisma.hospitalVisitReminder.findUnique({ where: { id } });
    if (!reminder) throw new NotFoundException('Hospital visit reminder not found');

    if (reminder.status !== HospitalVisitReminderStatus.ACTIVE) {
      throw new BadRequestException('该到院提醒已经结束，不能重复处理');
    }

    const now = new Date();
    const baseData: Prisma.HospitalVisitReminderUpdateInput = {
      status,
      outcomeNote: dto.note,
    };

    if (status === HospitalVisitReminderStatus.ARRIVED) {
      baseData.arrivedAt = now;
      baseData.arrivalConfirmedBy = user.id;
    }

    if (status === HospitalVisitReminderStatus.NO_SHOW) {
      baseData.noShowAt = now;
      baseData.noShowConfirmedBy = user.id;
    }

    if (status === HospitalVisitReminderStatus.REFUSED) {
      baseData.refusedAt = now;
      baseData.refusalConfirmedBy = user.id;
    }

    if (status === HospitalVisitReminderStatus.REVOKED) {
      baseData.revokedAt = now;
      baseData.revokedBy = user.id;
      baseData.revokeReason = dto.note;
    }

    const updated = await this.prisma.hospitalVisitReminder.update({
      where: { id },
      data: baseData,
      include: this.includePatient,
    });

    await this.auditService.record({
      user,
      action: `HOSPITAL_VISIT_REMINDER_${status}`,
      targetType: 'HospitalVisitReminder',
      targetId: id,
      ipAddress,
      beforeData: reminder,
      afterData: {
        status,
        note: dto.note,
        electronicSignature: dto.electronicSignature,
      },
    });

    return updated;
  }

  markArrived(id: string, dto: UpdateHospitalVisitReminderDto, user: RequestUser, ipAddress?: string) {
    return this.updateStatus(id, HospitalVisitReminderStatus.ARRIVED, dto, user, ipAddress);
  }

  markNoShow(id: string, dto: UpdateHospitalVisitReminderDto, user: RequestUser, ipAddress?: string) {
    return this.updateStatus(id, HospitalVisitReminderStatus.NO_SHOW, dto, user, ipAddress);
  }

  markRefused(id: string, dto: UpdateHospitalVisitReminderDto, user: RequestUser, ipAddress?: string) {
    return this.updateStatus(id, HospitalVisitReminderStatus.REFUSED, dto, user, ipAddress);
  }

  revoke(id: string, dto: UpdateHospitalVisitReminderDto, user: RequestUser, ipAddress?: string) {
    return this.updateStatus(id, HospitalVisitReminderStatus.REVOKED, dto, user, ipAddress);
  }
}
