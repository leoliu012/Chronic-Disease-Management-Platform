#!/usr/bin/env python3
"""
care_reminders_v3_3_4_targeted_send_now_and_scope_hardening

Focused hotfix for the current source tree:
1. Make POST /care-reminders/occurrences/:id/send-now dispatch exactly the
   selected PENDING occurrence immediately instead of invoking the global worker.
2. Enforce write-scope authorization on every mutating care-reminders endpoint.
3. Make smoke-care-reminders.js rerunnable against a non-reset database:
   - accept anti-enumeration 404 for cross-tenant requests;
   - do not require the first worker pass to create a new row on every rerun;
   - select a PENDING occurrence rather than a historical COMPLETED row;
   - insert a dedicated future PENDING fixture only if the horizon is exhausted.

Run from the repository root:
  python3 scripts/apply_care_reminders_v3_3_4_targeted_send_now.py
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import shutil
import sys

ROOT = Path.cwd()
WORKER = ROOT / "apps/api/src/care-reminders/care-reminder-worker.service.ts"
CTRL = ROOT / "apps/api/src/care-reminders/care-reminders.controller.ts"
SMOKE = ROOT / "apps/api/scripts/smoke-care-reminders.js"

STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
BACKUP = ROOT / f"apps/api/.patch-backups/care-reminders-v3.3.4-{STAMP}"

changed: list[str] = []


def fail(msg: str) -> None:
    print(f"[err] {msg}", file=sys.stderr)
    raise SystemExit(1)


def read(path: Path) -> str:
    if not path.exists():
        fail(f"missing {path}; run this patcher from the repository root")
    return path.read_text(encoding="utf-8")


def backup(path: Path) -> None:
    rel = path.relative_to(ROOT)
    dst = BACKUP / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dst)


def write_if_changed(path: Path, old: str, new: str) -> None:
    if old == new:
        return
    backup(path)
    path.write_text(new, encoding="utf-8")
    changed.append(str(path.relative_to(ROOT)))
    print(f"[ok] patched {path.relative_to(ROOT)}")


def replace_once(src: str, old: str, new: str, label: str) -> str:
    if new in src:
        print(f"[skip] {label} — already applied")
        return src
    count = src.count(old)
    if count != 1:
        fail(f"{label}: expected one anchor, found {count}")
    return src.replace(old, new, 1)


def replace_count(src: str, old: str, new: str, expected: int, label: str) -> str:
    count_old = src.count(old)
    count_new = src.count(new)
    if count_old == 0 and count_new >= expected:
        print(f"[skip] {label} — already applied")
        return src
    if count_old != expected:
        fail(f"{label}: expected {expected} old anchors, found {count_old}; new anchors={count_new}")
    return src.replace(old, new)


def patch_worker() -> None:
    original = read(WORKER)
    src = original

    old_canonical = """    if (primaryChannel !== 'MANUAL_COPY') {
      const dispatched = await this.outbound.dispatch(message.id, {
        openId: primaryChannel === 'WECHAT_OFFICIAL_ACCOUNT' ? recipient : null,
        phone: primaryChannel === 'SMS' ? recipient : null,
      });
      // v3.2: record this as the INITIAL delivery attempt on the canonical message.
      // (We're already inside `if (primaryChannel !== 'MANUAL_COPY')`, so the
      // channel here is WECHAT_OFFICIAL_ACCOUNT or SMS.)
      try {
        await this.outbound.recordAttempt({
          messageId: message.id,
          hospitalTenantId: tenantId,
          patientId: occ.patientId,
          formLinkId: formLink.id,
          channel: primaryChannel,
          status: dispatched?.status === 'SENT' ? 'SENT' : 'FAILED',
          providerMessageId: dispatched?.providerMessageId ?? null,
          errorMessage: dispatched?.status === 'SENT' ? null : dispatched?.errorMessage ?? '发送失败',
          triggerReason: 'INITIAL',
        });
        await this.outbound.recomputeDelivery(message.id);
      } catch { /* attempts table may be pre-v3.2 */ }

      // v2.1 SMS fallback on WeChat failure.
      if (
        primaryChannel === 'WECHAT_OFFICIAL_ACCOUNT' &&
        dispatched?.status === 'FAILED' &&
        patient.phone
      ) {
        const fb = await this.outbound.create({
          hospitalTenantId: tenantId,
          patientId: occ.patientId,
          formLinkId: formLink.id,
          channel: 'SMS',
          messageType,
          title: occ.title,
          content,
          linkUrl,
          recipient: patient.phone,
          createdBy: null,
          initialStatus: 'PENDING',
        });
        const fbDispatched = await this.outbound.dispatch(fb.id, {
          openId: null,
          phone: patient.phone,
        });
        try {
          await this.outbound.recordAttempt({
            messageId: message.id,
            hospitalTenantId: tenantId,
            patientId: occ.patientId,
            formLinkId: formLink.id,
            channel: 'SMS',
            status: fbDispatched?.status === 'SENT' ? 'SENT' : 'FAILED',
            providerMessageId: fbDispatched?.providerMessageId ?? null,
            errorMessage: fbDispatched?.status === 'SENT' ? null : fbDispatched?.errorMessage ?? '发送失败',
            triggerReason: 'AUTO_FALLBACK',
          });
          await this.outbound.recomputeDelivery(message.id);
        } catch { /* attempts table may be pre-v3.2 */ }
        const refreshed = await this.prisma.patientOutboundMessage.findUnique({ where: { id: fb.id } });
        return { formLink, token, linkUrl, message: refreshed };
      }

      const refreshed = await this.prisma.patientOutboundMessage.findUnique({ where: { id: message.id } });
      return { formLink, token, linkUrl, message: refreshed };
    }

    return { formLink, token, linkUrl, message };
