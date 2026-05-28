-- gateway_production_hardening migration
--
-- 1. 每家医院/每个系统一个 API key (GatewayApiKey)
--    - 配合 IP 白名单做 等保 / 三级等保 "权责对应、留痕可追溯"
--    - 旧的 GATEWAY_API_KEY 环境变量作为单机 dev fallback, 仍然可用
--
-- 2. 推进重试 / 退避字段
--    - 给 IntegrationSyncRecord 增加 promotionAttempts / nextRetryAt /
--      lastFailedAt / lastFailureReason, 让 GatewayPromotionWorker 能做
--      指数退避 + 告警耗尽
--
-- 3. 注意: 没有动既有列/索引, 全部都是新增列 + 新表; 重跑安全

-- ── 1. GatewayApiKey ──────────────────────────────────────────────────────
CREATE TABLE "GatewayApiKey" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "description" TEXT,
    "ipAllowlist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,

    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokedReason" TEXT,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewayApiKey_pkey" PRIMARY KEY ("id")
);

-- prefix is what's visible in the header & admin UI; must be globally unique
-- to make lookup O(1) on the hot path
CREATE UNIQUE INDEX "GatewayApiKey_prefix_key" ON "GatewayApiKey"("prefix");

-- Hot-path queries:
--   - "list active keys for source X" -> sourceId + revokedAt
--   - "find by prefix" already covered by the unique index
CREATE INDEX "GatewayApiKey_sourceId_revokedAt_idx"
    ON "GatewayApiKey"("sourceId", "revokedAt");

-- FK to IntegrationSource. Restrict so we can never orphan keys.
ALTER TABLE "GatewayApiKey"
    ADD CONSTRAINT "GatewayApiKey_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "IntegrationSource"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── 2. IntegrationSyncRecord retry metadata ──────────────────────────────
ALTER TABLE "IntegrationSyncRecord"
    ADD COLUMN "promotionAttempts"   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "nextRetryAt"         TIMESTAMP(3),
    ADD COLUMN "lastFailedAt"        TIMESTAMP(3),
    ADD COLUMN "lastFailureReason"   TEXT;

-- Hot path for the retry worker: "give me everything that's failed,
-- still has attempts left, and is past its backoff".
CREATE INDEX "IntegrationSyncRecord_promotionStatus_nextRetryAt_idx"
    ON "IntegrationSyncRecord"("promotionStatus", "nextRetryAt");
