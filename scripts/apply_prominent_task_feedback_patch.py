#!/usr/bin/env python3
from pathlib import Path
import re
import sys

root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
web_src = root / 'apps' / 'web' / 'src'
side_panel = web_src / 'components' / 'PatientTaskSidePanel.tsx'
api_client = web_src / 'api' / 'client.ts'
feedback_css = web_src / 'operation-feedback.css'

missing = [str(p) for p in [side_panel, api_client, feedback_css] if not p.exists()]
if missing:
    raise SystemExit('Missing required file(s):\n' + '\n'.join(missing) + '\nRun this script from the project root, not from apps/api.')

# ---------- PatientTaskSidePanel.tsx ----------
text = side_panel.read_text()

# The panel should own its prominent feedback dialog. Do not also emit the global top toast from showFeedbackDialog.
text = text.replace(
    "import { api, emitOperationNotice, getApiErrorMessage } from '../api/client';",
    "import { api, getApiErrorMessage } from '../api/client';",
)

if 'type TaskPanelFeedbackDialog' not in text:
    marker = "type TaskProcessingEvent = {\n  id: string;\n  taskId: string;\n  patientId: string;\n  eventType: string;\n  title: string;\n  description?: string | null;\n  sourceType?: string | null;\n  sourceId?: string | null;\n  operatorId?: string | null;\n  electronicSignature?: string | null;\n  createdAt: string;\n};"
    insertion = marker + "\n\ntype TaskPanelFeedbackDialog = {\n  tone: 'success' | 'error' | 'warning' | 'info';\n  title: string;\n  message: string;\n  detail?: string;\n};"
    if marker not in text:
        raise SystemExit('Could not locate TaskProcessingEvent type in PatientTaskSidePanel.tsx')
    text = text.replace(marker, insertion)

if 'function TaskPanelFeedbackModal' not in text:
    modal = r'''
function TaskPanelFeedbackModal({
  feedback,
  onClose,
}: {
  feedback: TaskPanelFeedbackDialog | null;
  onClose: () => void;
}) {
  if (!feedback) return null;

  return (
    <div
      className="task-panel-feedback-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`task-panel-feedback-dialog task-panel-feedback-${feedback.tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="task-panel-feedback-title"
        aria-describedby="task-panel-feedback-message"
      >
        <div className="task-panel-feedback-icon" aria-hidden>
          {feedback.tone === 'success' ? '✓' : feedback.tone === 'warning' ? '!' : feedback.tone === 'info' ? 'i' : '×'}
        </div>
        <div className="task-panel-feedback-content">
          <h3 id="task-panel-feedback-title">{feedback.title}</h3>
          <p id="task-panel-feedback-message">{feedback.message}</p>
          {feedback.detail && <small>{feedback.detail}</small>}
        </div>
        <button className="button task-panel-feedback-confirm" type="button" onClick={onClose} autoFocus>
          我知道了
        </button>
      </div>
    </div>
  );
}

'''
    export_marker = 'export function PatientTaskSidePanel({'
    if export_marker not in text:
        raise SystemExit('Could not locate PatientTaskSidePanel export marker')
    text = text.replace(export_marker, modal + export_marker)

# Ensure dialog state exists once.
if 'const [feedbackDialog, setFeedbackDialog]' not in text:
    state_marker = "  const [processingEventsLoading, setProcessingEventsLoading] = useState(false);"
    if state_marker not in text:
        raise SystemExit('Could not locate processingEventsLoading state')
    text = text.replace(
        state_marker,
        state_marker + "\n  const [feedbackDialog, setFeedbackDialog] = useState<TaskPanelFeedbackDialog | null>(null);",
    )

# If an earlier patch created showFeedbackDialog, remove the global operation toast call from it.
text = re.sub(
    r"  function showFeedbackDialog\(feedback: TaskPanelFeedbackDialog\) \{\n\s*setFeedbackDialog\(feedback\);\n\s*emitOperationNotice\(\{\n\s*type: feedback\.tone,\n\s*title: feedback\.title,\n\s*message: feedback\.message,\n\s*\}\);\n\s*\}",
    "  function showFeedbackDialog(feedback: TaskPanelFeedbackDialog) {\n    setFeedbackDialog(feedback);\n  }",
    text,
)

