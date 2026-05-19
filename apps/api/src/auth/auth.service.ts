import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { UserRole, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { signToken, verifyPassword, verifyToken } from './auth.util';

export type AuthenticatedUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
};

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private failIfDatabaseIsNotReady(error: unknown): never {
    const prismaError = error as { code?: string; meta?: { table?: string; modelName?: string } };

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
    const payload = verifyToken(token);
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
    };
  }
}

