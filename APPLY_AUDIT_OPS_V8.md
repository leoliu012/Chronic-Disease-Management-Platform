# audit_ops_v8_medical_audit_and_operations_center

本补丁完成两个试点前 P0/P1 基础设施增强：

1. 将 Audit 从 `matchAuditRoute(method, path)` 正则分支升级为 decorator metadata 策略；
2. 新增管理员专用「系统健康 / 运维中心」。

三高共管 CarePlan 不混入本补丁，单独见：

```text
PR8_HYPERTENSION_DIABETES_CAREPLAN_PILOT.md
```

---

## 1. 医疗级审计策略

### 新增 `@Audit()`

```ts
@Audit({
  action: 'UPDATE_MEDICATION_PLAN',
  target: 'MedicationRecord',
  targetIdFrom: 'params.id',
  patientIdFrom: 'response.patientId',
})
```

`AuditInterceptor` 不再匹配 path 正则，只读取 handler / controller metadata。

### 标准审计 envelope

每条 decorator 审计至少记录：

```text
operatorId
action
targetType
targetId
ipAddress
outcome: SUCCESS / FAILURE
method
path
statusCode
patientId（可解析时）
```

只允许通过 `detailsFrom` 显式提取少量标量字段。不会把 request body、病历正文、处方正文、
问卷答案、H5 token、API key secret 或 payload 整包复制到 `AuditLog`。

### 拒绝访问也写审计

`ClinicalAccessScopeGuard` 捕获对象级授权拒绝，并记录：

```text
<业务动作>_DENIED
```

没有 `@Audit()` metadata 的授权拒绝记录为：

```text
CLINICAL_ACCESS_DENIED
```

### 已覆盖动作

- 患者详情、临床时间线；
- 院内就诊记录、病历摘要、检查报告、院内处方的列表和详情读取；
- HIS 患者导出；
- 用药计划创建、更新、停用；
- 指标监测计划创建、更新、停用；
- 患者问卷、指标复测、服药打卡、到院随访发送；
- H5 链接失效；
- 患者消息再次发送；
- 任务创建、开始处理、处理轨迹追加、完成、状态修改、取消；
- 风险预警进入处理中、结案、忽略；
- 临床规则初始化与修改；
- 网关 API key 签发与撤销；
- 网关审计报告 CSV 导出；
- Worker 人工运行、恢复和 replay；
- dev-tools 测试数据清理；
- 既有 `ADMIN_CROSS_TENANT_READ / WRITE` 跨医院审计继续保留。

说明：少量领域服务内部事件仍然保留，例如跨医院授权判断、患者触达渠道结果和 Worker 修复。
它们与 decorator 标准 envelope 分工不同，不依赖 path matcher。

---

## 2. 系统健康 / 运维中心

### 公共探针

```http
GET /health/live
GET /health/ready
```

`/health/live` 只表示 Nest 进程存活。

`/health/ready` 检查：

```text
PostgreSQL
Redis PING
```

任一依赖异常时返回 HTTP 503。

### 管理员聚合接口

```http
GET /admin/ops/summary
GET /admin/ops/reminder-worker
GET /admin/ops/gateway
GET /admin/ops/data-integrity
```

全部限制为：

```ts
@Roles(UserRole.ADMIN)
```

### 管理员页面

侧边栏新增：

```text
系统健康
运维状态 / 异常核验
```

页面路由：

```text
/admin/ops
```

展示：

- API、DB、Redis 就绪状态；
- Worker 最近一次成功运行时间；
- 最近 24 小时 generated / dispatched / dispatchFailed / missed / escalated；
- Worker heartbeat、等待重试、长期 SENDING；
- 网关冲突、重试耗尽、待重试、失败批次；
- SLA 超时任务；
- orphan alerts；
- open episode 无 Task；
- 无来源 schedule；
- 重复 schedule；
- 重复外部记录；
- 无责任护士患者；
- 无医院归属患者；
- 即将过期与已过期但仍 ACTIVE 的 H5 链接；
- 最近跨医院访问、API key 管理和人工 replay 高风险留痕。

页面每 30 秒自动刷新，也支持手动刷新。

---

## 应用方式

在 WSL 仓库根目录执行：

```bash
cd ~/Dev/Chronic-Disease-Management-Platform

ZIP="/mnt/c/Users/leoxi/Downloads/audit_ops_v8_medical_audit_operations_center_patch.zip"
TMP="/tmp/audit_ops_v8_medical_audit_operations_center_patch"

rm -rf "$TMP"
mkdir -p "$TMP"
unzip -q "$ZIP" -d "$TMP"
rsync -av "$TMP/" ./

python3 scripts/apply_audit_ops_v8.py
node scripts/assert-audit-ops-v8.js
```

本补丁不修改 Prisma schema，不需要 migration，不需要重新 seed。

---

## 构建

```bash
cd ~/Dev/Chronic-Disease-Management-Platform/apps/api
npm run build

cd ../web
npm run build
```

---

## 启动

确保 PostgreSQL 和 Redis 已运行：

```bash
cd ~/Dev/Chronic-Disease-Management-Platform/apps/api
docker compose up -d
npm run start:dev
```

---

## 黑盒 smoke

另开一个 WSL 终端：

```bash
cd ~/Dev/Chronic-Disease-Management-Platform/apps/api
node prisma/smoke-audit-ops-v8.js
```

该脚本验证：

```text
GET /health/live
GET /health/ready
管理员登录
GET /admin/ops/summary
GET /admin/ops/reminder-worker
GET /admin/ops/gateway
GET /admin/ops/data-integrity
GET /patients
GET /patients/:id 后 VIEW_PATIENT_DETAIL 写入 AuditLog
VIEW_PATIENT_LIST 写入 AuditLog
```

---

## 手工验证健康探针

```bash
curl -sS http://localhost:3000/health/live | python3 -m json.tool
curl -sS http://localhost:3000/health/ready | python3 -m json.tool
```

---

## 手工验证管理员接口

```bash
LOGIN_JSON="$(curl -sS -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}')"

export ADMIN_TOKEN="$(
  printf '%s' "$LOGIN_JSON" |
  python3 -c 'import json, sys; print(json.load(sys.stdin)["accessToken"])'
)"

curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/ops/summary \
  | python3 -m json.tool
```

浏览器打开：

```text
http://localhost:5173/admin/ops
```

---

## 检查改动

```bash
cd ~/Dev/Chronic-Disease-Management-Platform

git diff --stat
git diff -- apps/api/src apps/api/prisma/smoke-audit-ops-v8.js apps/web/src
```

---

## 提交

```bash
cd ~/Dev/Chronic-Disease-Management-Platform

git add \
  apps/api/src \
  apps/api/prisma/smoke-audit-ops-v8.js \
  apps/web/src \
  scripts/apply_audit_ops_v8.py \
  scripts/assert-audit-ops-v8.js \
  APPLY_AUDIT_OPS_V8.md \
  PR8_HYPERTENSION_DIABETES_CAREPLAN_PILOT.md

git commit -m "feat(platform): add decorator audit policy and admin operations center"
```

---

## 验证边界

生成环境已执行：

- `node scripts/assert-audit-ops-v8.js`
- 新增 JS 脚本 `node --check`
- 修改后的 TS / TSX 文件使用 TypeScript `transpileModule` 做语法检查；
- patcher 在干净源码快照上重复执行，验证幂等；
- overlay 内容校验。

仍需在你的 WSL 环境执行：

- API `npm run build`
- Web `npm run build`
- 真实 PostgreSQL / Redis readiness
- `node prisma/smoke-audit-ops-v8.js`
- 浏览器视觉检查
