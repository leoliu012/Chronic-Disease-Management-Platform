#!/usr/bin/env python3
"""
apply_v3_public_form_page.py
-----------------------------
Adds GENERAL_MESSAGE support and senior-friendly CSS to the patient H5.

PublicFormPage.tsx edits:
  1. Add 'GENERAL_MESSAGE' to the FormType union
  2. Insert render branch for GENERAL_MESSAGE (before the fallback)
  3. Append GeneralMessageForm component to the file

patient-engagement-public-form.css edits:
  - append senior-friendly overrides scoped under .pe-public-senior

Idempotent.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

PAGE = Path("apps/web/src/pages/PublicFormPage.tsx")
CSS = Path("apps/web/src/patient-engagement-public-form.css")

CSS_APPEND = """

/* ===========================================================================
 * care-reminders v3 — senior-friendly overrides
 * Min font 18px, button height >=56px, large input fields, single action.
 * ======================================================================== */
.pe-public-senior,
.pe-public-senior * {
  font-size: 18px !important;
  line-height: 1.6;
}
.pe-public-senior .pe-public-section h2 {
  font-size: 22px !important;
  margin-bottom: 12px;
}
.pe-public-senior .pe-public-primary-button {
  min-height: 56px;
  font-size: 19px !important;
  padding: 14px 20px;
  width: 100%;
  margin-bottom: 12px;
}
.pe-public-senior input[type="number"],
.pe-public-senior input[type="text"] {
  font-size: 22px !important;
  padding: 14px;
  min-height: 48px;
}
.pe-public-senior label {
  font-weight: 600;
}
.pe-public-senior .pe-public-hint {
  color: #4b5563;
}
"""

RENDER_BRANCH = """  if (meta.type === 'GENERAL_MESSAGE') {
    return <GeneralMessageForm meta={meta} submit={(p) => doSubmit('general-message-ack', p)} state={submitState} />;
  }
"""

NEW_COMPONENT = """

// =============================================================================
// care-reminders v3 — GENERAL_MESSAGE H5 (senior-friendly)
// =============================================================================
function GeneralMessageForm({
  meta,
  submit,
  state,
}: {
  meta: FormMeta;
  submit: (payload: any) => void;
  state: SubmitState;
}) {
  const requiresAck = Boolean((meta.payload as any)?.requiresAck);
  const priority = String((meta.payload as any)?.priority || 'NORMAL');
  const priorityLabel: Record<string, string> = {
    NORMAL: '',
    IMPORTANT: '【重要】',
    URGENT: '【紧急】',
  };
  return (
    <section className="pe-public-section pe-public-senior">
      <h2>{priorityLabel[priority] || ''}{meta.title}</h2>
      <p className="pe-public-hint">{meta.hospitalDisplayName}</p>
      <p style={{ whiteSpace: 'pre-wrap', fontSize: 18, marginTop: 12 }}>
        {meta.description || ''}
      </p>
      {state.kind === 'error' && (
        <p className="pe-public-error" role="alert">
          {state.message}
        </p>
      )}
      {requiresAck ? (
        <button
          type="button"
          className="pe-public-primary-button"
          disabled={state.kind === 'submitting'}
          onClick={() => submit({})}
        >
          {state.kind === 'submitting' ? '提交中…' : '我已知晓'}
        </button>
      ) : (
        <p className="pe-public-hint" style={{ marginTop: 16 }}>
          您已查看此消息。无需操作。
        </p>
      )}
    </section>
  );
}
"""


def patch_page() -> bool:
    if not PAGE.exists():
        print(f"[err] {PAGE} not found", file=sys.stderr)
        return False
    src = PAGE.read_text(encoding="utf-8")
    original = src
    notes: list[str] = []

    # 1) union
    if "'GENERAL_MESSAGE'" not in src:
        union_re = re.compile(
            r"(type FormType =\s*(?:\|\s*'[^']+'\s*)+\|\s*'GENERIC_NOTICE';)",
        )
        m = union_re.search(src)
        if m:
            src = src.replace(
                m.group(1),
                m.group(1).rstrip(";") + "\n  | 'GENERAL_MESSAGE';",
                1,
            )
            # tidy up double semicolons if any
            src = src.replace("'GENERIC_NOTICE'\n  | 'GENERAL_MESSAGE';;", "'GENERIC_NOTICE'\n  | 'GENERAL_MESSAGE';")
            notes.append("FormType union widened")
        else:
            # simpler form: literal replace
            if "| 'GENERIC_NOTICE';" in src:
                src = src.replace(
                    "| 'GENERIC_NOTICE';",
                    "| 'GENERIC_NOTICE'\n  | 'GENERAL_MESSAGE';",
                    1,
                )
                notes.append("FormType union widened (fallback)")

    # 2) render branch — insert before the fallback "FullPageNotice"
    if "GeneralMessageForm" not in src:
        anchor = "  return <FullPageNotice title=\"暂不支持的任务类型\""
        if anchor in src:
            src = src.replace(anchor, RENDER_BRANCH + anchor, 1)
            notes.append("render branch added")
        else:
            print("[warn] could not find FullPageNotice fallback anchor; render branch NOT inserted.")

    # 3) append component definition
    if "function GeneralMessageForm" not in src:
        if not src.endswith("\n"):
            src += "\n"
        src += NEW_COMPONENT
        notes.append("GeneralMessageForm component appended")

    if src == original:
        print(f"[skip] {PAGE.name} already wired for GENERAL_MESSAGE.")
        return True

    PAGE.write_text(src, encoding="utf-8")
    print(f"[ok] {PAGE.name} patched:")
    for n in notes:
        print(f"     - {n}")
    return True


def patch_css() -> bool:
    if not CSS.exists():
        print(f"[warn] {CSS} not found (skipping CSS additions).", file=sys.stderr)
        return True
    src = CSS.read_text(encoding="utf-8")
    if "care-reminders v3 — senior-friendly overrides" in src:
        print(f"[skip] {CSS.name} already has senior overrides.")
        return True
    if not src.endswith("\n"):
        src += "\n"
    CSS.write_text(src + CSS_APPEND, encoding="utf-8")
    print(f"[ok] {CSS.name} — appended senior-friendly overrides")
    return True


def main() -> int:
    ok1 = patch_page()
    ok2 = patch_css()
    return 0 if (ok1 and ok2) else 1


if __name__ == "__main__":
    sys.exit(main())
