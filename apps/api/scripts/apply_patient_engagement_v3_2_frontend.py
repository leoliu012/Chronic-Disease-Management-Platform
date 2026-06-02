#!/usr/bin/env python3
"""
apply_patient_engagement_v3_2_frontend.py
------------------------------------------
Idempotent frontend patcher for Patient Engagement v3.2.

The big files (api/patient-engagement.ts + components/PatientEngagementTab.tsx)
ship as full-file replacements via the patch ZIP (rsync). This script only:

  1. PublicFormPage.tsx
       + FormMeta.revokeReason
       ~ REVOKED page shows the nurse-entered reason + friendly copy
         (no \"token 无效\" technical error).
  2. patient-engagement-admin-tab.css
       + v3.2 styles (filter bar, pagination, delivery chips, detail drawer,
         attempts timeline, submission table, banners, CANCELED status).

Run from repo root:
  python3 scripts/apply_patient_engagement_v3_2_frontend.py
"""
from __future__ import annotations

import sys
from pathlib import Path

PFP = Path("apps/web/src/pages/PublicFormPage.tsx")
CSS = Path("apps/web/src/patient-engagement-admin-tab.css")

changed = False


def fail(msg: str) -> None:
    print(f"[err] {msg}", file=sys.stderr)
    sys.exit(1)


def need(path: Path) -> str:
    if not path.exists():
        fail(f"missing {path} (run from repo root)")
    return path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# 1) PublicFormPage.tsx
# ---------------------------------------------------------------------------
def patch_public_form_page() -> None:
    global changed
    src = need(PFP)
    local = False

    # 1a. FormMeta.revokeReason
    if "revokeReason" not in src:
        old = (
            "type FormMeta = {\n"
            "  valid: boolean;\n"
            "  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED';\n"
        )
        new = (
            "type FormMeta = {\n"
            "  valid: boolean;\n"
            "  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED';\n"
            "  // patient_engagement_v3_2 — nurse-entered reason shown on a revoked link\n"
            "  revokeReason?: string | null;\n"
        )
        if old not in src:
            fail("FormMeta anchor not found in PublicFormPage.tsx")
        src = src.replace(old, new, 1)
        local = True

    # 1b. friendly REVOKED message with reason
    if "该提醒已失效" not in src:
        old = (
            "    const body =\n"
            "      meta.status === 'USED'\n"
            "        ? '本链接对应的随访任务已经提交过。如果有疑问，请联系医院慢病管理团队。'\n"
            "        : meta.status === 'EXPIRED'\n"
            "          ? '链接已过期。请联系医院慢病管理团队重新发送新链接。'\n"
            "          : '链接已被医院撤销。请等待新的链接，或直接联系医院。';\n"
            "    return <FullPageNotice title={`链接${label}`} body={body} />;"
        )
        new = (
            "    // v3.2: a REVOKED link means the nurse intentionally canceled this\n"
            "    // reminder. Show a friendly message with their reason — never a raw\n"
            "    // token error.\n"
            "    if (meta.status === 'REVOKED') {\n"
            "      const reason = (meta.revokeReason || '').trim();\n"
            "      const revokedBody =\n"
            "        '医院工作人员已取消本次提醒。' +\n"
            "        (reason ? `\\n原因：${reason}` : '') +\n"
            "        '\\n如有疑问，请联系医院慢病管理团队。';\n"
            "      return <FullPageNotice title=\"该提醒已失效\" body={revokedBody} />;\n"
            "    }\n"
            "    const body =\n"
            "      meta.status === 'USED'\n"
            "        ? '本链接对应的随访任务已经提交过。如果有疑问，请联系医院慢病管理团队。'\n"
            "        : meta.status === 'EXPIRED'\n"
            "          ? '链接已过期。请联系医院慢病管理团队重新发送新链接。'\n"
            "          : '链接已被医院撤销。请等待新的链接，或直接联系医院。';\n"
            "    return <FullPageNotice title={`链接${label}`} body={body} />;"
        )
        if old not in src:
            fail("REVOKED status block anchor not found in PublicFormPage.tsx")
        src = src.replace(old, new, 1)
        local = True

    if local:
        PFP.write_text(src, encoding="utf-8")
        changed = True
        print("[ok] patched PublicFormPage.tsx (friendly revoked message)")
    else:
        print("[skip] PublicFormPage.tsx already at v3.2")


