-- IntegrationPromote — gateway-promote-pipeline
--
-- 在不动既有 IntegrationRecordStatus 枚举的前提下，给 IntegrationSyncRecord
-- 增加四个推进态字段，用来表示「网关已收到但是否已 promote 到正式业务表」：
--
--   promotionStatus :  NOT_REQUIRED | PENDING | PROMOTED | CONFLICT | FAILED
--   promotionMessage:  promote 失败 / 冲突原因（人工核验时给护士看）
--   promotedAt      :  最近一次成功 promote 时间，用于运维查 SLA
--
-- 旧的 status (SUCCESS/FAILED/SKIPPED) 继续表示「审计层是否接收成功」，
-- 不要混在一起。
--
-- IntegrationSource 增加 autoPromote 开关：默认 false（手动 promote），
-- 管理员在【接口中心】里勾选才会让 InboundEventService 在写完审计后
-- 同步调用 IntegrationPromoteService.promoteRecord()。

-- CreateEnum
CREATE TYPE "IntegrationPromotionStatus" AS ENUM (
    'NOT_REQUIRED',
    'PENDING',
    'PROMOTED',
    'CONFLICT',
    'FAILED'
);

-- AlterTable
ALTER TABLE "IntegrationSource"
    ADD COLUMN "autoPromote" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "IntegrationSyncRecord"
    ADD COLUMN "promotionStatus" "IntegrationPromotionStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    ADD COLUMN "promotionMessage" TEXT,
    ADD COLUMN "promotedAt"       TIMESTAMP(3);

-- Backfill: 已经写了 localTargetId 的老记录视为 PROMOTED（保留过往 mock-sync 行为）
UPDATE "IntegrationSyncRecord"
   SET "promotionStatus" = 'PROMOTED',
       "promotedAt"      = "createdAt"
 WHERE "localTargetId" IS NOT NULL
   AND "promotionStatus" = 'NOT_REQUIRED';

-- CreateIndex
CREATE INDEX "IntegrationSyncRecord_promotionStatus_createdAt_idx"
    ON "IntegrationSyncRecord"("promotionStatus", "createdAt");
CREATE INDEX "IntegrationSyncRecord_sourceId_promotionStatus_idx"
    ON "IntegrationSyncRecord"("sourceId", "promotionStatus");
