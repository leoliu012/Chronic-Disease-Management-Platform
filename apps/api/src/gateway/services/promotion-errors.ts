/**
 * promotion-errors.ts
 *
 * IntegrationPromoteService 在 promote 一条 IntegrationSyncRecord 时
 * 可能抛出两类“非崩溃”错误：
 *
 *   - PromotionConflictError — 数据本身没问题，但与本地主数据存在歧义
 *     （例如同院内号映射到不同身份证 / 患者尚未登记），
 *     需要管理员或护士在【接口中心 · 冲突】队列里人工核验。
 *   - PromotionUnsupportedError — 我们暂时不支持的资源类型，
 *     不视为生产事故，直接打到 FAILED 状态等下一版扩展。
 *
 * 真正的崩溃（数据库挂、JSON 烂等）会被外层 catch 成 FAILED + errorMessage。
 */

export type PromotionConflictReason =
  | 'PATIENT_NOT_FOUND'
  | 'PATIENT_IDENTITY_MISMATCH'
  | 'DUPLICATE_PROMOTION_TARGET'
  | 'MISSING_REQUIRED_FIELDS';

export class PromotionConflictError extends Error {
  readonly reason: PromotionConflictReason;
  readonly hint?: Record<string, unknown>;

  constructor(reason: PromotionConflictReason, message: string, hint?: Record<string, unknown>) {
    super(message);
    this.name = 'PromotionConflictError';
    this.reason = reason;
    this.hint = hint;
  }
}

export class PromotionUnsupportedError extends Error {
  constructor(public readonly resourceType: string) {
    super(`Unsupported resource type for promote: ${resourceType}`);
    this.name = 'PromotionUnsupportedError';
  }
}
