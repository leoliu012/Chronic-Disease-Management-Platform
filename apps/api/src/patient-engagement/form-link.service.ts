import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * FormLinkService (v2)
 * --------------------
 * 一次性安全 H5 链接的状态机.
 *   token 仅明文返回一次, DB 只存 SHA-256 hash.
 *   状态: ACTIVE → USED / EXPIRED / REVOKED.
 *
 * v2 新增 claimForSubmission:
 *   把"占用一次提交名额"做成原子操作, 放进 controller 的 $transaction.
 *   这样并发双击 / retry / 多请求同时到达, 只会有一个真正写入 QuestionnaireResult /
 *   VitalRecord / MedicationCheckIn, 其余直接抛 TOKEN_USED.
 */
@Injectable()
export class FormLinkService {
  private readonly logger = new Logger(FormLinkService.name);
  private static readonly TOKEN_BYTES = 32;
  private static readonly DEFAULT_EXPIRES_HOURS = 72;
  private static readonly MAX_IDENTITY_FAILURES = 5;
  private static readonly IDENTITY_LOCK_MINUTES = 15;

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  }

  generateToken(): { token: string; tokenHash: string } {
    const token = crypto.randomBytes(FormLinkService.TOKEN_BYTES).toString('base64url');
    return { token, tokenHash: this.hashToken(token) };
  }

  buildLinkUrl(token: string): string {
    const base = (process.env.PATIENT_ENGAGEMENT_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
    return `${base}/wx/form/${token}`;
  }

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  async create(input: {
    hospitalTenantId?: string | null;
    patientId: string;
    type: string;
    title: string;
    description?: string | null;
    payload?: Record<string, unknown> | null;
    expiresInHours?: number;
    taskId?: string | null;
    riskAlertId?: string | null;
    maxSubmit?: number;
    requiresIdentityCheck?: boolean;
    createdBy?: string | null;
  }) {
    const { token, tokenHash } = this.generateToken();
    const expiresInHours = input.expiresInHours ?? FormLinkService.DEFAULT_EXPIRES_HOURS;
    const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000);

    const formLink = await this.prisma.patientFormLink.create({
      data: {
        hospitalTenantId: input.hospitalTenantId ?? undefined,
        patientId: input.patientId,
        taskId: input.taskId ?? undefined,
        riskAlertId: input.riskAlertId ?? undefined,
        type: input.type,
        tokenHash,
        title: input.title,
        description: input.description ?? undefined,
        payload: (input.payload as any) ?? undefined,
        expiresAt,
        maxSubmit: input.maxSubmit ?? 1,
        requiresIdentityCheck: input.requiresIdentityCheck ?? false,
        createdBy: input.createdBy ?? undefined,
        status: 'ACTIVE',
      },
    });
    return { formLink, token, linkUrl: this.buildLinkUrl(token) };
  }

  // ---------------------------------------------------------------------------
  // lookup / status
  // ---------------------------------------------------------------------------

  async resolveByToken(token: string) {
    if (!token || typeof token !== 'string' || token.length < 16) {
      throw new BadRequestException({ code: 'TOKEN_INVALID', message: '链接无效' });
    }
    const tokenHash = this.hashToken(token);
    const formLink = await this.prisma.patientFormLink.findUnique({ where: { tokenHash } });
    if (!formLink) {
      throw new NotFoundException({ code: 'TOKEN_NOT_FOUND', message: '链接无效或已被撤销' });
    }
    if (
      formLink.status === 'ACTIVE' &&
      formLink.expiresAt &&
      formLink.expiresAt.getTime() < Date.now()
    ) {
      return this.prisma.patientFormLink.update({
        where: { id: formLink.id },
        data: { status: 'EXPIRED' },
      });
    }
    return formLink;
  }

  ensureUsable(formLink: {
    status: string;
    expiresAt: Date | null;
    revokedAt: Date | null;
    identityLockedUntil: Date | null;
    submitCount: number;
    maxSubmit: number;
  }) {
    if (formLink.status === 'REVOKED' || formLink.revokedAt) {
      throw new ForbiddenException({ code: 'TOKEN_REVOKED', message: '链接已被撤销, 请联系医院重新发送.' });
    }
    if (formLink.status === 'EXPIRED' || (formLink.expiresAt && formLink.expiresAt.getTime() < Date.now())) {
      throw new ForbiddenException({ code: 'TOKEN_EXPIRED', message: '链接已过期, 请联系医院重新发送.' });
    }
    if (formLink.status === 'USED' || formLink.submitCount >= formLink.maxSubmit) {
      throw new ForbiddenException({ code: 'TOKEN_USED', message: '本链接已提交过, 无需重复填写.' });
    }
    if (formLink.identityLockedUntil && formLink.identityLockedUntil.getTime() > Date.now()) {
      throw new ForbiddenException({ code: 'TOKEN_LOCKED', message: '身份校验失败次数过多, 请稍后再试.' });
    }
  }

  // ---------------------------------------------------------------------------
  // ATOMIC CLAIM (Bug 4)
  // ---------------------------------------------------------------------------

  /**
   * 在 $transaction 里调用. 把"占用一次提交名额"做成一条原子 SQL:
   *   UPDATE PatientFormLink
   *      SET submitCount = submitCount + 1,
   *          status      = (maxSubmit <= 1 ? 'USED' : status),
   *          usedAt      = (maxSubmit <= 1 ? NOW() : usedAt)
   *    WHERE id = $id
   *      AND status = 'ACTIVE'
   *      AND revokedAt IS NULL
   *      AND expiresAt > NOW()
   *      AND submitCount < maxSubmit
   *
   * Prisma 的 updateMany + filter 条件 == 同一条 SQL. 受影响行数:
   *   1 → 抢占成功, 调用方继续往下写业务数据;
   *   0 → 已被人抢走 / 失效 / 撤销 → 抛 TOKEN_USED, 调用方什么都不写.
   *
   * 这个方法是 idempotent-safe: maxSubmit > 1 时不会把 status 变成 USED, 不会
   * 破坏未来"链接允许 N 次提交"的扩展性.
   */
  async claimForSubmission(
    tx: Prisma.TransactionClient,
    formLinkId: string,
  ): Promise<{ id: string; maxSubmit: number; submitCount: number; status: string }> {
    const before = await tx.patientFormLink.findUnique({
      where: { id: formLinkId },
      select: { id: true, maxSubmit: true, submitCount: true, status: true, expiresAt: true, revokedAt: true },
    });
    if (!before) {
      throw new NotFoundException({ code: 'TOKEN_NOT_FOUND', message: '链接不存在' });
    }

    // updateMany returns { count: N }; we expect exactly 1 if we won the race.
    const claimed = await tx.patientFormLink.updateMany({
      where: {
        id: formLinkId,
        status: 'ACTIVE',
        revokedAt: null,
        expiresAt: { gt: new Date() },
        submitCount: { lt: before.maxSubmit },
      },
      data: {
        submitCount: { increment: 1 },
        ...(before.maxSubmit <= 1
          ? { status: 'USED' as const, usedAt: new Date() }
          : {}),
      },
    });

    if (claimed.count !== 1) {
      throw new ForbiddenException({
        code: 'TOKEN_USED',
        message: '该链接已提交或已失效',
      });
    }

    return {
      id: before.id,
      maxSubmit: before.maxSubmit,
      submitCount: before.submitCount + 1,
      status: before.maxSubmit <= 1 ? 'USED' : before.status,
    };
  }

  // ---------------------------------------------------------------------------
  // identity failure / revoke
  // ---------------------------------------------------------------------------

  async recordIdentityFailure(id: string) {
    const link = await this.prisma.patientFormLink.findUnique({ where: { id } });
    if (!link) return null;
    const nextCount = link.identityCheckFailureCount + 1;
    const shouldLock = nextCount >= FormLinkService.MAX_IDENTITY_FAILURES;
    return this.prisma.patientFormLink.update({
      where: { id },
      data: {
        identityCheckFailureCount: nextCount,
        identityLockedUntil: shouldLock
          ? new Date(Date.now() + FormLinkService.IDENTITY_LOCK_MINUTES * 60 * 1000)
          : undefined,
      },
    });
  }

  async revoke(id: string, reason: string, _operatorId?: string) {
    const existing = await this.prisma.patientFormLink.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Form link not found');
    if (existing.status === 'REVOKED') return existing;
    return this.prisma.patientFormLink.update({
      where: { id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokeReason: reason,
      },
    });
  }
}
