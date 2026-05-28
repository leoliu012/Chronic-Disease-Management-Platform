# Gateway Production Hardening Patch

针对 `apps/api/src/gateway/*` 数据接入网关的一组**可直接 rsync 落地**的生产硬化补丁.

## 0. 一句话总结

把网关从 "演示能跑" 提升到 "可以拉去医院前置机做等保评审" — 多租户 API key + IP 白名单 + 真实 SQL Server / Oracle 适配器 + 失败重试 worker + 审计报表 + 出院随访任务自动生成 + IntegrationFieldMapping 动态生效 + FHIR DiagnosticReport 解析.

---

## 1. 应用方式

```bash
# 在仓库根目录执行
ZIP="$HOME/Downloads/gateway_production_hardening_patch.zip"
TMP="/tmp/gateway_production_hardening_patch"
rm -rf "$TMP" && mkdir -p "$TMP"
unzip -q "$ZIP" -d "$TMP"
rsync -av "$TMP/" ./

# 让两个不能直接覆盖的文件 (schema.prisma / package.json) 由 idempotent 脚本接管
python3 scripts/apply_gateway_hardening_schema.py
python3 scripts/add_gateway_optional_deps.py

# 装依赖 + 跑迁移
cd apps/api
npm install
npx prisma generate
npx prisma migrate deploy        # 生产/CI
# 或者本地开发:
# npx prisma migrate dev --name gateway_production_hardening

# 启动
npm run start:dev
```

> **rsync 不会删除你已有的文件**, 只会覆盖补丁包内列出的那些. 应用前如果担心,
> 可以先在 git 里 commit 一次干净的工作区, 这样应用完 `git status` / `git diff`
> 一眼能看到所有变更.

---

## 2. 包含的变更

### 2.1 新增文件

```
apps/api/prisma/migrations/20260526120000_gateway_production_hardening/
  └── migration.sql                                      # GatewayApiKey 表 + IntegrationSyncRecord retry 字段

apps/api/src/gateway/
  ├── dto/
  │   ├── api-key.dto.ts                                 # IssueApiKey / Revoke / List DTO
  │   └── audit-report-query.dto.ts                      # 时间窗 + sourceId
  ├── utils/
  │   └── cidr-match.util.ts                             # 零依赖 IPv4/IPv6 CIDR 匹配
  └── services/
      ├── gateway-api-key.service.ts                     # per-source key 签发/校验/吊销
      ├── gateway-audit-report.service.ts                # 4 章节审计报表 + CSV
      ├── gateway-alert.service.ts                       # 通用 JSON webhook + cooldown
      ├── gateway-promotion-worker.service.ts            # 失败重试 worker (退避 60s→1h)
      ├── field-mapping-resolver.service.ts              # IntegrationFieldMapping 动态生效
      ├── intermediate-adapter.factory.ts                # mock / sqlserver / oracle 切换
      ├── sqlserver-intermediate-db.adapter.ts           # 真实 MSSQL 适配器 (mssql 包)
      └── oracle-intermediate-db.adapter.ts              # 真实 Oracle 适配器 (oracledb 包)

apps/api/src/follow-ups/
  ├── discharge-followup-plan.constants.ts               # D+2/D+7/D+14/D+30 模板 + D+3 高风险
  └── discharge-followup-plan-generator.service.ts       # 幂等, fail-safe

scripts/
  ├── apply_gateway_hardening_schema.py                  # idempotent schema.prisma 修补
  └── add_gateway_optional_deps.py                       # idempotent package.json 修补
```

### 2.2 修改的既有文件 (rsync 直接覆盖)

```
apps/api/.env                                            # 追加 hardening 相关环境变量
apps/api/src/gateway/gateway.module.ts                   # 注册所有新 service + adapter factory
apps/api/src/gateway/controllers/gateway-admin.controller.ts  # 新增 api-keys / audit-report / promotion-worker 端点
apps/api/src/gateway/guards/gateway-api-key.guard.ts     # per-source key + IP allowlist + legacy fallback
apps/api/src/gateway/parsers/fhir-to-normalized.mapper.ts # 新增 DiagnosticReport → EXAM_REPORT
apps/api/src/gateway/services/integration-promote.service.ts # field-mapping 接入 + 出院随访挂接 + retry 元数据
apps/api/src/follow-ups/follow-ups.module.ts             # 导出 DischargeFollowupPlanGeneratorService
docs/gateway/README.md                                   # 升级文档
docs/gateway/.env.gateway.example                        # 升级 env sample
```

### 2.3 不直接覆盖的两个文件 (由脚本修补)