# Add a fallback bridge: any existing setPanelMessage/setPanelError call becomes a dialog, but not an inline top banner.
if 'task-panel-message-feedback-sync' not in text:
    bridge_marker = "  const [processingEventsLoading, setProcessingEventsLoading] = useState(false);\n  const [feedbackDialog, setFeedbackDialog] = useState<TaskPanelFeedbackDialog | null>(null);"
    if bridge_marker not in text:
        # It may already have locallyClosedTaskIds right after feedbackDialog.
        bridge_marker = "  const [feedbackDialog, setFeedbackDialog] = useState<TaskPanelFeedbackDialog | null>(null);"
    bridge = r'''

  // task-panel-message-feedback-sync: never show success/failure as an inline top notice.
  useEffect(() => {
    const message = panelMessage.trim();
    if (!message) return;
    setFeedbackDialog({ tone: 'success', title: '操作成功', message });
  }, [panelMessage]);

  useEffect(() => {
    const message = panelError.trim();
    if (!message) return;
    setFeedbackDialog({ tone: 'error', title: '操作失败', message });
  }, [panelError]);'''
    text = text.replace(bridge_marker, bridge_marker + bridge, 1)

# Remove old inline top banners under the task-panel header.
text = re.sub(
    r"\n\s*\{panelMessage && <div className=\"notice-success task-panel-notice\" role=\"status\">\{panelMessage\}</div>\}\n\s*\{panelError && <div className=\"notice-error task-panel-notice\" role=\"alert\">\{panelError\}</div>\}\n",
    "\n",
    text,
)

# Render the modal immediately after the panel header. Idempotent.
if '<TaskPanelFeedbackModal feedback={feedbackDialog}' not in text:
    header_close = "      </header>\n\n      <section className=\"task-panel-section"
    if header_close not in text:
        # Sometimes other blocks sit between header and first section.
        header_close = "      </header>\n"
        text = text.replace(header_close, header_close + "\n      <TaskPanelFeedbackModal feedback={feedbackDialog} onClose={() => setFeedbackDialog(null)} />\n", 1)
    else:
        text = text.replace(header_close, "      </header>\n\n      <TaskPanelFeedbackModal feedback={feedbackDialog} onClose={() => setFeedbackDialog(null)} />\n\n      <section className=\"task-panel-section", 1)

# Add warning dialog to requireStarted if it only sets panel error.
text = text.replace(
    "    setPanelError('请先点击“开始处理”，系统才会把后续动作自动归入该任务流程。');\n    return false;",
    "    const message = '请先点击“开始处理”，系统才会把后续动作自动归入该任务流程。';\n    setPanelError(message);\n    setFeedbackDialog({ tone: 'warning', title: '请先开始处理', message });\n    return false;",
)

# Suppress global operation notices from task-panel APIs; the panel modal handles them.
for needle in [
    "headers: {\n            'X-Suppress-Task-Processing-Event': '1',",
    "headers: {\n            'X-Suppress-Operation-Notice': '1',\n            'X-Suppress-Task-Processing-Event': '1',",
]:
    pass

# More targeted replacements avoid touching already-correct blocks.
text = text.replace(
    "headers: {\n            'X-Suppress-Task-Processing-Event': '1',\n          },",
    "headers: {\n            'X-Suppress-Operation-Notice': '1',\n            'X-Suppress-Task-Processing-Event': '1',\n          },",
)
text = text.replace(
    "headers: {\n            'X-Suppress-Task-Processing-Event': '1',\n          },",
    "headers: {\n            'X-Suppress-Operation-Notice': '1',\n            'X-Suppress-Task-Processing-Event': '1',\n          },",
)

# If older close-processing code intentionally removed suppress notice, add it back.
text = re.sub(
    r"headers: \{\n\s*'X-Suppress-Task-Processing-Event': '1',\n\s*\},",
    "headers: {\n            'X-Suppress-Operation-Notice': '1',\n            'X-Suppress-Task-Processing-Event': '1',\n          },",
    text,
)

side_panel.write_text(text)

# ---------- api/client.ts ----------
client = api_client.read_text()
if "const suppressNotice = axiosError.config?.headers?.['X-Suppress-Operation-Notice'];" not in client:
    client = client.replace(
        "    const axiosError = error as AxiosError;\n    if (axiosError.response?.status && axiosError.response.status !== 401) {",
        "    const axiosError = error as AxiosError;\n    const suppressNotice = axiosError.config?.headers?.['X-Suppress-Operation-Notice'];\n    if (!suppressNotice && axiosError.response?.status && axiosError.response.status !== 401) {",
    )
api_client.write_text(client)

