import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole, type User } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { signToken, TokenExpiredError, InvalidTokenError, verifyPassword, verifyToken } from './auth.util';

export type AuthenticatedUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  hospitalTenantId: string | null;
};

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private intEnv(name: string, fallback: number) {
    const value = Number(process.env[name] ?? fallback);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  private throttleHash(type: 'USERNAME' | 'IP', value: string): string {
    const salt = process.env.AUTH_THROTTLE_SECRET || process.env.JWT_SECRET || 'dev_secret_change_later';
    return crypto.createHmac('sha256', salt).update(`${type}:${value}`).digest('hex');
  }

  private async assertLoginAllowed(username: string, ipAddress?: string) {
    const now = new Date();
    const keys = [
      { keyType: 'USERNAME', keyHash: this.throttleHash('USERNAME', username) },
      ...(ipAddress ? [{ keyType: 'IP', keyHash: this.throttleHash('IP', ipAddress) }] : []),
    ];
    for (const key of keys) {
      const row = await this.prisma.authLoginThrottle.findUnique({
        where: { keyType_keyHash: key },
      });
      if (row?.lockedUntil && row.lockedUntil.getTime() > now.getTime()) {
        throw new HttpException(
          { code: 'LOGIN_RATE_LIMITED', message: '登录尝试过于频繁，请稍后再试。' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  private async recordFailureBucket(
    keyType: 'USERNAME' | 'IP',
    rawValue: string,
    limit: number,
    now: Date,
  ) {
    const keyHash = this.throttleHash(keyType, rawValue);
    const windowMs = this.intEnv('AUTH_LOGIN_WINDOW_MS', 15 * 60 * 1000);
    const lockMs = this.intEnv('AUTH_LOGIN_LOCK_MS', 15 * 60 * 1000);
    const current = await this.prisma.authLoginThrottle.findUnique({
      where: { keyType_keyHash: { keyType, keyHash } },
    });
    const reset = !current || now.getTime() - current.windowStartedAt.getTime() > windowMs;
    const failedCount = reset ? 1 : current.failedCount + 1;
    await this.prisma.authLoginThrottle.upsert({
      where: { keyType_keyHash: { keyType, keyHash } },
      create: {
        keyType,
        keyHash,
        failedCount,
        windowStartedAt: now,
        lastFailedAt: now,
        ...(failedCount >= limit ? { lockedUntil: new Date(now.getTime() + lockMs) } : {}),
      },
      update: {
        failedCount,
        ...(reset ? { windowStartedAt: now } : {}),
        lastFailedAt: now,
        ...(failedCount >= limit ? { lockedUntil: new Date(now.getTime() + lockMs) } : {}),
      },
    });
  }

  private async recordLoginFailure(username: string, ipAddress: string | undefined, user?: User | null) {
    const now = new Date();
    const usernameLimit = user?.role === UserRole.ADMIN
      ? this.intEnv('AUTH_LOGIN_MAX_FAILURES_ADMIN', 3)
      : this.intEnv('AUTH_LOGIN_MAX_FAILURES_USERNAME', 5);
    const ipLimit = this.intEnv('AUTH_LOGIN_MAX_FAILURES_IP', 20);
    await this.prisma.$transaction(async (tx) => {
      // keep the audit event in the same DB transaction as the throttle mutation
      await tx.auditLog.create({
        data: {
          operatorId: user?.id,
          action: 'LOGIN_FAILED',
          targetType: 'User',
          targetId: user?.id,
          ipAddress,
          afterData: {
            usernameHash: this.throttleHash('USERNAME', username),
            reason: 'INVALID_CREDENTIALS',
          },
        },
      });
    });
    await this.recordFailureBucket('USERNAME', username, usernameLimit, now);
    if (ipAddress) await this.recordFailureBucket('IP', ipAddress, ipLimit, now);
  }

  private async clearLoginThrottle(username: string, ipAddress?: string) {
    const now = new Date();
    const keys = [
      { keyType: 'USERNAME', keyHash: this.throttleHash('USERNAME', username) },
      ...(ipAddress ? [{ keyType: 'IP', keyHash: this.throttleHash('IP', ipAddress) }] : []),
    ];
    await this.prisma.authLoginThrottle.updateMany({
      where: { OR: keys },
      data: { failedCount: 0, lockedUntil: null, windowStartedAt: now, lastSucceededAt: now },
    });
  }

  private failIfDatabaseIsNotReady(error: unknown): never {
    const prismaError = error as { code?: string; meta?: { table?: string; modelName?: string } };
    if (['P1001', 'P1002', 'P1008', 'P1017'].includes(prismaError?.code ?? '')) {
      throw new ServiceUnavailableException({
        message: '数据库连接失败，请确认 Postgres 是否在运行。可在 apps/api 目录执行 docker compose up -d 启动数据库，然后重试。',
        code: 'DATABASE_UNAVAILABLE', prismaCode: prismaError.code,
      });
    }
    if (prismaError?.code === 'P2021' || prismaError?.code === 'P2022') {
      throw new ServiceUnavailableException({
        message: '数据库结构尚未初始化或 Prisma Client 与数据库不同步。请执行 npx prisma migrate deploy && npx prisma generate。',
        code: 'DATABASE_SCHEMA_NOT_READY', prismaCode: prismaError.code,
        table: prismaError.meta?.table, modelName: prismaError.meta?.modelName,
      });
    }
    throw error;
  }

  async login(dto: LoginDto, ipAddress?: string) {
    const username = dto.username.trim().toLowerCase();
    let user: User | null = null;
    try {
      await this.assertLoginAllowed(username, ipAddress);
      user = await this.prisma.user.findUnique({ where: { username } });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.failIfDatabaseIsNotReady(error);
    }

    if (!user || !user.isActive || !verifyPassword(dto.password, user.passwordHash)) {
      try {
        await this.recordLoginFailure(username, ipAddress, user);
      } catch (error) {
        this.failIfDatabaseIsNotReady(error);
      }
      throw new UnauthorizedException('Invalid username or password');
    }

    const safeUser: AuthenticatedUser = {
      id: user.id, username: user.username, displayName: user.displayName,
      role: user.role, hospitalTenantId: user.hospitalTenantId,
    };
    try {
      await this.clearLoginThrottle(username, ipAddress);
      await this.prisma.auditLog.create({
        data: {
          operatorId: user.id, action: 'LOGIN', targetType: 'User', targetId: user.id,
          ipAddress, afterData: { username: user.username, role: user.role },
        },
      });
    } catch (error) {
      this.failIfDatabaseIsNotReady(error);
    }
    return {
      accessToken: signToken({ sub: user.id, username: user.username, role: user.role, displayName: user.displayName }),
      user: safeUser,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    let payload;
    try { payload = verifyToken(token); }
    catch (error) {
      if (error instanceof TokenExpiredError) throw new UnauthorizedException({ message: '登录已过期，请重新登录。', code: 'TOKEN_EXPIRED' });
      if (error instanceof InvalidTokenError) throw new UnauthorizedException({ message: '登录凭据无效，请重新登录。', code: 'INVALID_TOKEN' });
      throw new UnauthorizedException({ message: '登录凭据验证失败，请重新登录。', code: 'TOKEN_VERIFICATION_FAILED' });
    }
    let user: User | null = null;
    try { user = await this.prisma.user.findUnique({ where: { id: payload.sub } }); }
    catch (error) { this.failIfDatabaseIsNotReady(error); }
    if (!user || !user.isActive) throw new UnauthorizedException('User is inactive or missing');
    return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, hospitalTenantId: user.hospitalTenantId };
  }
}