| 文件 | 原因 | 修补脚本 |
|---|---|---|
| `apps/api/prisma/schema.prisma` | 1100+ 行, 易出错 | `scripts/apply_gateway_hardening_schema.py` |
| `apps/api/package.json` | 你的依赖列表可能比 dump 新 | `scripts/add_gateway_optional_deps.py` |

两个脚本都是 idempotent, 可以反复运行.

---

## 3. 落地后的验证清单

```bash
# 1. 表结构有 GatewayApiKey
psql $DATABASE_URL -c "\d \"GatewayApiKey\""

# 2. IntegrationSyncRecord 多了 4 个 retry 字段
psql $DATABASE_URL -c "\d \"IntegrationSyncRecord\"" | grep -E 'promotionAttempts|nextRetryAt|lastFailedAt|lastFailureReason'

# 3. 服务能起 (不需要装 mssql / oracledb)
cd apps/api && npm run start:dev
# 看到这行说明 retry worker 接上了:
#   [GatewayPromotionWorker] Promotion worker scheduled (interval=60000ms, maxAttempts=6, batch=50).

# 4. Admin 端 health 接口
curl -H "Authorization: Bearer $JWT" http://localhost:3000/gateway/admin/health | jq

# 5. 签一把 per-source key
curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"sourceId":"<某 IntegrationSource.id>","description":"测试","ipAllowlist":["127.0.0.1/32"]}' \
  http://localhost:3000/gateway/admin/api-keys | jq

# 6. 拿这把 key 去调 FHIR 接口
curl -X POST -H "X-Gateway-Api-Key: gwk_<返回的 prefix>_<返回的 secret>" \
  -H "Content-Type: application/json" \
  -d '@docs/gateway/samples/fhir-diagnostic-report.json' \
  http://localhost:3000/gateway/fhir/DiagnosticReport

# 7. 拉一张审计报表
curl -H "Authorization: Bearer $JWT" \
  "http://localhost:3000/gateway/admin/audit-report.csv?from=$(date -u -d '7 days ago' +%FT%TZ)" \
  -o audit.csv && head -50 audit.csv
```

---

## 4. 回滚

如果出问题需要回滚:

```bash
# 1. 数据回滚 (DROP TABLE + ALTER 删字段)
psql $DATABASE_URL <<'SQL'
ALTER TABLE "IntegrationSyncRecord"
  DROP COLUMN IF EXISTS "promotionAttempts",
  DROP COLUMN IF EXISTS "nextRetryAt",
  DROP COLUMN IF EXISTS "lastFailedAt",
  DROP COLUMN IF EXISTS "lastFailureReason";
DROP TABLE IF EXISTS "GatewayApiKey" CASCADE;
DELETE FROM "_prisma_migrations" WHERE migration_name = '20260526120000_gateway_production_hardening';
SQL

# 2. 代码回滚
git checkout HEAD -- apps/api/src/gateway apps/api/src/follow-ups apps/api/prisma/schema.prisma docs/gateway apps/api/.env apps/api/package.json
rm -f apps/api/prisma/migrations/20260526120000_gateway_production_hardening/migration.sql
rmdir apps/api/prisma/migrations/20260526120000_gateway_production_hardening 2>/dev/null
rm -f scripts/apply_gateway_hardening_schema.py scripts/add_gateway_optional_deps.py
```

---

## 5. 落地前的环境检查

| 项目 | 要求 |
|---|---|
| Node.js | ≥ 18 (用了 `globalThis.fetch` / `randomBytes('base64url')`) |
| PostgreSQL | ≥ 13 (用了 `TEXT[]` 数组类型) |
| Prisma | 与 dump 一致即可 (`prisma migrate deploy` 兼容旧版本) |
| `mssql` npm 包 | 仅当 `GATEWAY_INTERMEDIATE_ADAPTER=sqlserver` 时需要 |
| `oracledb` npm 包 | 仅当 `GATEWAY_INTERMEDIATE_ADAPTER=oracle` 时需要; oracledb 6+ 默认 thin 模式不需要 Instant Client |

不需要装 mssql / oracledb 也能跑 — `GATEWAY_INTERMEDIATE_ADAPTER=mock` (默认) 就够 dev 演示.

---

## 6. 没有改动的部分 (避免误解)

- 没有动 `Patient` / `DiseaseProfile` / `VitalRecord` 等业务模型
- 没有动 `IntegrationSyncBatch` 表 (只动了 IntegrationSyncRecord 的列)
- 没有动 `InboundEventService` (FHIR/HIS Event/HL7/中间表入口都没改)
- 没有动 `IntermediatePollerService` 自身 (只换了它注入的 adapter)
- 没有动 `app.module.ts` (FollowUpsModule 已在原 imports 中)
- 没有动 Web 端前端代码
