# clinical_access_scope_v4_remove_fixed_nurse

本补丁处理试点前最严重的访问域阻塞项：彻底移除固定护士身份，统一 JWT 当前用户、医院租户和患者对象级授权。

## 核心变化

### 1. 当前用户上下文来自 JWT + 数据库

`AuthService.verifyAccessToken()` 每次从数据库重新读取用户，并在 `RequestUser` 中提供：

```ts
id
username
displayName
role
hospitalTenantId
```

前端传入的 `nurseId`、`tenantId`、`hospitalTenantId`、`assigneeId`、`handledBy`、`operatorId` 等字段不能再作为授权依据。普通用户伪造这些字段会被忽略或覆盖为 JWT 当前用户。

### 2. 新增中央访问控制

新增：

```ts
ClinicalAccessScopeService
ClinicalAccessScopeGuard
```

中央服务提供并实际接入：

```ts
assertPatientVisible(user, patientId)
assertPatientWritable(user, patientId)
assertTaskVisible(user, taskId)
assertAlertVisible(user, alertId)
buildPatientScope(user, hospitalTenantId?)
buildTaskScope(user, hospitalTenantId?)
```

覆盖患者、指标、用药、问卷、随访、任务、风险预警、报告、时间线、院内就诊记录、病历摘要、检查报告、院内处方、HIS 查询与导出、微信随访、H5、绑定审核、慢病提醒中心和护士工作台。

### 3. 护士与管理员规则

当前数据库还没有护理组表，因此本补丁采用安全且可运行的第一版规则：

- `ADMIN`：单个跨院对象允许直接访问，并写跨租户审计；列表默认当前医院。列表跨院查看必须显式传目标 `hospitalTenantId`，并写 `ADMIN_TENANT_SCOPE_SELECTED` 审计。
- `MANAGER`：本院只读。
- `DOCTOR`：本院可读写。
- `NURSE`：可读取本院分配给自己以及尚未分配的患者；只能修改明确分配给自己的患者。
- 新患者若没有责任护士，保留 `responsibleNurseId = null`，进入护士工作台的 `pendingAllocationPatients` 队列。

未来加入护理组模型后，只需要在 `ClinicalAccessScopeService` 内扩展护理组 predicate，不需要每个模块重新写权限逻辑。

### 4. 移除固定 Demo 护士

- 运行时代码、前端、种子数据以及旧 seed patcher 均不再出现历史固定护士 ID。
- 新 Demo 护士 ID 为 `demo-care-nurse-a`。
- 附带 `prisma/rekey-legacy-demo-nurse.js`：将已有数据库中的旧 Demo 用户和所有字符串引用安全迁移到新 ID。
- 自动生成任务没有责任护士时保持未分配，不再 fallback。

### 5. 防止关联对象串线与辅助入口泄漏

对象级校验不只检查 URL：

- standalone 院内记录接口校验 body 中的 `patientId`；
- 手工任务关联的风险预警必须属于同一患者；
- 风险预警关联的指标必须属于同一患者；
- 院内处方关联的就诊记录必须属于同一患者；
- HIS 条码查询与导出使用当前登录用户患者 scope，不再做全局 Patient 表查询；
- 患者绑定申请列表与审核按患者 scope 过滤；
- 患者端身份查询至少要求手机号 + 院内号或身份证后四位，避免单字段枚举。

### 6. 无法安全推断医院归属的表采用 fail closed

`ChronicLead` 和 `IntegrationSource` 当前 schema 没有 `hospitalTenantId` 或可靠 source-to-tenant 映射。本补丁不会伪造归属规则：

- 员工端 `chronic-leads` HTTP 接口暂时限制为 `ADMIN`；
- `ChronicLead.sign()` 暂时拒绝升档建档，避免产生无租户 Patient；
- 全局接口中心 `integrations` 暂时限制为 `ADMIN`。

下一步应为这两类数据增加医院归属迁移，再恢复医院内角色访问。

## 应用方式（WSL，仓库根目录）

```bash
ZIP="/mnt/c/Users/leoxi/Downloads/clinical_access_scope_v4_remove_fixed_nurse_patch.zip"
TMP="/tmp/clinical_access_scope_v4_remove_fixed_nurse_patch"
rm -rf "$TMP"
mkdir -p "$TMP"
unzip -q "$ZIP" -d "$TMP"
rsync -av "$TMP/" ./

python3 scripts/apply_clinical_access_scope_v4.py
node scripts/assert-clinical-access-scope-v4.js

cd apps/api
npx prisma generate

# 已有数据库必须执行；全新数据库会提示没有存量需要迁移。
node prisma/rekey-legacy-demo-nurse.js --dry-run
node prisma/rekey-legacy-demo-nurse.js

# 重新 seed，确保 Demo 用户、医院和第二医院越权 smoke 数据一致。
node prisma/seed-all.js
```

## 启动与验证

终端 1：

```bash
cd apps/api
npm run start:dev
```

终端 2（API 启动完成后）：

```bash
cd apps/api
node prisma/smoke-clinical-access-scope-v4.js

cd ../web
npm run build
```

黑盒 smoke 覆盖：

| 场景 | 预期 |
|---|---|
| 医院 A 护士读取医院 B 患者 | 403 或防枚举 404 |
| 医院 A 护士写医院 B 用药路径 | 拒绝 |
| 医院 A 护士通过 body 创建医院 B 院内记录 | 拒绝 |
| 医院 A 护士用 HIS 条码查询医院 B 患者 | 不返回本地 Patient 数据 |
| 医院 A 护士查看或审核医院 B 绑定申请 | 列表隐藏；写操作拒绝 |
| 篡改 `nurseId` 请求护士工作台和 work-items | 服务端忽略，仍使用 JWT 当前护士 |
| 篡改建档 `hospitalTenantId` 与 `responsibleNurseId` | 服务端忽略；新患者进入待分配队列 |
| 护士查看待分配患者 | 允许 |
| 护士修改待分配患者 | 拒绝，必须先经过分配流程 |
| 管理员默认打开患者列表 | 只显示本院 |
| 管理员显式切换 `hospitalTenantId` | 允许跨院列表，并写审计 |
| 管理员跨医院读取和创建任务 | 允许，并写跨租户审计 |
| 普通护士访问尚未多租户化的线索池 | 拒绝 |
| 患者端只提交单个识别字段查询 | 拒绝返回患者快照 |

## 本地生成环境验证

已执行：

- `node scripts/assert-clinical-access-scope-v4.js`
- 三个新增 JS 脚本 `node --check`
- 所有 API / Web TS 与 TSX 文件使用 TypeScript `transpileModule` 做语法检查
- 在全新快照上解压、`rsync`、重复执行两次 patcher，再次运行静态校验和 overlay 一致性校验

由于生成沙箱没有你的 Postgres、完整 `node_modules` 和正在运行的 Nest API，数据库 rekey、HTTP 黑盒 smoke、Prisma 语义生成与前端正式构建需要你按上面的命令在 WSL 中执行。
