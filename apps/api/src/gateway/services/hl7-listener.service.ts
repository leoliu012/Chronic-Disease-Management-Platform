/**
 * hl7-listener.service.ts
 *
 * HL7 v2 over MLLP TCP 监听器（Node 原生 net 模块实现，零依赖）。
 *
 * 默认禁用：必须把 GATEWAY_HL7_ENABLED 设为 "true" 才启动，
 * 监听 GATEWAY_HL7_HOST:GATEWAY_HL7_PORT（默认 0.0.0.0:2575）。
 *
 * 工作流程：
 *   1. 一个 TCP 连接来 → 创建 frame buffer
 *   2. 持续读字节，按 MLLP 框 (<SB> ... <EB><CR>) 切分出完整报文
 *   3. 每条报文用 hl7-message.parser 解析
 *   4. 通过 hl7ToNormalizedEvents 映射成 NormalizedEvent[]
 *   5. 交给 InboundEventService.ingestBatch 写库
 *   6. 回写 HL7 ACK 报文（AA / AE / AR）
 *
 * 兼容性：
 *   - 处理跨 packet 的报文（一条报文被 TCP 拆成多个 chunk）
 *   - 处理一个 packet 里多条报文
 *   - 客户端发送 \n 而非 \r 的容错（HL7 标准要求 \r，但部分国产系统会发 \n）
 */

import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import * as net from 'net';
import {
  DEFAULT_HL7_MLLP_PORT,
  GATEWAY_CHANNEL,
  MLLP,
} from '../gateway.constants';
import { hl7ToNormalizedEvents } from '../parsers/hl7-to-normalized.mapper';
import {
  buildHl7Ack,
  parseHl7Message,
} from '../parsers/hl7-message.parser';
import { InboundEventService } from './inbound-event.service';

