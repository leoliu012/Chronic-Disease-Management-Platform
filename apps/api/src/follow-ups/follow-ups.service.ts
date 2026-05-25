
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';
import { UpdateNextFollowUpDto } from './dto/update-next-follow-up.dto';
import type { RequestUser } from '../security/request-user.type';

export type FollowUpListQuery = {
  skip?: string;
  take?: string;
  followUpType?: string;
  createdFrom?: string;
  createdTo?: string;
  followUpFrom?: string;
  followUpTo?: string;
  sortBy?: 'createdAt' | 'followUpTime';
  sortOrder?: 'asc' | 'desc';
};

function parsePositiveInt(value: string | undefined, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

type DbClient = Prisma.TransactionClient | PrismaService;

/**
 * The lead time before a scheduled phone follow-up at which we automatically
 * generate a "电话随访" task on the work queue. Per product spec: 2 days.
 */
const REMINDER_LEAD_TIME_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Task fields used for the phone follow-up reminder.
 *
 * Title is intentionally just "电话随访" (per spec — the same convention as risk-alert
 * derived tasks, where the task title reflects the trigger name).
 */
const PHONE_FOLLOW_UP_TASK_TYPE = 'PHONE_FOLLOW_UP_SCHEDULED';
const PHONE_FOLLOW_UP_TASK_TITLE = '电话随访';

const OPEN_TASK_STATUSES: TaskStatus[] = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];

@Injectable()
export class FollowUpsService {
  constructor(private readonly prisma: PrismaService) {}

  // ----- helpers -----

