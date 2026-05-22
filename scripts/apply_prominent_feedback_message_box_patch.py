#!/usr/bin/env python3
"""Apply the prominent feedback message box patch.

Rewires every remaining default-style feedback channel in the web app
(inline top-of-page success/error notice banners, raw `window.alert(...)`
calls, single-state inline "rules-message" / "integration-message"
banners) into a single centered prominent message-box system rendered by
<OperationToastHost />.

Run from the repo root (i.e. the directory that contains apps/, scripts/):

    python3 scripts/apply_prominent_feedback_message_box_patch.py "$PWD"

This script is idempotent: re-running it after the first successful run is
a no-op and will print "No additional edits were needed".
"""
from __future__ import annotations
from pathlib import Path
import re
import sys


# ---------------------------------------------------------------------------
# entrypoint
# ---------------------------------------------------------------------------

def main() -> None:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
    web_src = root / "apps" / "web" / "src"

    required = [
        web_src / "App.tsx",
        web_src / "main.tsx",
        web_src / "components" / "OperationToastHost.tsx",
        web_src / "utils" / "feedbackMessage.ts",
        web_src / "operation-feedback.css",
        web_src / "api" / "client.ts",
        web_src / "pages" / "PatientDetailPage.tsx",
        web_src / "pages" / "PatientsPage.tsx",
        web_src / "pages" / "TaskFollowUpPage.tsx",
        web_src / "pages" / "HospitalVisitRemindersPage.tsx",
        web_src / "pages" / "PatientBindingReviewPage.tsx",
        web_src / "pages" / "LoginPage.tsx",
        web_src / "pages" / "ClinicalRulesPage.tsx",
        web_src / "pages" / "IntegrationCenterPage.tsx",
        web_src / "components" / "TaskClinicalContextPanel.tsx",
    ]
    missing = [str(p) for p in required if not p.exists()]
    if missing:
        raise SystemExit(
            "Missing required file(s):\n  - "
            + "\n  - ".join(missing)
            + "\n\nRun this script from the repo root — the directory that\n"
              "contains apps/, scripts/, etc. — NOT from inside apps/api or apps/web."
        )

    edits: list[str] = []

    edits += patch_app_tsx(web_src / "App.tsx")
    edits += extend_operation_feedback_css(web_src / "operation-feedback.css")

    edits += patch_two_state_page(
        web_src / "pages" / "PatientDetailPage.tsx",
        success_name="message",
        error_name="error",
        banner_pattern=(
            r'\n\s*\{message && <div className="notice-success operation-inline-success" role="status">\{message\}</div>\}'
            r'\n\s*\{error && <div className="notice-error operation-inline-error" role="alert">\{error\}</div>\}\n'
        ),
    )
    edits += patch_two_state_page(
        web_src / "pages" / "PatientsPage.tsx",
        success_name="message",
        error_name="error",
        banner_pattern=(
            r'\n\s*\{message && <div className="status-message operation-inline-success" role="status">\{message\}</div>\}'
            r'\n\s*\{error && <div className="status-error operation-inline-error" role="alert">\{error\}</div>\}\n'
        ),
    )
    edits += patch_two_state_page(
        web_src / "pages" / "TaskFollowUpPage.tsx",
        success_name="message",
        error_name="error",
        banner_pattern=(
            r'\n\s*\{message && <div className="notice-success operation-inline-success" role="status">\{message\}</div>\}'
            r'\n\s*\{error && <div className="notice-error operation-inline-error" role="alert">\{error\}</div>\}\n'
        ),
    )
    edits += patch_error_only_page(
        web_src / "pages" / "HospitalVisitRemindersPage.tsx",
        error_name="error",
        banner_pattern=(
            r'\n\s*\{error && <div className="notice-error operation-inline-error" role="alert">\{error\}</div>\}\n'
        ),
    )
    edits += patch_two_state_page(
        web_src / "pages" / "PatientBindingReviewPage.tsx",
        success_name="message",
        error_name="error",
        banner_pattern=(
            r'\n\s*\{message && <div className="status-success">\{message\}</div>\}'
            r'\n\s*\{error && <div className="status-error">\{error\}</div>\}\n'
        ),
    )
    edits += patch_error_only_page(
        web_src / "pages" / "LoginPage.tsx",
        error_name="error",
        banner_pattern=(
            r'\n\s*\{error && <div className="status-error">\{error\}</div>\}\n'
        ),
    )
    edits += patch_inferred_single_state_page(
        web_src / "pages" / "ClinicalRulesPage.tsx",
        state_name="message",
        banner_pattern=r'\n\s*\{message && <div className="rules-message">\{message\}</div>\}\n',
    )
    edits += patch_inferred_single_state_page(
        web_src / "pages" / "IntegrationCenterPage.tsx",
        state_name="message",
        banner_pattern=r'\n\s*\{message && <div className="integration-message">\{message\}</div>\}\n',
    )
    edits += patch_task_clinical_context_panel(
        web_src / "components" / "TaskClinicalContextPanel.tsx",
    )

    print()
    if edits:
        print("Applied edits:")
        for e in edits:
            print(f"  - {e}")
    else:
        print("No additional edits were needed (idempotent re-run).")

    print(
        "\nWhat this patch does:\n"
        "  • Mounts <OperationToastHost /> globally in App.tsx.\n"
        "  • Removes all inline top-of-page success/error notice banners\n"
        "    from PatientDetailPage / PatientsPage / TaskFollowUpPage /\n"
        "    HospitalVisitRemindersPage / PatientBindingReviewPage /\n"
        "    LoginPage / ClinicalRulesPage / IntegrationCenterPage.\n"
        "  • Routes their existing message/error state into the centered\n"
        "    prominent message-box host via useFeedbackMessageBridge.\n"
        "  • Replaces the two raw window.alert(...) calls in\n"
        "    TaskClinicalContextPanel.tsx with prominent message boxes.\n"
        "  • Strengthens the .operation-toast box styling so it's visibly\n"
        "    a prominent message box, not a slim top banner. Errors and\n"
        "    warnings stay until the user clicks close.\n"
        "\nFollow-up:\n"
        "  1. Restart Vite dev server (npm --prefix apps/web run dev) to\n"
        "     pick up the new files in apps/web/src/utils/.\n"
        "  2. Smoke check in the browser: a successful save should display\n"
        "     a centered prominent box, NOT a top-of-page banner. A failed\n"
        "     save and a required-field-missing prompt should display the\n"
        "     same kind of box, with their own tone."
    )


