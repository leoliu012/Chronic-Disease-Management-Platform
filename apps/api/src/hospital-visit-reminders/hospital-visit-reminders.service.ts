import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AlertStatus, HospitalVisitReminderStatus, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../security/audit.service';
import type { RequestUser } from '../security/request-user.type';
import { CreateHospitalVisitReminderDto } from './dto/create-hospital-visit-reminder.dto';
import { UpdateHospitalVisitReminderDto } from './dto/update-hospital-visit-reminder.dto';

const HOSPITAL_VISIT_TASK_TYPE = 'HOSPITAL_VISIT_FOLLOW_UP';
const CLOSED_ALERT_STATUSES: AlertStatus[] = [AlertStatus.RESOLVED, AlertStatus.DISMISSED];

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

  private getReminderTaskWhere(reminder: {
    patientId: string;
    sourceRiskAlertId?: string | null;
  }): Prisma.TaskWhereInput {
    return {
      patientId: reminder.patientId,
      type: HOSPITAL_VISIT_TASK_TYPE,
      status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
      relatedAlertId: reminder.sourceRiskAlertId ?? null,
    };
  }

  private async findOpenReminderTask(reminder: {
    patientId: string;
    sourceRiskAlertId?: string | null;
  }) {
    return this.prisma.task.findFirst({
      where: this.getReminderTaskWhere(reminder),
      orderBy: { createdAt: 'desc' },
    });
  }

  private async ensureHospitalVisitTask(
    reminder: {
      id: string;
      patientId: string;
      sourceRiskAlertId?: string | null;
      reason: string;
      remindedAt: Date;
      remindedBy?: string | null;
      patient?: { responsibleNurseId?: string | null } | null;
    },
    user?: RequestUser,
  ) {
    const existingTask = await this.findOpenReminderTask(reminder);
    if (existingTask) return existingTask;

    const dueAt = new Date(reminder.remindedAt);
    dueAt.setHours(dueAt.getHours() + 48);

    const relatedAlert = reminder.sourceRiskAlertId
      ? await this.prisma.riskAlert.findUnique({
          where: { id: reminder.sourceRiskAlertId },
          select: { title: true, status: true },
        })
      : null;

    if (relatedAlert && CLOSED_ALERT_STATUSES.includes(relatedAlert.status)) {
      return null;
    }

    return this.prisma.task.create({
      data: {
        patientId: reminder.patientId,
        // 任务标题以风险预警标题为准；“到院提醒”是处理动作/流程节点，不写进标题。
        title: relatedAlert?.title ?? '到院提醒处理',
        type: HOSPITAL_VISIT_TASK_TYPE,
        dueAt,
        assigneeId: reminder.patient?.responsibleNurseId ?? reminder.remindedBy ?? user?.id,
        relatedAlertId: reminder.sourceRiskAlertId ?? undefined,
      },
    });
  }

  private async ensureActiveReminderTasks<
    T extends {
      id: string;
      patientId: string;
      sourceRiskAlertId?: string | null;
      reason: string;
      remindedAt: Date;
      remindedBy?: string | null;
      status: HospitalVisitReminderStatus;
      patient?: { responsibleNurseId?: string | null } | null;
    },
  >(reminders: T[], user?: RequestUser) {
    await Promise.all(
      reminders
        .filter((reminder) => reminder.status === HospitalVisitReminderStatus.ACTIVE)
        .map((reminder) => this.ensureHospitalVisitTask(reminder, user)),
    );
  }

  private async attachRelatedTask<
    T extends { patientId: string; sourceRiskAlertId?: string | null },
  >(reminder: T) {
    const task = await this.findOpenReminderTask(reminder);
    return {
      ...reminder,
      relatedTaskId: task?.id ?? null,
      relatedTaskStatus: task?.status ?? null,
      relatedTaskType: task?.type ?? null,
    };
  }

  private async attachRelatedTasks<
    T extends { patientId: string; sourceRiskAlertId?: string | null },
  >(reminders: T[]) {
    return Promise.all(reminders.map((reminder) => this.attachRelatedTask(reminder)));
  }

  async findAll(status?: HospitalVisitReminderStatus) {
    const reminders = await this.prisma.hospitalVisitReminder.findMany({
      where: status ? { status } : undefined,
      include: this.includePatient,
      orderBy: [{ status: 'asc' }, { remindedAt: 'desc' }],
    });

    await this.ensureActiveReminderTasks(reminders);

    return this.attachRelatedTasks(reminders);
  }

  async findActiveByPatient(patientId: string) {
    const reminders = await this.prisma.hospitalVisitReminder.findMany({
      where: {
        patientId,
        status: HospitalVisitReminderStatus.ACTIVE,
      },
      include: this.includePatient,
      orderBy: { remindedAt: 'desc' },
    });

    await this.ensureActiveReminderTasks(reminders);

    return this.attachRelatedTasks(reminders);
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
      throw new BadRequestException('该患者当前已有有效到院提醒，请先登记到院、未到院、拒绝到院或撤销现有提醒后再新建。');
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

    const task = await this.ensureHospitalVisitTask(reminder, user);
    const reminderWithTask = await this.attachRelatedTask(reminder);

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
        generatedTaskId: task?.id ?? null,
        generatedTaskType: HOSPITAL_VISIT_TASK_TYPE,
      },
    });

    return {
      reminder: reminderWithTask,
      task,
      message: task ? '已向患者端发送醒目到院提醒，并自动生成到院提醒任务。' : '已向患者端发送醒目到院提醒；关联预警已处理，未再生成新的到院提醒任务。',
    };
  }

  private async updateRelatedTaskStatus(
    reminder: { patientId: string; sourceRiskAlertId?: string | null },
    status: TaskStatus,
  ) {
    await this.prisma.task.updateMany({
      where: this.getReminderTaskWhere(reminder),
      data: { status },
    });
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedReminder = await tx.hospitalVisitReminder.update({
        where: { id },
        data: baseData,
        include: this.includePatient,
      });

      await tx.task.updateMany({
        where: this.getReminderTaskWhere(reminder),
        data: {
          status:
            status === HospitalVisitReminderStatus.REVOKED
              ? TaskStatus.CANCELED
              : TaskStatus.DONE,
        },
      });

      return updatedReminder;
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
        syncedTaskType: HOSPITAL_VISIT_TASK_TYPE,
      },
    });

    return this.attachRelatedTask(updated);
  }

  async remindAgain(
    id: string,
    dto: UpdateHospitalVisitReminderDto,
    user: RequestUser,
    ipAddress?: string,
  ) {
    const reminder = await this.prisma.hospitalVisitReminder.findUnique({
      where: { id },
      include: this.includePatient,
    });
    if (!reminder) throw new NotFoundException('Hospital visit reminder not found');

    if (reminder.status !== HospitalVisitReminderStatus.ACTIVE) {
      throw new BadRequestException('该到院提醒已经结束，不能再次提醒');
    }

    const task = await this.ensureHospitalVisitTask(reminder, user);
    await this.updateRelatedTaskStatus(reminder, TaskStatus.IN_PROGRESS);

    const updated = await this.prisma.hospitalVisitReminder.update({
      where: { id },
      data: {
        remindedAt: new Date(),
        remindedBy: user.id,
        note: dto.note || reminder.note,
      },
      include: this.includePatient,
    });

    await this.auditService.record({
      user,
      action: 'HOSPITAL_VISIT_REMINDER_SENT_AGAIN',
      targetType: 'HospitalVisitReminder',
      targetId: id,
      ipAddress,
      beforeData: reminder,
      afterData: {
        note: dto.note,
        electronicSignature: dto.electronicSignature,
        taskId: task?.id ?? null,
        message: '护士在到院提醒任务中再次通知患者建议门诊复诊/到院评估。',
      },
    });

    return this.attachRelatedTask(updated);
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




