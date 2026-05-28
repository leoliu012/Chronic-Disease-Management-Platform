/**
 * field-mapping-resolver.service.ts
 *
 * gateway-production-hardening: 让 IntegrationFieldMapping 表真正参与 promote.
 *
 * 之前 IntegrationPromoteService 是"代码内硬编码字段映射" (e.g. payload['icdCode']),
 * IntegrationFieldMapping 表只用来在前端展示"哪些字段已被映射", 不实际生效.
 *
 * 现在的语义:
 *   1. promote 前调 applyToPayload(sourceId, targetModel, payload)
 *   2. resolver 查 IntegrationFieldMapping where { sourceId, targetModel, isActive }
 *   3. 把 payload[externalField] 改名为 payload[localField], 并按
 *      transformRule 做受控变换. 缺失时填 defaultValue.
 *   4. 没有命中映射的字段保留原样, promote 走代码内默认路径.
 *
 * 安全:
 *   - 不执行 eval / Function 构造, 不执行 transformRule 中的任意 JS.
 *   - 只支持预定义的白名单变换 (UPPER / LOWER / TRIM / DATE / JSON_PATH / MAP).
 *   - 不熟悉的 transformRule 直接跳过, 不会让 promote 因为映射规则错而 500.
 */

import { Injectable, Logger } from '@nestjs/common';
import { IntegrationFieldMapping } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ApplyResult {
  payload: Record<string, unknown>;
  /** 实际生效的映射条数, 给审计 / 日志 用 */
  appliedCount: number;
  /** 哪些字段被强制设置为 defaultValue (上游没传) */
  defaulted: string[];
}

@Injectable()
export class FieldMappingResolverService {
  private readonly logger = new Logger('FieldMappingResolver');

  /** 缓存 (sourceId, targetModel) -> mappings. TTL 60s. */
  private readonly cache = new Map<
    string,
    { mappings: IntegrationFieldMapping[]; expiresAt: number }
  >();
  private readonly ttlMs = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async applyToPayload(
    sourceId: string | undefined,
    targetModel: string,
    payload: Record<string, unknown>,
  ): Promise<ApplyResult> {
    if (!sourceId) {
      return { payload, appliedCount: 0, defaulted: [] };
    }
    const mappings = await this.getMappings(sourceId, targetModel);
    if (mappings.length === 0) {
      return { payload, appliedCount: 0, defaulted: [] };
    }

    const next: Record<string, unknown> = { ...payload };
    let applied = 0;
    const defaulted: string[] = [];

    for (const m of mappings) {
      // 上游字段名 (externalField) -> 本地字段名 (localField).
      // 如果 externalField 已存在, 把值搬到 localField.
      // 如果不存在但 isRequired + defaultValue 非空, 使用 defaultValue.
      const has = Object.prototype.hasOwnProperty.call(next, m.externalField);
      let value: unknown = has ? next[m.externalField] : undefined;
      if (!has) {
        if (m.defaultValue !== null && m.defaultValue !== undefined && m.defaultValue !== '') {
          value = m.defaultValue;
          defaulted.push(m.localField);
        } else if (m.isRequired) {
          // 必填但上游没传, 不主动报错 — 让 promote 自己的 MISSING_REQUIRED_FIELDS
          // 校验决定怎么处理.
          continue;
        } else {
          continue;
        }
      }

      // 应用 transformRule (白名单)
      if (m.transformRule) {
        try {
          value = this.applyTransform(value, m.transformRule);
        } catch (err) {
          this.logger.warn(
            `transformRule "${m.transformRule}" failed for ${m.externalField} -> ${m.localField}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          // 失败时保留原值, 不抛
        }
      }

      next[m.localField] = value;
      // 仅当不同名时移除原字段 (有些上游已经用了 localField 同名,
      // 这种情况 externalField === localField, 不需要 delete)
      if (m.externalField !== m.localField && has) {
        delete next[m.externalField];
      }
      applied += 1;
    }

    return { payload: next, appliedCount: applied, defaulted };
  }

  /* ----------------------------------------------------------------- */

  private async getMappings(
    sourceId: string,
    targetModel: string,
  ): Promise<IntegrationFieldMapping[]> {
    const key = `${sourceId}::${targetModel}`;
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.mappings;
    const rows = await this.prisma.integrationFieldMapping.findMany({
      where: { sourceId, targetModel, isActive: true },
    });
    this.cache.set(key, { mappings: rows, expiresAt: now + this.ttlMs });
    return rows;
  }

  /** 给运维 / API 用, 清缓存便于即时观察新配置生效. */
  invalidateCache(): void {
    this.cache.clear();
  }

  /* ----------------------------------------------------------------- */
  /*  Whitelisted transforms                                             */
  /* ----------------------------------------------------------------- */

  private applyTransform(value: unknown, rule: string): unknown {
    const trimmed = rule.trim();
    if (!trimmed) return value;

    // 单 token 变换
    if (trimmed === 'UPPER') {
      return value == null ? value : String(value).toUpperCase();
    }
    if (trimmed === 'LOWER') {
      return value == null ? value : String(value).toLowerCase();
    }
    if (trimmed === 'TRIM') {
      return value == null ? value : String(value).trim();
    }

    // 带参数的: KIND:arg
    const colon = trimmed.indexOf(':');
    if (colon < 0) {
      return value; // 未知规则, 静默跳过
    }
    const kind = trimmed.slice(0, colon).trim().toUpperCase();
    const arg = trimmed.slice(colon + 1);

    if (kind === 'DATE') {
      // DATE:yyyy-MM-dd | DATE:iso
      if (value == null) return value;
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return value;
      if (arg.toLowerCase() === 'iso') return d.toISOString();
      // 用户给的格式我们不全实现, 只支持 yyyy-MM-dd
      return d.toISOString().slice(0, 10);
    }

    if (kind === 'JSON_PATH') {
      // JSON_PATH:$.foo.bar  — 仅支持 dot-path, 不支持数组索引 / 通配
      if (value == null) return value;
      let cur: unknown = value;
      // 容忍 `$.foo.bar` 或 `foo.bar`
      const path = arg.replace(/^\$\.?/, '');
      const segs = path.split('.').filter((s) => s.length > 0);
      for (const seg of segs) {
        if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[seg];
        } else {
          return undefined;
        }
      }
      return cur;
    }

    if (kind === 'MAP') {
      // MAP:k1=v1;k2=v2;k3=v3
      if (value == null) return value;
      const table = new Map<string, string>();
      for (const pair of arg.split(';')) {
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        table.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
      const mapped = table.get(String(value));
      return mapped === undefined ? value : mapped;
    }

    // 未知规则 — 不抛错
    return value;
  }
}