"""
    new_canonical = """    if (primaryChannel !== 'MANUAL_COPY') {
      // v3.2 canonical-case model: one PatientOutboundMessage per reminder.
      // Every channel try (initial WeChat/SMS, fallback SMS, nurse resend) is a
      // PatientOutboundAttempt under that same message. Never create a second
      // PatientOutboundMessage just because the transport falls back to SMS.
      const primaryAttempt = await this.outbound.attemptDispatch({
        messageId: message.id,
        channel: primaryChannel,
        openId: primaryChannel === 'WECHAT_OFFICIAL_ACCOUNT' ? recipient : null,
        phone: primaryChannel === 'SMS' ? recipient : null,
        triggerReason: 'INITIAL',
      });

      // SMS fallback stays under the same canonical case row.
      if (
        primaryChannel === 'WECHAT_OFFICIAL_ACCOUNT' &&
        primaryAttempt.dispatched?.status === 'FAILED' &&
        patient.phone
      ) {
        const fallbackAttempt = await this.outbound.attemptDispatch({
          messageId: message.id,
          channel: 'SMS',
          openId: null,
          phone: patient.phone,
          triggerReason: 'AUTO_FALLBACK',
        });
        return { formLink, token, linkUrl, message: fallbackAttempt.message };
      }

      return { formLink, token, linkUrl, message: primaryAttempt.message };
    }

    return { formLink, token, linkUrl, message };
"""
    if "const primaryAttempt = await this.outbound.attemptDispatch({" not in src:
        if old_canonical not in src:
            fail("worker canonical fallback: replacement anchor not found")
        src = src.replace(old_canonical, new_canonical, 1)
        print("[ok] worker fallback keeps one canonical outbound case")
    else:
        print("[skip] worker canonical fallback — already applied")

    anchor = """  // ---------------------------------------------------------------------------
  // pass 1: generate occurrences
  // ---------------------------------------------------------------------------