# ---------------------------------------------------------------------------
# shared helpers
# ---------------------------------------------------------------------------

def ensure_feedback_import(
    text: str,
    names: list[str],
    from_path: str,
) -> tuple[str, bool]:
    """Insert (or merge into) an import line for the named helpers.

    Returns (new_text, changed?).
    """
    # If every name is already importable from from_path, nothing to do.
    existing_pat = re.compile(
        r"import \{([^}]*)\} from ['\"]" + re.escape(from_path) + r"['\"];"
    )
    m = existing_pat.search(text)
    if m:
        existing = [s.strip() for s in m.group(1).split(",") if s.strip()]
        missing = [n for n in names if n not in existing]
        if not missing:
            return text, False
        merged = existing + missing
        new_import = f"import {{ {', '.join(merged)} }} from '{from_path}';"
        return text.replace(m.group(0), new_import, 1), True

    # Otherwise insert a brand new import line after the LAST import line in
    # the file (so it sits with the rest of the imports).
    lines = text.split("\n")
    last_import = -1
    for i, line in enumerate(lines):
        stripped = line.lstrip()
        if stripped.startswith("import ") and (" from '" in line or ' from "' in line):
            last_import = i
    if last_import == -1:
        return text, False

    new_import = f"import {{ {', '.join(names)} }} from '{from_path}';"
    lines.insert(last_import + 1, new_import)
    return "\n".join(lines), True


def insert_after_state_anchor(
    text: str,
    state_anchor: str,
    call: str,
    marker: str,
) -> tuple[str, bool]:
    """Insert a hook call immediately after the given state declaration line.

    Idempotent via the marker comment.
    """
    if marker in text:
        return text, False
    if state_anchor not in text:
        return text, False
    snippet = f"\n\n  // {marker}\n  {call}"
    return text.replace(state_anchor, state_anchor + snippet, 1), True


# ---------------------------------------------------------------------------
# per-file patches
# ---------------------------------------------------------------------------

