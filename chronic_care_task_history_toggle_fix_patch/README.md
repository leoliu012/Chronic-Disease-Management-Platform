# Task history toggle fix patch

目的：修复患者详情页“待办任务”区域没有独立历史任务开关的问题。

修复内容：
- 在 `PatientDetailPage` 的“新增任务 / 待办任务”区域下方增加“当前待办任务”列表。
- 默认只显示 `PENDING` / `IN_PROGRESS` 任务。
- 增加“显示已完成/已取消任务”开关，用于查看 `DONE` / `CANCELED` 历史任务。
- 在任务卡片中保留“开始处理 / 完成任务 / 取消任务”操作按钮。
- 不改后端、不新增 migration，只补前端显示逻辑和样式。

应用：

```bash
cd ~/chronic-care-platform

ZIP="$HOME/Downloads/chronic_care_task_history_toggle_fix_patch.zip"
TMP="/tmp/chronic_care_task_history_toggle_fix_patch"

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

验证：
1. 进入患者详情页。
2. 找到“新增任务”区域。
3. 下方应出现“当前待办任务”。
4. 完成或取消任务后，该任务默认隐藏。
5. 打开“显示已完成/已取消任务”后，历史任务重新显示。
