import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from './request-user.type';

export type AuditEventInput = {
  user?: RequestUser;
  action: string;
  targetType: string;
  targetId?: string | null;
  ipAddress?: string;
  beforeData?: unknown;
  afterData?: unknown;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEventInput) {
    if (!event.user && !event.action) return;

    await this.prisma.auditLog.create({
      data: {
        operatorId: event.user?.id,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId ?? undefined,
        ipAddress: event.ipAddress,
        beforeData:
          event.beforeData === undefined
            ? undefined
            : (event.beforeData as Prisma.InputJsonValue),
        afterData:
          event.afterData === undefined
            ? undefined
            : (event.afterData as Prisma.InputJsonValue),
      },
    });
  }
}