  /**
   * phone-follow-up-dedupe-v2: serialize all phone-follow-up task mutations for a
   * single patient using a transaction-scoped Postgres advisory lock.
   *
   * Root cause of the "两个一样的计划电话随访任务" bug: opening the follow-up tab
   * fires `loadFollowUpHistory` and `loadActiveNextFollowUp` at the same time, and
   * both endpoints independently run `syncPhoneFollowUpScheduledTask`. With no lock
   * both transactions read "no open task" and both create one -> two duplicates.
   *
   * `pg_advisory_xact_lock` releases automatically when the transaction ends, so the
   * two syncs run one-after-another and the dedupe logic always sees a consistent
   * view. Wrapped defensively so a non-Postgres engine (e.g. tests) cannot break the
   * main flow.
   */
  private async lockPatientFollowUp(patientId: string, client: DbClient) {
    try {
      // pg_advisory_xact_lock() 返回 void —— Prisma 6.x 无法反序列化 void 列，
      // 直接 SELECT 会抛 P2010。用 `IS NOT NULL` 把结果转成 boolean 列即可正常返回。
      await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${patientId}, 0)) IS NOT NULL AS locked`;
    } catch (err) {
      console.warn('Advisory lock for phone follow-up sync unavailable.', err);
    }
  }

  private async assertPatient(patientId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  /**
   * The currently active scheduled next follow-up for a patient is defined as the
   * most-recently-created FollowUpRecord whose nextFollowUpTime is non-null. Older
   * records with their own nextFollowUpTime remain in the history but are not the
   * "active schedule" once a newer record sets/overrides it.
   */
  private async findActiveScheduledRecord(patientId: string, client: DbClient = this.prisma) {
    return client.followUpRecord.findFirst({
      where: {
        patientId,
        nextFollowUpTime: { not: null },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async findOpenPhoneFollowUpTask(patientId: string, client: DbClient = this.prisma) {
    return client.task.findFirst({
      where: {
        patientId,
        type: PHONE_FOLLOW_UP_TASK_TYPE,
        status: { in: OPEN_TASK_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async cancelOpenPhoneFollowUpScheduledTasks(
    patientId: string,
    reason: string,
    client: DbClient = this.prisma,
  ) {
    const openTasks = await client.task.findMany({
      where: {
        patientId,
        type: PHONE_FOLLOW_UP_TASK_TYPE,
        status: { in: OPEN_TASK_STATUSES },
      },
    });

    if (openTasks.length === 0) {
      return { canceledCount: 0, canceledTaskIds: [] as string[] };
    }

    await client.task.updateMany({
      where: { id: { in: openTasks.map((task) => task.id) } },
      data: { status: TaskStatus.CANCELED },
    });

    // Best-effort processing-event audit; failures here must not block the main flow.
    await Promise.all(
      openTasks.map((task) =>
        client.taskProcessingEvent
          .create({
            data: {
              taskId: task.id,
              patientId,
              eventType: 'CANCEL_PROCESSING',
              title: '电话随访任务被覆盖/取消',
              description: reason,
            },
          })
          .catch(() => null),
      ),
    );

    return {
      canceledCount: openTasks.length,
      canceledTaskIds: openTasks.map((task) => task.id),
    };
  }

  /**
   * Create a phone-follow-up reminder task if the scheduled time is within the
   * lead-time window (today through next 2 days). Returns the existing open task
   * if one already exists for this patient (dedupe by patient + open status).
   */
  private async createPhoneFollowUpTaskIfDue(
    patientId: string,
    nextFollowUpTime: Date,
    client: DbClient = this.prisma,
  ) {
    const now = Date.now();
    const target = nextFollowUpTime.getTime();
    const timeUntil = target - now;

    // Only generate when the appointment is reachable within the lead window AND not
    // far in the past (a stale 30-day-old "nextFollowUpTime" should not auto-generate
    // a new reminder task).
    if (timeUntil > REMINDER_LEAD_TIME_MS) return null;
    if (timeUntil < -REMINDER_LEAD_TIME_MS) return null;

    // phone-follow-up-dedupe-v1: collapse stale duplicates left over from a previous
    // buggy build into a single open reminder task.
    const existingTasks = await client.task.findMany({
      where: {
        patientId,
        type: PHONE_FOLLOW_UP_TASK_TYPE,
        status: { in: OPEN_TASK_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existingTasks.length > 0) {
      const [keep, ...duplicates] = existingTasks;
      if (duplicates.length > 0) {
        await client.task.updateMany({
          where: { id: { in: duplicates.map((t) => t.id) } },
          data: { status: TaskStatus.CANCELED },
        });
      }
      return keep;
    }

    const patient = await client.patient.findUnique({
      where: { id: patientId },
      select: { responsibleNurseId: true },
    });

    return client.task.create({
      data: {
        patientId,
        title: PHONE_FOLLOW_UP_TASK_TITLE,
        type: PHONE_FOLLOW_UP_TASK_TYPE,
        dueAt: nextFollowUpTime,
        assigneeId: patient?.responsibleNurseId ?? undefined,
      },
    });
  }

  /**
   * Public, idempotent sync routine. Inspects the patient's active scheduled
   * next-follow-up time, cancels stale tasks whose dueAt no longer matches, and
   * creates a new task if the active schedule has entered the 2-day lead window.
   *
   * Safe to call from list/read endpoints to keep the work queue fresh.
   */
  async syncPhoneFollowUpScheduledTask(patientId: string) {
    // phone-follow-up-dedupe-v1: the previous version used findFirst() which silently
    // left a second duplicate '电话随访' task untouched when the first
    // matched activeTime. We now iterate over EVERY open scheduled task,
    // keep at most one matching active time, and cancel the rest.
    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent syncs for this patient (see lockPatientFollowUp).
      await this.lockPatientFollowUp(patientId, tx);

      const active = await this.findActiveScheduledRecord(patientId, tx);
      const activeTime = active?.nextFollowUpTime ?? null;

      const existingTasks = await tx.task.findMany({
        where: {
          patientId,
          type: PHONE_FOLLOW_UP_TASK_TYPE,
          status: { in: OPEN_TASK_STATUSES },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!activeTime) {
        if (existingTasks.length > 0) {
          await this.cancelOpenPhoneFollowUpScheduledTasks(
            patientId,
            '当前没有有效的下次随访时间，原电话随访提醒任务被取消。',
            tx,
          );
        }
        return { task: null };
      }

      // Prefer the most recent task whose dueAt matches active time within 1 min.
      const matchingTask = existingTasks.find(
        (item) =>
          item.dueAt && Math.abs(item.dueAt.getTime() - activeTime.getTime()) < 60_000,
      );

      if (matchingTask) {
        const duplicateIds = existingTasks
          .filter((item) => item.id !== matchingTask.id)
          .map((item) => item.id);
        if (duplicateIds.length > 0) {
          await tx.task.updateMany({
            where: { id: { in: duplicateIds } },
            data: { status: TaskStatus.CANCELED },
          });
          await Promise.all(
            duplicateIds.map((taskId) =>
              tx.taskProcessingEvent
                .create({
                  data: {
                    taskId,
                    patientId,
                    eventType: 'CANCEL_PROCESSING',
                    title: '重复的电话随访提醒任务被取消',
                    description: '同一患者存在多条电话随访提醒任务，系统保留最匹配下次随访时间的一条，其余自动取消。',
                  },
                })
                .catch(() => null),
            ),
          );
        }
        return { task: matchingTask };
      }

      if (existingTasks.length > 0) {
        await this.cancelOpenPhoneFollowUpScheduledTasks(
          patientId,
          '下次随访时间已更新，原电话随访提醒任务被取消，将根据最新时间重新生成。',
          tx,
        );
      }

      const task = await this.createPhoneFollowUpTaskIfDue(patientId, activeTime, tx);
      return { task };
    });
  }

  // ----- public API: scheduled next follow-up -----

  async getActiveScheduledNextFollowUp(patientId: string) {
    await this.assertPatient(patientId);
    // Keep the work queue fresh whenever the UI asks for the schedule.
    await this.syncPhoneFollowUpScheduledTask(patientId).catch(() => undefined);

    const record = await this.findActiveScheduledRecord(patientId);
    const task = await this.findOpenPhoneFollowUpTask(patientId);

    if (!record || !record.nextFollowUpTime) {
      return { active: null, scheduledTask: null };
    }

    return {
      active: {
        followUpRecordId: record.id,
        nextFollowUpTime: record.nextFollowUpTime,
        sourceFollowUpType: record.followUpType,
        sourceFollowUpTime: record.followUpTime,
        operatorId: record.operatorId,
        recordCreatedAt: record.createdAt,
      },
      scheduledTask: task
        ? {
            id: task.id,
            title: task.title,
            type: task.type,
            status: task.status,
            dueAt: task.dueAt,
            assigneeId: task.assigneeId,
            relatedAlertId: task.relatedAlertId,
          }
        : null,
    };
  }

  /**
   * Edit or cancel the currently active scheduled next follow-up time. This
   * updates the underlying active FollowUpRecord (the most-recent record with a
   * non-null nextFollowUpTime) without creating a new follow-up record.
   *
   * Passing nextFollowUpTime === null cancels the schedule.
   */
  async updateActiveScheduledNextFollowUp(
    patientId: string,
    dto: UpdateNextFollowUpDto,
    user?: RequestUser,
  ) {
    await this.assertPatient(patientId);

    const active = await this.findActiveScheduledRecord(patientId);
    if (!active) {
      throw new BadRequestException(
        '当前患者没有可编辑的下次随访时间，请通过新建电话沟通记录设置。',
      );
    }

    const previousNextFollowUpTime = active.nextFollowUpTime;
    const updatedRecord = await this.update(
      active.id,
      {
        nextFollowUpTime: dto.nextFollowUpTime === null ? null : dto.nextFollowUpTime,
        editReason: dto.editReason ?? '更新下次随访时间',
        electronicSignature: dto.electronicSignature,
      } as UpdateFollowUpDto,
      user,
    );

    const refreshed = await this.getActiveScheduledNextFollowUp(patientId);

    return {
      ...refreshed,
      mutation: {
        followUpRecordId: active.id,
        previousNextFollowUpTime,
        newNextFollowUpTime: updatedRecord.nextFollowUpTime,
        canceled: dto.nextFollowUpTime === null,
      },
    };
  }

  // ----- public CRUD on follow-up records -----

  async create(patientId: string, dto: CreateFollowUpDto) {
    await this.assertPatient(patientId);

    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent phone-follow-up task mutations for this patient.
      await this.lockPatientFollowUp(patientId, tx);

      // Capture the previously active scheduled time so the client can show a
      // "your previous next-follow-up was overwritten" notice.
      const previousActive = await this.findActiveScheduledRecord(patientId, tx);

      const record = await tx.followUpRecord.create({
        data: {
          patientId,
          followUpType: dto.followUpType,
          followUpTime: new Date(dto.followUpTime),
          content: dto.content,
          result: dto.result,
          suggestion: dto.suggestion,
          nextFollowUpTime: dto.nextFollowUpTime
            ? new Date(dto.nextFollowUpTime)
            : undefined,
          operatorId: dto.operatorId,
        },
      });

      let replacedPreviousScheduled:
        | { followUpRecordId: string; nextFollowUpTime: Date }
        | null = null;
      let generatedReminderTask: {
        id: string;
        title: string;
        type: string;
        dueAt: Date | null;
        status: TaskStatus;
      } | null = null;

      const newScheduled = record.nextFollowUpTime ?? null;

      if (newScheduled) {
        // Per spec: a new phone record that includes a 下次随访时间 overrides the
        // previously active schedule. The previous record itself is unchanged
        // (its historical nextFollowUpTime is preserved for audit), but it is
        // no longer considered the active schedule because a newer record now
        // also has a nextFollowUpTime.
        if (previousActive && previousActive.id !== record.id && previousActive.nextFollowUpTime) {
          replacedPreviousScheduled = {
            followUpRecordId: previousActive.id,
            nextFollowUpTime: previousActive.nextFollowUpTime,
          };
        }

        // Always cancel any open reminder task — it was bound to the prior schedule.
        await this.cancelOpenPhoneFollowUpScheduledTasks(
          patientId,
          replacedPreviousScheduled
            ? `下次随访时间被新的电话沟通记录覆盖（原：${previousActive?.nextFollowUpTime?.toISOString()}，新：${newScheduled.toISOString()}）`
            : `新的电话沟通记录设置了下次随访时间：${newScheduled.toISOString()}`,
          tx,
        );

        const task = await this.createPhoneFollowUpTaskIfDue(patientId, newScheduled, tx);
        if (task) {
          generatedReminderTask = {
            id: task.id,
            title: task.title,
            type: task.type,
            dueAt: task.dueAt ?? null,
            status: task.status,
          };
        }
      }
      // If the new record does NOT include a nextFollowUpTime, we leave any
      // existing schedule untouched. Per spec only "包含下次随访时间" records
      // overwrite the previous schedule.

      return {
        ...record,
        replacedPreviousScheduled,
        generatedReminderTask,
      };
    });
  }

  async findByPatient(patientId: string, query: FollowUpListQuery = {}) {
    await this.assertPatient(patientId);

    // Lazy/idempotent sync so the work queue reflects the latest schedule
    // whenever the patient detail follow-up tab is loaded.
    await this.syncPhoneFollowUpScheduledTask(patientId).catch(() => undefined);

    const hasListQuery = Object.keys(query).some(
      (key) => query[key as keyof FollowUpListQuery] !== undefined,
    );
    const skip = parsePositiveInt(query.skip, 0, 100000);
    const take = parsePositiveInt(query.take, 12, 50);
    const sortBy = query.sortBy === 'followUpTime' ? 'followUpTime' : 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const createdFrom = parseDate(query.createdFrom);
    const createdTo = parseDate(query.createdTo);
    const followUpFrom = parseDate(query.followUpFrom);
    const followUpTo = parseDate(query.followUpTo);

    const where: Prisma.FollowUpRecordWhereInput = { patientId };

    if (query.followUpType) {
      where.followUpType = query.followUpType;
    }

    if (createdFrom || createdTo) {
      where.createdAt = {
        ...(createdFrom ? { gte: createdFrom } : {}),
        ...(createdTo ? { lte: createdTo } : {}),
      };
    }

    if (followUpFrom || followUpTo) {
      where.followUpTime = {
        ...(followUpFrom ? { gte: followUpFrom } : {}),
        ...(followUpTo ? { lte: followUpTo } : {}),
      };
    }

    if (!hasListQuery) {
      return this.prisma.followUpRecord.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { followUpTime: 'desc' }],
      });
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.followUpRecord.findMany({
        where,
        skip,
        take,
        orderBy: [{ [sortBy]: sortOrder }, { followUpTime: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.followUpRecord.count({ where }),
    ]);

    return {
      items,
      total,
      skip,
      take,
      hasMore: skip + items.length < total,
    };
  }

  async findOne(id: string) {
    const followUp = await this.prisma.followUpRecord.findUnique({
      where: { id },
      include: {
        patient: true,
      },
    });

    if (!followUp) {
      throw new NotFoundException('Follow-up record not found');
    }

    return followUp;
  }


  async update(id: string, dto: UpdateFollowUpDto, user?: RequestUser) {
    const existing = await this.prisma.followUpRecord.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Follow-up record not found');
    }

    const data: {
      followUpType?: string;
      followUpTime?: Date;
      content?: string | null;
      result?: string | null;
      suggestion?: string | null;
      nextFollowUpTime?: Date | null;
      operatorId?: string | null;
    } = {};

    if (dto.followUpType !== undefined) data.followUpType = dto.followUpType;
    if (dto.followUpTime !== undefined) data.followUpTime = new Date(dto.followUpTime);
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.result !== undefined) data.result = dto.result;
    if (dto.suggestion !== undefined) data.suggestion = dto.suggestion;
    if (dto.nextFollowUpTime !== undefined) {
      data.nextFollowUpTime = dto.nextFollowUpTime
        ? new Date(dto.nextFollowUpTime)
        : null;
    }
    if (dto.operatorId !== undefined) data.operatorId = dto.operatorId;

    const updated = await this.prisma.followUpRecord.update({
      where: { id },
      data,
    });

    await this.prisma.auditLog.create({
      data: {
        operatorId: user?.id ?? dto.operatorId ?? existing.operatorId ?? undefined,
        action: 'FOLLOW_UP_RECORD_UPDATED',
        targetType: 'FollowUpRecord',
        targetId: id,
        beforeData: JSON.parse(JSON.stringify(existing)),
        afterData: JSON.parse(
          JSON.stringify({
            ...updated,
            editReason: dto.editReason,
            electronicSignature: dto.electronicSignature,
          }),
        ),
      },
    });

    // If nextFollowUpTime was touched, reconcile the open reminder task to
    // match the current schedule (set/cancel/reschedule as appropriate).
    if (dto.nextFollowUpTime !== undefined) {
      await this.syncPhoneFollowUpScheduledTask(existing.patientId).catch(() => undefined);
    }

    return updated;
  }

  async remove(id: string) {
    const target = await this.findOne(id);

    const deleted = await this.prisma.followUpRecord.delete({
      where: { id },
    });

    // After deleting a record (which may have been the active scheduled one),
    // re-sync the patient's open reminder task.
    await this.syncPhoneFollowUpScheduledTask(target.patientId).catch(() => undefined);

    return deleted;
  }
}