"""
    addition = """  // ---------------------------------------------------------------------------
  // targeted dispatch — for the explicit nurse "send now" action
  // ---------------------------------------------------------------------------

  /**
   * Dispatch exactly one selected PENDING occurrence immediately.
   *
   * The scheduled worker intentionally sends only rows inside their normal
   * availableFrom/availableUntil window. The explicit nurse action has
   * different semantics: it bypasses that timing window, but still uses the
   * same atomic PENDING -> SENDING claim and the same dispatch pipeline.
   */
  async dispatchOccurrenceNow(id: string) {
    const occ = await this.prisma.careReminderOccurrence.findUnique({
      where: { id },
      include: {
        schedule: true,
        patient: {
          include: {
            wechatIdentities: {
              take: 5,
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!occ) {
      return this.occurrences.getByIdOrThrow(id);
    }

    if (occ.status !== 'PENDING') {
      return this.occurrences.getByIdOrThrow(id);
    }

    const claimed = await this.occurrences.claimForSending(occ.id);
    if (!claimed) {
      // A scheduled pass or another explicit send won the race. Return the
      // authoritative row rather than creating a second link/message.
      return this.occurrences.getByIdOrThrow(id);
    }

    try {
      const { formLink, message } = await this.dispatchOne(occ);
      if (message?.status === 'SENT' || message?.status === 'PENDING') {
        await this.occurrences.markSent(occ.id, formLink.id, message?.id ?? null);
      } else {
        await this.occurrences.markSendFailed(
          occ.id,
          message?.errorMessage ?? 'unknown dispatch failure',
        );
      }
    } catch (e) {
      await this.occurrences.markSendFailed(occ.id, (e as Error).message);
      throw e;
    }

    return this.occurrences.getByIdOrThrow(id);
  }

"""
    if "async dispatchOccurrenceNow(id: string)" not in src:
        if anchor not in src:
            fail("worker targeted dispatch: insertion anchor not found")
        src = src.replace(anchor, addition + anchor, 1)
        print("[ok] worker targeted send-now dispatcher")
    else:
        print("[skip] worker targeted dispatch — already applied")

    write_if_changed(WORKER, original, src)


def patch_controller() -> None:
    original = read(CTRL)
    src = original

    old_send = """    // Trigger a single dispatch by running the worker pass scoped to this occ.
    // Easiest path: just invoke runOnce() — it'll claim and dispatch the
    // PENDING occurrence. We then return the refreshed row.
    await this.worker.runOnce();
    const refreshed = await this.occurrences.getByIdOrThrow(id);
"""
    new_send = """    // Explicit nurse action: dispatch this exact occurrence immediately.
    // Do not run the global scheduled pass: that would send unrelated patients'
    // reminders and would still skip this row when it is outside its time window.
    const refreshed = await this.worker.dispatchOccurrenceNow(id);
"""
    src = replace_once(src, old_send, new_send, "controller targeted send-now")

    # Three patient-id write routes:
    # createMedicationSchedule, createVitalSchedule, createDirectMessage.
    old_patient_write = """    this.tenant.assertWriteAllowed(user);
    const { hospitalTenantId } = await this.tenant.assertPatientVisibleToUser(patientId, user);
"""
    new_patient_write = """    this.tenant.assertWriteAllowed(user);
    const { hospitalTenantId } = await this.tenant.assertPatientWritableToUser(patientId, user);
"""
    src = replace_count(
        src,
        old_patient_write,
        new_patient_write,
        3,
        "controller patient-id mutation write scope",
    )

    # Four schedule-id write routes: patch, pause, resume, cancel.
    old_schedule_write = """    this.tenant.assertWriteAllowed(user);
    const sched = await this.schedules.getByIdOrThrow(id);
    await this.tenant.assertPatientVisibleToUser(sched.patientId, user);
"""
    new_schedule_write = """    this.tenant.assertWriteAllowed(user);
    const sched = await this.schedules.getByIdOrThrow(id);
    await this.tenant.assertPatientWritableToUser(sched.patientId, user);
"""
    src = replace_count(
        src,
        old_schedule_write,
        new_schedule_write,
        4,
        "controller schedule mutation write scope",
    )

    # Three occurrence-id write routes: send-now, resend, cancel.
    old_occurrence_write = """    this.tenant.assertWriteAllowed(user);
    const occ = await this.occurrences.getByIdOrThrow(id);
    await this.tenant.assertPatientVisibleToUser(occ.patientId, user);
"""
    new_occurrence_write = """    this.tenant.assertWriteAllowed(user);
    const occ = await this.occurrences.getByIdOrThrow(id);
    await this.tenant.assertPatientWritableToUser(occ.patientId, user);
"""
    src = replace_count(
        src,
        old_occurrence_write,
        new_occurrence_write,
        3,
        "controller occurrence mutation write scope",
    )

    write_if_changed(CTRL, original, src)


def patch_smoke() -> None:
    original = read(SMOKE)
    src = original

    old_header = """// What changed vs v3:
//   - The medication send-now / resend / H5-submit flow now uses a FRESH
//     schedule created at runtime (scheduledTimes = current tenant-local HH:MM
//     with wide check-in windows) instead of a seeded occurrence, so the smoke
//     is idempotent: re-running it without re-seeding still passes.
//   - Adds resend coverage (spec III): resend a SENT occurrence -> new outbound
//     message (link reused while still active); resend after COMPLETED -> 4xx.
"""
    new_header = """// What changed vs v3:
//   - Source-bound schedules are reconciled from MedicationRecord /
//     VitalMonitoringPlan. The smoke therefore selects a PENDING occurrence
//     explicitly instead of accidentally reusing a historical COMPLETED row.
//   - If the generated horizon has already been consumed by earlier smoke runs,
//     a future PENDING fixture is inserted for the targeted send-now check.
//   - Adds resend coverage (spec III): resend a SENT occurrence -> append a
//     NURSE_RESEND attempt to the canonical message; after COMPLETED -> 4xx.
"""
    if old_header in src:
        src = src.replace(old_header, new_header, 1)
    elif "a future PENDING fixture is inserted for the targeted send-now check" not in src:
        fail("smoke header anchor not found")

    old_require = """const fs = require('fs');
const path = require('path');
"""
    new_require = """const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
"""
    src = replace_once(src, old_require, new_require, "smoke PrismaClient import")

    helper_anchor = """async function main() {
"""
    helper = """/**
 * Select an unconsumed occurrence for the explicit send-now flow.
 *
 * A source-bound schedule is stable across smoke runs, so historical rows stay
 * attached to it. Prefer a generated PENDING row. If all rows in the generated
 * horizon were consumed by previous runs, insert one dedicated future fixture.
 * Its normal dispatch window deliberately starts in the future: send-now must
 * still dispatch it immediately.
 */
async function ensurePendingOccurrence(adminToken, patientId, schedule) {
  const listed = await call(adminToken, 'GET', `/care-reminders/patients/${patientId}/occurrences`);
  const allMine = (listed.body || []).filter((o) => o.scheduleId === schedule?.id);
  const pending = allMine
    .filter((o) => o.status === 'PENDING')
    .sort((a, b) => +new Date(b.dueAt) - +new Date(a.dueAt));

  if (pending[0]) {
    return {
      occurrence: pending[0],
      total: allMine.length,
      pending: pending.length,
      fixture: 'generated',
    };
  }

  const prisma = new PrismaClient();
  try {
    const dueAt = new Date(Date.now() + 48 * 3600 * 1000 + Math.floor(Math.random() * 60_000));
    const created = await prisma.careReminderOccurrence.create({
      data: {
        hospitalTenantId: schedule.hospitalTenantId,
        patientId,
        scheduleId: schedule.id,
        occurrenceType: schedule.reminderType,
        title: `【smoke v3.1】targeted send-now fixture ${dueAt.toISOString()}`,
        dueAt,
        availableFrom: new Date(dueAt.getTime() - 60 * 60 * 1000),
        availableUntil: new Date(dueAt.getTime() + 4 * 60 * 60 * 1000),
        status: 'PENDING',
      },
    });
    return {
      occurrence: created,
      total: allMine.length + 1,
      pending: 1,
      fixture: 'synthetic-fallback',
    };
  } finally {
    await prisma.$disconnect();
  }
}

"""
    if "async function ensurePendingOccurrence(adminToken, patientId, schedule)" not in src:
        if helper_anchor not in src:
            fail("smoke helper insertion anchor not found")
        src = src.replace(helper_anchor, helper + helper_anchor, 1)
    else:
        print("[skip] smoke PENDING helper — already applied")

    old_step4 = """  // ---------------------------------------------------------------
  // 4. worker generates occurrences
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'POST', '/care-reminders/worker/run-once');
    record(
      '4. worker run-once generates occurrences',
      r.status === 201 && r.body?.generated > 0,
      `generated=${r.body?.generated} dispatched=${r.body?.dispatched} missed=${r.body?.missed}`,
    );
  }
"""
    new_step4 = """  // ---------------------------------------------------------------
  // 4. worker pass completes. On a rerun, generated=0 is valid because
  //    occurrence materialization is intentionally idempotent.
  // ---------------------------------------------------------------
  {
    const r = await call(adminToken, 'POST', '/care-reminders/worker/run-once');
    record(
      '4. worker run-once completes',
      r.status === 201 && Number.isInteger(r.body?.generated) && !r.body?.error,
      `generated=${r.body?.generated} dispatched=${r.body?.dispatched} missed=${r.body?.missed}`,
    );
  }
"""
    src = replace_once(src, old_step4, new_step4, "smoke idempotent first worker pass")

    old_step6 = """  // ---------------------------------------------------------------
  // 6. pick THIS schedule's occurrence closest to now
  // ---------------------------------------------------------------
  let occId = null;
  {
    const r = await call(adminToken, 'GET', `/care-reminders/patients/${PATIENT}/occurrences`);
    const now = Date.now();
    const mine = (r.body || [])
      .filter((o) => o.scheduleId === medSched?.id)
      .sort((a, b) => Math.abs(+new Date(a.dueAt) - now) - Math.abs(+new Date(b.dueAt) - now));
    occId = mine[0]?.id ?? null;
    record('6. occurrence generated for this schedule', Boolean(occId), `count=${mine.length}`);
  }
"""
    new_step6 = """  // ---------------------------------------------------------------
  // 6. select an unconsumed PENDING row for THIS schedule.
  //    Historical COMPLETED rows remain for audit and must never be reused.
  // ---------------------------------------------------------------
  let occId = null;
  {
    const picked = await ensurePendingOccurrence(adminToken, PATIENT, medSched);
    occId = picked.occurrence?.id ?? null;
    record(
      '6. PENDING occurrence selected for targeted send-now',
      Boolean(occId) && picked.occurrence?.status === 'PENDING',
      `pending=${picked.pending} total=${picked.total} fixture=${picked.fixture} dueAt=${picked.occurrence?.dueAt ?? 'none'}`,
    );
  }
"""
    src = replace_once(src, old_step6, new_step6, "smoke select PENDING occurrence")

    # The user's local tree may already contain this anti-enumeration fix.
    src = src.replace(
        """record('17a. nurse2 → demo-patient-001 schedules → 403', r.status === 403, `status=${r.status}`);""",
        """record('17a. nurse2 → demo-patient-001 schedules → 403/404', [403, 404].includes(r.status), `status=${r.status}`);""",
    )
    src = src.replace(
        """record('17b. nurse2 → create cross-tenant schedule → 403', r.status === 403, `status=${r.status}`);""",
        """record('17b. nurse2 → create cross-tenant schedule → 403/404', [403, 404].includes(r.status), `status=${r.status}`);""",
    )

    write_if_changed(SMOKE, original, src)


def main() -> None:
    patch_worker()
    patch_controller()
    patch_smoke()

    if not changed:
        print("\n[done] v3.3.4 was already fully applied.")
        return

    print("\n[done] v3.3.4 applied.")
    print(f"[backup] {BACKUP.relative_to(ROOT)}")
    print("\nNext:")
    print("  cd apps/api")
    print("  node --check scripts/smoke-care-reminders.js")
    print("  npm run build")
    print("  # restart npm run start:dev, then in another terminal:")
    print("  npm run smoke:care-reminders")
    print("  npm run smoke:patient-engagement")


if __name__ == "__main__":
    main()
