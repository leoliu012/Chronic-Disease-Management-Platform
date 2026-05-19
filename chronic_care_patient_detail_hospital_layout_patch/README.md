# 患者档案页医院风格整理 Patch

目标：整理患者详情/档案页内部结构，避免所有表格、输入框和功能区同时展开挤在一起。

改动内容：

- 患者档案页新增左侧“患者档案工作区”功能导航。
- 页面按模块拆分为：
  - 患者概览
  - 慢病档案
  - 指标监测
  - 用药计划
  - 随访任务
  - 全流程记录
- 默认只显示“患者概览”，点击左侧模块后才显示对应表单/列表。
- 患者概览增加关键管理状态卡片：慢病档案、待处理预警、当前待办、指标记录、用药计划、问卷记录。
- 新增医院信息系统风格样式：白底、蓝色业务边框、轻量卡片、清晰表单分区。
- 隐藏患者页各模块中的英文模块小标题，避免页面像 AI/SaaS 风格。
- 不改后端、不改数据库、不新增 migration。

## 应用

```bash
cd ~/chronic-care-platform

ZIP="$HOME/Downloads/chronic_care_patient_detail_hospital_layout_patch.zip"
TMP="/tmp/chronic_care_patient_detail_hospital_layout_patch"

rm -rf "$TMP"
mkdir -p "$TMP"
unzip -q "$ZIP" -d "$TMP"

rsync -av "$TMP/" ./
```

## 检查

```bash
cd ~/chronic-care-platform/apps/web
npm run build
npm run dev
```

## 验证

1. 打开任意患者详情页。
2. 页面左侧应出现“患者档案工作区”。
3. 默认显示“患者概览”，不再把所有表单一次性展开。
4. 点击“慢病档案 / 指标监测 / 用药计划 / 随访任务 / 全流程记录”切换模块。
5. 页面整体应保持中国医院信息系统风格，而不是 AI 风格大屏/渐变卡片。
