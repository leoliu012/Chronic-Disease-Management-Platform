/**
 * gateway-alert.service.ts
 *
 * gateway-production-hardening: 把"运维需要立刻知道的事"推送给外部告警通道.
 *
 * 触发场景:
 *   - Promotion 重试耗尽 (RETRY_EXHAUSTED)
 *   - Adapter 长时间无法连接 (ADAPTER_DOWN)
 *   - 单个 IntegrationSource 在最近 N 分钟内失败率 > 阈值 (HIGH_FAILURE_RATE)
 *
 * 实现:
 *   - 默认 channel = 'NONE' (干跑模式, 仅写日志)
 *   - 设置 GATEWAY_ALERT_WEBHOOK_URL -> 启用 'WEBHOOK' channel,
 *     POST JSON payload 到该 URL
 *   - 用 globalThis.fetch (Node 18+), 不引新 npm 依赖
 *   - 失败不抛错: 告警自己失败不应该影响主流程
 *
 * Payload shape (generic JSON, 由运维侧适配到钉钉 / 企微 / Slack):
 *   {
 *     "kind": "RETRY_EXHAUSTED" | "ADAPTER_DOWN" | "HIGH_FAILURE_RATE",
 *     "severity": "warning" | "error",
 *     "title": "...",
 *     "summary": "...",
 *     "context": { ... },
 *     "occurredAt": "2026-05-25T..."
 *   }
 */

import { Injectable, Logger } from '@nestjs/common';

export type AlertKind =
  | 'RETRY_EXHAUSTED'
  | 'ADAPTER_DOWN'
  | 'HIGH_FAILURE_RATE'
  | 'TEST_PING';

export interface AlertPayload {
  kind: AlertKind;
  severity: 'info' | 'warning' | 'error';
  title: string;
  summary: string;
  context?: Record<string, unknown>;
}

@Injectable()
export class GatewayAlertService {
  private readonly logger = new Logger('GatewayAlertService');

  /**
   * Cooldown 状态 — 同一 dedupKey 在 cooldown 秒内不重复推送, 避免告警轰炸.
   */
  private readonly cooldown = new Map<string, number>();
  private readonly cooldownMs = 5 * 60 * 1000;

  async emit(payload: AlertPayload, dedupKey?: string): Promise<void> {
    const enriched = {
      ...payload,
      occurredAt: new Date().toISOString(),
      hostHint: process.env.HOSTNAME ?? process.env.HOST ?? null,
    };

    // 日志通道 — 永远开
    const logFn = payload.severity === 'error' ? 'error' : 'warn';
    this.logger[logFn](
      `[ALERT][${payload.kind}] ${payload.title} — ${payload.summary}` +
        (payload.context ? ` ctx=${JSON.stringify(payload.context)}` : ''),
    );

    // Cooldown
    if (dedupKey) {
      const last = this.cooldown.get(dedupKey);
      if (last && Date.now() - last < this.cooldownMs) {
        return;
      }
      this.cooldown.set(dedupKey, Date.now());
    }

    // Webhook 通道
    const url = process.env.GATEWAY_ALERT_WEBHOOK_URL;
    if (!url) return;

    try {
      // Node 18+ 自带 fetch
      const fetchFn = (globalThis as { fetch?: typeof fetch }).fetch;
      if (!fetchFn) {
        this.logger.warn(
          'GATEWAY_ALERT_WEBHOOK_URL set but global fetch is unavailable (Node < 18?). Skipping webhook.',
        );
        return;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(enriched),
          signal: controller.signal,
        });
        if (!response.ok) {
          this.logger.warn(
            `Alert webhook responded with HTTP ${response.status} (kind=${payload.kind})`,
          );
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      this.logger.warn(
        `Alert webhook failed: ${err instanceof Error ? err.message : String(err)} (kind=${payload.kind})`,
      );
    }
  }
}
