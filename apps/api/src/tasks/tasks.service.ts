import { Injectable, NotFoundException } from '@nestjs/common';
import { AlertStatus, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async create(patientId: string, dto: CreateTaskDto) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    if (dto.relatedAlertId) {
      const existingOpenTask = await this.prisma.task.findFirst({
        where: {
          relatedAlertId: dto.relatedAlertId,
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        },
        include: { patient: true },
      });

      if (existingOpenTask) {
        return existingOpenTask;
      }
    }

    return this.prisma.task.create({
      data: {
        patientId,
        title: dto.title,
        type: dto.type,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        assigneeId: dto.assigneeId,
        relatedAlertId: dto.relatedAlertId,
      },
    });
  }

  async findAll(query: QueryTasksDto) {
    return this.prisma.task.findMany({
      where: {
        status: query.status,
        type: query.type,
        assigneeId: query.assigneeId,
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
        patient: true,
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
}