def patch_app_tsx(path: Path) -> list[str]:
    text = path.read_text()
    edits: list[str] = []

    if "from './components/OperationToastHost'" not in text:
        anchor = "import { manualLogout, SESSION_EXPIRED_EVENT } from './api/auth-session';"
        if anchor not in text:
            raise SystemExit(f"{path}: cannot locate auth-session import anchor")
        text = text.replace(
            anchor,
            anchor + "\nimport { OperationToastHost } from './components/OperationToastHost';",
            1,
        )
        edits.append(f"{path.name}: added OperationToastHost import")

    if "<OperationToastHost" not in text:
        anchor = (
            "export default function App() {\n"
            "  return (\n"
            "    <BrowserRouter>\n"
            "      <AppContent />\n"
            "    </BrowserRouter>\n"
            "  );\n"
            "}"
        )
        if anchor not in text:
            raise SystemExit(f"{path}: cannot locate default-export App() anchor")
        replacement = (
            "export default function App() {\n"
            "  return (\n"
            "    <BrowserRouter>\n"
            "      <AppContent />\n"
            "      <OperationToastHost />\n"
            "    </BrowserRouter>\n"
            "  );\n"
            "}"
        )
        text = text.replace(anchor, replacement, 1)
        edits.append(f"{path.name}: mounted <OperationToastHost /> at app root")

    path.write_text(text)
    return edits


def patch_two_state_page(
    path: Path,
    *,
    success_name: str,
    error_name: str,
    banner_pattern: str,
) -> list[str]:
    text = path.read_text()
    edits: list[str] = []

    text, added = ensure_feedback_import(
        text, ["useFeedbackMessageBridge"], "../utils/feedbackMessage"
    )
    if added:
        edits.append(f"{path.name}: added feedbackMessage import")

    anchor = f"  const [{error_name}, setError] = useState('');"
    text, added = insert_after_state_anchor(
        text,
        state_anchor=anchor,
        call=f"useFeedbackMessageBridge({success_name}, {error_name});",
        marker="prominent-feedback-bridge-v1",
    )
    if added:
        edits.append(
            f"{path.name}: wired useFeedbackMessageBridge({success_name}, {error_name})"
        )

    new_text, n = re.subn(banner_pattern, "\n", text, count=1)
    if n > 0:
        text = new_text
        edits.append(f"{path.name}: removed inline top notice banner")

    path.write_text(text)
    return edits


def patch_error_only_page(
    path: Path,
    *,
    error_name: str,
    banner_pattern: str,
) -> list[str]:
    text = path.read_text()
    edits: list[str] = []

    text, added = ensure_feedback_import(
        text, ["useFeedbackMessageBridge"], "../utils/feedbackMessage"
    )
    if added:
        edits.append(f"{path.name}: added feedbackMessage import")

    anchor = f"  const [{error_name}, setError] = useState('');"
    text, added = insert_after_state_anchor(
        text,
        state_anchor=anchor,
        call=f"useFeedbackMessageBridge(undefined, {error_name});",
        marker="prominent-feedback-bridge-v1",
    )
    if added:
        edits.append(
            f"{path.name}: wired useFeedbackMessageBridge(undefined, {error_name})"
        )

    new_text, n = re.subn(banner_pattern, "\n", text, count=1)
    if n > 0:
        text = new_text
        edits.append(f"{path.name}: removed inline top notice banner")

    path.write_text(text)
    return edits


def patch_inferred_single_state_page(
    path: Path,
    *,
    state_name: str,
    banner_pattern: str,
) -> list[str]:
    text = path.read_text()
    edits: list[str] = []

    text, added = ensure_feedback_import(
        text, ["useFeedbackInferredBridge"], "../utils/feedbackMessage"
    )
    if added:
        edits.append(f"{path.name}: added feedbackMessage import")

    anchor = f"  const [{state_name}, setMessage] = useState('');"
    text, added = insert_after_state_anchor(
        text,
        state_anchor=anchor,
        call=f"useFeedbackInferredBridge({state_name});",
        marker="prominent-feedback-bridge-v1",
    )
    if added:
        edits.append(f"{path.name}: wired useFeedbackInferredBridge({state_name})")

    new_text, n = re.subn(banner_pattern, "\n", text, count=1)
    if n > 0:
        text = new_text
        edits.append(f"{path.name}: removed inline top notice banner")

    path.write_text(text)
    return edits


