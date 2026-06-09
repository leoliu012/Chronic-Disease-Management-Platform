import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { UserRole, type User } from '@prisma/client';
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

  private failIfDatabaseIsNotReady(error: unknown): never {
    const prismaError = error as { code?: string; meta?: { table?: string; modelName?: string } };

    // Connection-level failures: server unreachable, timed out, lost, etc.
    // These all mean "infra problem" rather than "client problem", and should
    // surface as 503 with a clear hint instead of a 500 with a Prisma stack.
    if (
      prismaError?.code === 'P1001' ||
      prismaError?.code === 'P1002' ||
      prismaError?.code === 'P1008' ||
      prismaError?.code === 'P1017'
    ) {
      throw new ServiceUnavailableException({
        message:
          '数据库连接失败，请确认 Postgres 是否在运行。可在 apps/api 目录执行 docker compose up -d 启动数据库，然后重试。',
        code: 'DATABASE_UNAVAILABLE',
        prismaCode: prismaError.code,
      });
    }

    if (prismaError?.code === 'P2021' || prismaError?.code === 'P2022') {
      throw new ServiceUnavailableException({
        message:
          '数据库结构尚未初始化或 Prisma Client 与数据库不同步。请在 apps/api 执行 npm run demo:init，或手动执行 npx prisma migrate dev && npx prisma generate && node prisma/seed-all.js。',
        code: 'DATABASE_SCHEMA_NOT_READY',
        prismaCode: prismaError.code,
        table: prismaError.meta?.table,
        modelName: prismaError.meta?.modelName,
      });
    }

    throw error;
  }

  async login(dto: LoginDto, ipAddress?: string) {
    const username = dto.username.trim().toLowerCase();
    let user: User | null;
    try {
      user = await this.prisma.user.findUnique({
        where: { username },
      });
    } catch (error) {
      this.failIfDatabaseIsNotReady(error);
    }

    if (!user || !user.isActive || !verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const safeUser: AuthenticatedUser = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      hospitalTenantId: user.hospitalTenantId,
    };

    try {
      await this.prisma.auditLog.create({
        data: {
          operatorId: user.id,
          action: 'LOGIN',
          targetType: 'User',
          targetId: user.id,
          ipAddress,
          afterData: {
            username: user.username,
            role: user.role,
          },
        },
      });
    } catch (error) {
      this.failIfDatabaseIsNotReady(error);
    }

    return {
      accessToken: signToken({
        sub: user.id,
        username: user.username,
        role: user.role,
        displayName: user.displayName,
      }),
      user: safeUser,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    let payload;
    try {
      payload = verifyToken(token);
    } catch (error) {
      // Token-level failures must surface as 401, not 500. Distinguish expired
      // vs malformed/tampered so the frontend can decide whether to silently
      // refresh (future) or just send the user back to /login (today).
      if (error instanceof TokenExpiredError) {
        throw new UnauthorizedException({
          message: '登录已过期，请重新登录。',
          code: 'TOKEN_EXPIRED',
        });
      }
      if (error instanceof InvalidTokenError) {
        throw new UnauthorizedException({
          message: '登录凭据无效，请重新登录。',
          code: 'INVALID_TOKEN',
        });
      }
      throw new UnauthorizedException({
        message: '登录凭据验证失败，请重新登录。',
        code: 'TOKEN_VERIFICATION_FAILED',
      });
    }

    let user: User | null;
    try {
      user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
    } catch (error) {
      this.failIfDatabaseIsNotReady(error);
    }

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is inactive or missing');
    }

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      hospitalTenantId: user.hospitalTenantId,
    };
  }
}


