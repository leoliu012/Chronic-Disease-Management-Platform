# Overview dashboard + previous China hospital business pages patch

作用：
- 总览页 `OverviewPage.tsx` 保持深色中国医院慢病中心数据驾驶舱风格。
- 护士工作台、患者档案、患者详情页恢复/保持之前的中国医院浅色业务系统风格。
- 修复 `alertResolvedRate is declared but its value is never read`。
- 补齐 `hospital-shell / hospital-sidebar / topbar` 等布局样式，避免页面退回默认 HTML 样式。

应用：

```bash
cd ~/chronic-care-platform

ZIP="$HOME/Downloads/overview_dashboard_keep_business_hospital_style_patch.zip"
TMP="/tmp/overview_dashboard_keep_business_hospital_style_patch"

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