def patch_task_clinical_context_panel(path: Path) -> list[str]:
    text = path.read_text()
    edits: list[str] = []

    needed: list[str] = []
    if "alert('更新失败，请重试')" in text or 'alert("更新失败，请重试")' in text:
        needed.append("showFeedbackError")
    if (
        "alert('请填写修改原因和电子签名')" in text
        or 'alert("请填写修改原因和电子签名")' in text
    ):
        needed.append("showRequiredFieldMissing")

    if needed:
        text, added = ensure_feedback_import(text, needed, "../utils/feedbackMessage")
        if added:
            edits.append(f"{path.name}: added feedbackMessage import")

    if "alert('更新失败，请重试')" in text:
        text = text.replace(
            "alert('更新失败，请重试')",
            "showFeedbackError('更新失败，请重试')",
        )
        edits.append(f"{path.name}: alert('更新失败，请重试') -> showFeedbackError")
    elif 'alert("更新失败，请重试")' in text:
        text = text.replace(
            'alert("更新失败，请重试")',
            'showFeedbackError("更新失败，请重试")',
        )
        edits.append(f'{path.name}: alert("更新失败，请重试") -> showFeedbackError')

    if "alert('请填写修改原因和电子签名')" in text:
        text = text.replace(
            "alert('请填写修改原因和电子签名')",
            "showRequiredFieldMissing('请填写修改原因和电子签名')",
        )
        edits.append(
            f"{path.name}: alert('请填写修改原因和电子签名') -> showRequiredFieldMissing"
        )
    elif 'alert("请填写修改原因和电子签名")' in text:
        text = text.replace(
            'alert("请填写修改原因和电子签名")',
            'showRequiredFieldMissing("请填写修改原因和电子签名")',
        )
        edits.append(
            f'{path.name}: alert("请填写修改原因和电子签名") -> showRequiredFieldMissing'
        )

    path.write_text(text)
    return edits


# ---------------------------------------------------------------------------
# CSS strengthening (idempotent: gated by a marker comment)
# ---------------------------------------------------------------------------

CSS_PATCH_MARKER = "/* prominent-feedback-message-box-v1 */"
CSS_PATCH_BLOCK = """

/* prominent-feedback-message-box-v1 */
/*
 * Visually upgrade the centered toast into a prominent message box, and
 * make warnings/errors persistent until the user clicks close.
 * The host (.operation-toast-host) is already centered horizontally and
 * vertically by the rules above; these overrides only adjust appearance.
 */
.operation-toast {
  border: 1.5px solid #cbd5e1;
  border-top-width: 6px;
  border-radius: 18px;
  padding: 18px 18px 18px 16px;
  box-shadow: 0 32px 80px rgba(15, 23, 42, 0.32), 0 2px 8px rgba(15, 23, 42, 0.08);
}

.operation-toast-body strong {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.operation-toast-body span {
  font-size: 13.5px;
  line-height: 1.55;
}

.operation-toast-body em {
  display: block;
  margin-top: 6px;
  color: #64748b;
  font-size: 12.5px;
  font-style: normal;
  line-height: 1.5;
}

.operation-toast-persistent {
  box-shadow:
    0 40px 90px rgba(220, 38, 38, 0.22),
    0 0 0 1px rgba(220, 38, 38, 0.12);
}

.operation-toast-persistent.operation-toast-warning {
  box-shadow:
    0 40px 90px rgba(217, 119, 6, 0.18),
    0 0 0 1px rgba(217, 119, 6, 0.12);
}

.operation-toast-close {
  width: 28px;
  height: 28px;
  font-size: 22px;
}
"""


def extend_operation_feedback_css(path: Path) -> list[str]:
    text = path.read_text()
    if CSS_PATCH_MARKER in text:
        return []
    if not text.endswith("\n"):
        text += "\n"
    path.write_text(text + CSS_PATCH_BLOCK.lstrip("\n"))
    return [f"{path.name}: appended prominent-feedback-message-box-v1 styles"]


if __name__ == "__main__":
    main()
