import { Injectable } from '@nestjs/common';
import { connect } from 'node:net';
import { PrismaService } from '../prisma/prisma.service';

export type DependencyProbe = {
  status: 'UP' | 'DOWN';
  latencyMs: number;
  error?: string;
};

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  live() {
    return {
      status: 'UP' as const,
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  async ready() {
    const [db, redis] = await Promise.all([
      this.probeDatabase(),
      this.probeRedis(),
    ]);

    return {
      status: db.status === 'UP' && redis.status === 'UP' ? ('UP' as const) : ('DOWN' as const),
      checkedAt: new Date().toISOString(),
      dependencies: { db, redis },
    };
  }

  async probeDatabase(): Promise<DependencyProbe> {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'UP', latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: 'DOWN',
        latencyMs: Date.now() - startedAt,
        error: this.errorMessage(error),
      };
    }
  }

  async probeRedis(timeoutMs = 1_500): Promise<DependencyProbe> {
    const startedAt = Date.now();
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = Number(process.env.REDIS_PORT || 6379);

    return new Promise((resolve) => {
      let settled = false;
      const socket = connect({ host, port });

      const finish = (status: 'UP' | 'DOWN', error?: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve({
          status,
          latencyMs: Date.now() - startedAt,
          ...(error ? { error } : {}),
        });
      };

      socket.setTimeout(timeoutMs);
      socket.on('connect', () => {
        socket.write('*1\r\n$4\r\nPING\r\n');
      });
      socket.on('data', (data) => {
        const reply = data.toString('utf8');
        finish(reply.startsWith('+PONG') ? 'UP' : 'DOWN', reply.startsWith('+PONG') ? undefined : 'Unexpected Redis PING response');
      });
      socket.on('timeout', () => finish('DOWN', `Redis PING timed out after ${timeoutMs}ms`));
      socket.on('error', (error) => finish('DOWN', error.message));
    });
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
  }
}