# ---------- operation-feedback.css ----------
css = feedback_css.read_text()
# Convert the global operation toast from top-right/page-top into a prominent centered message box.
css = re.sub(
    r"\.operation-toast-host \{[\s\S]*?\n\}",
    ".operation-toast-host {\n  position: fixed;\n  top: 50%;\n  left: 50%;\n  right: auto;\n  z-index: 9999;\n  display: flex;\n  width: min(480px, calc(100vw - 32px));\n  transform: translate(-50%, -50%);\n  flex-direction: column;\n  gap: 12px;\n  pointer-events: none;\n}",
    css,
    count=1,
)
css = re.sub(
    r"\.operation-toast \{[\s\S]*?\n\}",
    ".operation-toast {\n  display: grid;\n  grid-template-columns: 42px 1fr 30px;\n  gap: 12px;\n  align-items: start;\n  border: 1px solid #cbd5e1;\n  border-top-width: 5px;\n  border-radius: 18px;\n  background: #fff;\n  box-shadow: 0 26px 70px rgba(15, 23, 42, 0.26);\n  padding: 16px 16px 16px 14px;\n  pointer-events: auto;\n  animation: operation-toast-in 0.18s ease-out;\n}",
    css,
    count=1,
)
css = css.replace(
    ".operation-toast-success { border-left-color: #059669; }\n.operation-toast-warning { border-left-color: #d97706; }\n.operation-toast-error { border-left-color: #dc2626; }\n.operation-toast-info { border-left-color: #2563eb; }",
    ".operation-toast-success { border-top-color: #059669; }\n.operation-toast-warning { border-top-color: #d97706; }\n.operation-toast-error { border-top-color: #dc2626; }\n.operation-toast-info { border-top-color: #2563eb; }",
)
css = css.replace(
    "  from { opacity: 0; transform: translateY(-8px); }\n  to { opacity: 1; transform: translateY(0); }",
    "  from { opacity: 0; transform: translateY(10px) scale(0.98); }\n  to { opacity: 1; transform: translateY(0) scale(1); }",
)
# Replace mobile host placement if present.
css = re.sub(
    r"@media \(max-width: 760px\) \{\n\s*\.operation-toast-host \{[\s\S]*?\n\s*\}\n\}",
    "@media (max-width: 760px) {\n  .operation-toast-host {\n    top: 50%;\n    left: 12px;\n    right: 12px;\n    width: auto;\n    transform: translateY(-50%);\n  }\n}\n",
    css,
)

# Add panel dialog CSS if missing.
if '.task-panel-feedback-overlay' not in css and feedback_css.name == 'operation-feedback.css':
    css += r'''

/* Prominent modal-style feedback for task-side-panel operations. */
.task-panel-feedback-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.34);
  backdrop-filter: blur(4px);
}

.task-panel-feedback-dialog {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 14px;
  width: min(460px, 100%);
  padding: 20px;
  border: 1px solid #dbe3ea;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 26px 70px rgba(15, 23, 42, 0.26);
}

.task-panel-feedback-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  font-size: 24px;
  font-weight: 900;
}

.task-panel-feedback-content h3 {
  margin: 0 0 6px;
  color: #0f172a;
  font-size: 18px;
}

.task-panel-feedback-content p {
  margin: 0;
  color: #334155;
  font-size: 14px;
  line-height: 1.65;
}

.task-panel-feedback-content small {
  display: block;
  margin-top: 8px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.55;
}

.task-panel-feedback-confirm {
  grid-column: 2;
  justify-self: end;
  min-width: 96px;
}

.task-panel-feedback-success { border-color: #99f6e4; }
.task-panel-feedback-success .task-panel-feedback-icon { background: #ccfbf1; color: #0f766e; }
.task-panel-feedback-error { border-color: #fecaca; }
.task-panel-feedback-error .task-panel-feedback-icon { background: #fee2e2; color: #dc2626; }
.task-panel-feedback-warning { border-color: #fed7aa; }
.task-panel-feedback-warning .task-panel-feedback-icon { background: #fff7ed; color: #c2410c; }
.task-panel-feedback-info { border-color: #bfdbfe; }
.task-panel-feedback-info .task-panel-feedback-icon { background: #eff6ff; color: #1d4ed8; }

@media (max-width: 520px) {
  .task-panel-feedback-dialog {
    grid-template-columns: 1fr;
  }

  .task-panel-feedback-confirm {
    grid-column: 1;
    justify-self: stretch;
  }
}
'''
# If panel dialog CSS already lives in patient-task-side-panel.css, this extra global CSS is harmless; but we keep it central for the global message-box layer.
feedback_css.write_text(css)

print('Prominent feedback patch applied successfully.')
print('- PatientTaskSidePanel: inline top success/error banners removed; dialog feedback enabled.')
print('- API client: suppressed operation notices also suppress error toasts.')
print('- OperationToastHost CSS: global operation notices now render as centered message boxes, not page-top tips.')
