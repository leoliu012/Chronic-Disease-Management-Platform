# 智慧慢病管理平台患者端微信原生小程序

这是患者端微信原生小程序 MVP，直接对接当前 NestJS 后端。

## 已实现页面

- 首页：患者概览、今日待办、待办数、风险预警、快捷入口
- 录入：血压、血糖、血氧、心率、体重上报
- 用药：用药计划、今日用药打卡、漏服上报、最近打卡记录
- 问卷：月度健康问卷、症状开关、风险评分、历史问卷
- 记录：健康指标记录、风险预警列表
- 提醒：护士随访/异常复测/问卷复核/用药随访待办，支持显示历史提醒
- 绑定：患者 ID 绑定、HIS 模拟查询

## 对接的后端接口

- `GET /patients/:id`
- `GET /his/patients/barcode/:barcode`
- `POST /patients/:patientId/vital-records`
- `GET /patients/:patientId/vital-records`
- `GET /patients/:patientId/risk-alerts`
- `GET /patients/:patientId/tasks`
- `POST /patients/:patientId/medications`
- `GET /patients/:patientId/medications`
- `GET /patients/:patientId/medication-check-ins`
- `POST /medications/:id/check-ins`
- `POST /patients/:patientId/questionnaire-results`
- `GET /patients/:patientId/questionnaire-results`

## 开发说明

- 默认 API 地址：`http://127.0.0.1:3000`
- 真机调试需要改成电脑局域网 IP
- 本地开发需要在微信开发者工具中关闭合法域名校验
- 目前不包含登录鉴权，适合演示 MVP；正式上线前需要接入微信登录、患者身份绑定审核和权限校验
