# Overview fullscreen patch

新增运营总览一键全屏功能。

改动：
- `apps/web/src/pages/OverviewPage.tsx`
  - 新增 Fullscreen API 控制逻辑。
  - 运营总览右上角新增“一键全屏 / 退出全屏”按钮。
  - 全屏时只放大运营驾驶舱区域，不影响护士工作台、患者档案、患者详情页。
- `apps/web/src/index.css`
  - 新增全屏按钮与全屏驾驶舱样式。

应用：

```bash
cd ~/chronic-care-platform

ZIP="$HOME/Downloads/chronic_care_overview_fullscreen_patch.zip"
TMP="/tmp/chronic_care_overview_fullscreen_patch"

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

使用：
- 打开运营总览。
- 点击右上角“一键全屏”。
- 点击“退出全屏”或按 `Esc` 退出。
