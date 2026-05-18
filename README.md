# Timeline visibility frontend connect patch

目的：只补功能，不重做 UI。

修复内容：
- PatientDetailPage 增加“显示全部历史记录”开关。
- 默认隐藏 DONE/CANCELED 任务和 RESOLVED/DISMISSED 风险预警。
- PatientDetailPage 增加开发环境“清理测试流水”按钮，调用 `DELETE /dev-tools/test-data?patientId=...`。
- 保留患者主档案和慢病档案，仅清理健康指标、风险预警、任务和随访记录。
- 修复当前 PatientDetailPage 里的重复 textarea 和重复 setSavingDiseaseProfile(false)。
- main.tsx 引入 timeline-cleanup-fixes.css，但 previous-style-lock.css 仍然最后导入，继续锁定旧医院 UI 风格。

应用：

```bash
cd ~/chronic-care-platform

ZIP="$HOME/Downloads/timeline_visibility_frontend_connect_patch.zip"
TMP="/tmp/timeline_visibility_frontend_connect_patch"

rm -rf "$TMP"
mkdir -p "$TMP"
unzip -q "$ZIP" -d "$TMP"

rsync -av "$TMP/" ./
```

检查：

```bash
cd ~/chronic-care-platform/apps/web
npm run build
npm run dev
```
# Chronic-Disease-Management-Platform
