# hospital-records-seed-patch (诊断升级版)

UI 仍显示 `就诊记录 (0) 病历摘要 (0) 检查报告 (0) 院内处方 (0)`,
说明前端 `Promise.all` 拿到的四个数组都是空。可能原因有 4 个,
这个补丁给每个都加了能直接看到答案的诊断手段。

## 改动

| 文件 | 改动 |
|---|---|
| `apps/api/prisma/seed-all.js` | 4 个 `createMany` 改为 try/catch + 立即 `count()` + 按 `demo-patient-001` 反查验证 |
| `apps/api/prisma/check-hospital-records.js` | **新增**: 独立诊断脚本, 无副作用, 直接查 DB |

## 应用补丁

```bash
ZIP="$HOME/Downloads/hospital_records_seed_patch.zip"
TMP="/tmp/hospital_records_seed_patch"
rm -rf "$TMP"
mkdir -p "$TMP"
unzip -q "$ZIP" -d "$TMP"
rsync -av "$TMP/" ./
```

## 三步排查

### 步骤 1 — 重跑 seed, 看带验证的输出

```bash
cd apps/api
node prisma/seed-all.js
```

补丁后, seed 结尾会逐张表打印类似:

```
  ✓ EncounterRecord (就诊记录): createMany returned count=11, total in DB=11
  ✓ MedicalRecordSummary (病历摘要): createMany returned count=7, total in DB=7
  ✓ ExamReportRecord (检查报告): createMany returned count=10, total in DB=10
  ✓ HospitalMedicationOrder (院内处方): createMany returned count=14, total in DB=14
  ✓ Verify demo-patient-001 (王建国): enc=3 medrec=2 exam=2 rx=3
```

- **如果看到 `✗ ... createMany FAILED`**: 直接看错误信息, 90% 是字段长度 / 枚举值 / FK 不匹配。
- **如果 `Verify 王建国` 的数字都是 0**: 之前的 patch 没被应用 (`encounterSeeds` 数组没注入)。请确认 `rsync` 真的覆盖了 `apps/api/prisma/seed-all.js`, 并且文件里有 `const encounterSeeds = [` 这一行。
- **如果数字都对**: DB 是好的。问题在 API / 前端层, 进入步骤 2。

### 步骤 2 — 直接查 DB 复核

```bash
cd apps/api
node prisma/check-hospital-records.js
```

会打印每个 demo 患者下 4 张表的行数。例如:

```
  patientId            name        enc  medrec  exam  rx
  ──────────────────────────────────────────────────────────
  demo-patient-001  王建国          3       2     2   3
  demo-patient-002  李秀兰          2       2     2   4
  ...
```

- **如果这里数字对**: DB 没问题, 直接进入步骤 3。
- **如果这里全是 0**: seed 真的没成功, 回看步骤 1 的错误日志。

### 步骤 3 — 浏览器 DevTools 看实际请求

打开浏览器, 进入 `患者详情 → 院内病历` Tab, 然后 **F12 → Network**, 过滤 `/patients/`, 关注这四条:

```
GET /patients/demo-patient-001/encounter-records
GET /patients/demo-patient-001/medical-record-summaries
GET /patients/demo-patient-001/exam-reports
GET /patients/demo-patient-001/hospital-medications
```

可能的现象:

| 现象 | 含义 | 修复 |
|---|---|---|
| 全部 `200 OK`, 响应体 `[]` | 调用到的 patientId 跟 seed 里的不一致 | 检查 URL bar 的 patientId 是不是 `demo-patient-001` 而不是 `MZ20260519001` |
| 全部 `200 OK`, 响应体非空, 但 UI 还是 0 | 前端组件 state 没刷新 | 清浏览器缓存 / 硬刷新 |
| 任何一个 `401` | 登录过期 | 重新登录 |
| 任何一个 `403` | 当前账号没权限 | 用 `admin/admin123` 试 |
| 任何一个 `404` | 后端没启动 / 没注册 PatientsModule 路由 | `cd apps/api && npm run start:dev`, 看启动日志里这 4 条路由有没有被映射 |
| 任何一个 `500` | 后端报错 | 看 apps/api 控制台日志 |

NestJS 启动时会打印每条路由, 类似:

```
[RouterExplorer] Mapped {/patients/:id/encounter-records, GET} route
```

如果看不到这 4 行, 说明 `PatientsController` 没成功注册——这个补丁不修这种情况, 但 `src/patients/patients.controller.ts` 已经有这 4 个 `@Get` 装饰器, 正常情况下应该是 OK 的。

## 一句话总结

之前的补丁把数据塞进了 `seed-all.js`, 但没有 **验证它们真的进了 DB**, 也没有
告诉你 **进了 DB 之后, API 是不是真的返回它们**。这个补丁把这两件事都摆到台面上,
让你三步内定位到具体是哪一层出了问题。