@Injectable()
export class Hl7ListenerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('GatewayHL7Listener');
  private server: net.Server | null = null;
  private readonly clientCount = { current: 0 };

  constructor(private readonly inbound: InboundEventService) {}

  /* ------------------------------------------------------------------------ */

  async onApplicationBootstrap() {
    if (process.env.GATEWAY_HL7_ENABLED !== 'true') {
      this.logger.log('HL7 MLLP listener disabled (set GATEWAY_HL7_ENABLED=true to enable).');
      return;
    }

    const host = process.env.GATEWAY_HL7_HOST ?? '0.0.0.0';
    const port = Number(process.env.GATEWAY_HL7_PORT ?? DEFAULT_HL7_MLLP_PORT);

    await new Promise<void>((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));
      this.server.on('error', (err) => {
        this.logger.error(`HL7 MLLP server error: ${err.message}`);
        reject(err);
      });
      this.server!.listen(port, host, () => {
        this.logger.log(`HL7 MLLP listener up on ${host}:${port}`);
        resolve();
      });
    });
  }

  async onApplicationShutdown() {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.logger.log('HL7 MLLP listener stopped.');
        resolve();
      });
    });
    this.server = null;
  }

  /* ------------------------------------------------------------------------ */

  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  getStatus() {
    return {
      enabled: process.env.GATEWAY_HL7_ENABLED === 'true',
      running: this.isRunning(),
      host: process.env.GATEWAY_HL7_HOST ?? '0.0.0.0',
      port: Number(process.env.GATEWAY_HL7_PORT ?? DEFAULT_HL7_MLLP_PORT),
      activeClients: this.clientCount.current,
    };
  }

  /* ------------------------------------------------------------------------ */

  private handleConnection(socket: net.Socket) {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    this.clientCount.current += 1;
    this.logger.log(`HL7 MLLP client connected: ${remote} (active=${this.clientCount.current})`);

    let buffer = Buffer.alloc(0);

    socket.on('data', async (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (true) {
        const sbIndex = buffer.indexOf(MLLP.SB);
        if (sbIndex === -1) {
          // 还没看到帧起始 — 丢弃前面的噪声字节避免内存爆
          if (buffer.length > 64 * 1024) buffer = Buffer.alloc(0);
          break;
        }
        const ebIndex = buffer.indexOf(MLLP.EB, sbIndex + 1);
        if (ebIndex === -1) {
          // 帧还没收完，等下一个 chunk
          break;
        }
        const payload = buffer.slice(sbIndex + 1, ebIndex).toString('utf8');

        // 帧结束应该紧跟一个 <CR>，但宽容处理：把 <EB> 和后面的 <CR>（如果有）一起跳过
        let consumeUntil = ebIndex + 1;
        if (buffer[consumeUntil] === MLLP.CR) consumeUntil += 1;
        buffer = buffer.slice(consumeUntil);

        // 处理一条完整报文
        await this.handleMessage(socket, payload);
      }
    });

    socket.on('error', (err) => {
      this.logger.warn(`HL7 MLLP socket error from ${remote}: ${err.message}`);
    });

    socket.on('close', () => {
      this.clientCount.current = Math.max(0, this.clientCount.current - 1);
      this.logger.log(`HL7 MLLP client disconnected: ${remote} (active=${this.clientCount.current})`);
    });
  }

  private async handleMessage(socket: net.Socket, rawMessage: string) {
    try {
      const parsed = parseHl7Message(rawMessage);
      this.logger.log(
        `HL7 inbound: trigger=${parsed.triggerEvent} msgId=${parsed.messageControlId}`,
      );

      const events = hl7ToNormalizedEvents(parsed);
      if (events.length === 0) {
        this.sendAck(socket, parsed, 'AR', `Unsupported trigger event: ${parsed.triggerEvent}`);
        return;
      }

      const result = await this.inbound.ingestBatch(GATEWAY_CHANNEL.HL7_MLLP, events, {
        batchType: `HL7:${parsed.triggerEvent}`,
      });

      if (result.failed > 0 && result.accepted === 0) {
        this.sendAck(socket, parsed, 'AE', `Server failed to persist all ${result.total} records`);
      } else {
        const note =
          result.duplicated > 0
            ? `Accepted ${result.accepted}, duplicated ${result.duplicated}, failed ${result.failed}`
            : `Accepted ${result.accepted}, failed ${result.failed}`;
        this.sendAck(socket, parsed, result.failed > 0 ? 'AE' : 'AA', note);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`HL7 parse/ingest error: ${errorMessage}`);
      // 没解析成功 → 无法回标准 ACK，只能发一个空 ACK
      this.sendRawAck(socket, errorMessage);
    }
  }

  private sendAck(
    socket: net.Socket,
    parsed: ReturnType<typeof parseHl7Message>,
    code: 'AA' | 'AE' | 'AR',
    note?: string,
  ) {
    const ack = buildHl7Ack(parsed, code, note);
    const framed = Buffer.concat([
      Buffer.from([MLLP.SB]),
      Buffer.from(ack, 'utf8'),
      Buffer.from([MLLP.EB, MLLP.CR]),
    ]);
    socket.write(framed);
  }

  private sendRawAck(socket: net.Socket, errorMessage: string) {
    // 兜底 ACK：使用最低限度的 MSH + MSA。
    const lines = [
      `MSH|^~\\&|GATEWAY|GATEWAY|UNKNOWN|UNKNOWN|${formatNowHl7()}||ACK|GW${Date.now()}|P|2.5`,
      `MSA|AE||${errorMessage.replace(/[|\r\n]/g, ' ')}`,
    ];
    const ack = lines.join('\r') + '\r';
    const framed = Buffer.concat([
      Buffer.from([MLLP.SB]),
      Buffer.from(ack, 'utf8'),
      Buffer.from([MLLP.EB, MLLP.CR]),
    ]);
    socket.write(framed);
  }
}

function formatNowHl7(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}` +
    `${pad(d.getUTCMonth() + 1)}` +
    `${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}` +
    `${pad(d.getUTCMinutes())}` +
    `${pad(d.getUTCSeconds())}`
  );
}