# ---------------------------------------------------------------------------
# 2) CSS append
# ---------------------------------------------------------------------------
CSS_BLOCK = """

/* ============================================================================
   patient_engagement_v3_2 — filters, pagination, delivery chips, detail drawer
============================================================================ */

.pe-admin-status-canceled { background: #e2e8f0; color: #475569; }

/* ----- filter bar ----- */
.pe-admin-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  padding: 12px;
  margin-bottom: 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.pe-admin-filter-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #64748b;
}
.pe-admin-filter-field select,
.pe-admin-filter-field input {
  min-width: 140px;
  padding: 6px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 13px;
  color: #0f172a;
  background: #fff;
}
.pe-admin-filter-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

/* ----- delivery chips ----- */
.pe-admin-delivery {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.pe-admin-chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  white-space: nowrap;
}
.pe-admin-chip-ok { background: #dbeafe; color: #1e40af; }
.pe-admin-chip-fail { background: #fee2e2; color: #991b1b; font-weight: 600; }

/* ----- pagination ----- */
.pe-admin-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  gap: 12px;
}
.pe-admin-pagination > div { display: flex; gap: 8px; }
.pe-admin-pagination button {
  padding: 6px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
.pe-admin-pagination button:disabled { opacity: 0.5; cursor: default; }

/* ----- detail drawer ----- */
.pe-admin-drawer {
  position: fixed;
  top: 0;
  right: 0;
  height: 100%;
  width: min(520px, 100%);
  background: #fff;
  box-shadow: -8px 0 24px rgba(15, 23, 42, 0.18);
  display: flex;
  flex-direction: column;
  animation: pe-admin-drawer-in 0.18s ease-out;
}
@keyframes pe-admin-drawer-in {
  from { transform: translateX(24px); opacity: 0.4; }
  to { transform: translateX(0); opacity: 1; }
}
.pe-admin-drawer header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid #e2e8f0;
}
.pe-admin-drawer header h3 { margin: 0; font-size: 16px; color: #0f172a; }
.pe-admin-drawer header button {
  border: none;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  color: #64748b;
}
.pe-admin-drawer-body {
  padding: 16px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.pe-admin-drawer-section h4 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #0f172a;
}
.pe-admin-kv {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.pe-admin-kv > div { display: flex; flex-direction: column; }
.pe-admin-kv label { font-size: 12px; color: #64748b; margin-bottom: 2px; }
.pe-admin-kv strong { font-size: 14px; color: #0f172a; word-break: break-word; }
.pe-admin-drawer-actions { display: flex; gap: 10px; }

/* ----- banners ----- */
.pe-admin-banner {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
}
.pe-admin-banner-warn { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
.pe-admin-banner-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

/* ----- attempts timeline ----- */
.pe-admin-timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pe-admin-timeline li {
  border-left: 3px solid #cbd5e1;
  padding: 6px 0 6px 12px;
}
.pe-admin-timeline-ok { border-left-color: #2563eb; }
.pe-admin-timeline-fail { border-left-color: #ef4444; }
.pe-admin-timeline-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pe-admin-timeline-head strong { font-size: 13px; color: #0f172a; }
.pe-admin-timeline-meta { margin-top: 2px; color: #64748b; }

/* ----- submission table ----- */
.pe-admin-submission-table {
  width: 100%;
  border-collapse: collapse;
}
.pe-admin-submission-table th {
  text-align: left;
  width: 110px;
  padding: 6px 8px;
  color: #64748b;
  font-weight: 500;
  font-size: 13px;
  vertical-align: top;
}
.pe-admin-submission-table td {
  padding: 6px 8px;
  color: #0f172a;
  font-size: 13px;
}
.pe-admin-answers { margin-top: 8px; }
.pe-admin-answers pre {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 10px;
  font-size: 12px;
  overflow-x: auto;
}
"""


def patch_css() -> None:
    global changed
    src = need(CSS)
    if "patient_engagement_v3_2 — filters" in src:
        print("[skip] CSS already has v3.2 styles")
        return
    if not src.endswith("\n"):
        src += "\n"
    src += CSS_BLOCK
    CSS.write_text(src, encoding="utf-8")
    changed = True
    print("[ok] appended v3.2 styles to patient-engagement-admin-tab.css")


def main() -> int:
    patch_public_form_page()
    patch_css()
    print("[done] frontend patch " + ("applied changes." if changed else "was already fully applied."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
