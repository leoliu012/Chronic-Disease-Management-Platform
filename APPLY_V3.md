# patient_engagement_care_reminders_v3_patch

Long-term reminder engine on top of v2.1 patient-engagement.

## What this patch ships

| Area | Files |
| ---- | ----- |
| Schema | `apps/api/prisma/migrations/20260530120000_care_reminders_v3/migration.sql` + `scripts/apply_v3_schema.py` (idempotent edit to `schema.prisma`) |
| Backend module | `apps/api/src/care-reminders/` — schedule + occurrence + worker + direct-message services + controller + DTOs + tz-util |
| Backend module wiring | `scripts/apply_v3_app_module.py` (imports `CareRemindersModule` in `app.module.ts`) |
| PatientEngagementModule | full replacement — widens `exports` so v3 reuses v2.1 singletons |
| PublicFormController | full replacement — adds `general-message-ack` endpoint + completion callbacks for v3 occurrences in each existing submit handler |
| Env | `scripts/apply_v3_env.py` — adds `CARE_REMINDER_WORKER_*` vars |
| Seed | `scripts/apply_v3_seed.py` — demo schedules + sample occurrences + one direct message |
| Frontend API client | `apps/web/src/api/care-reminders.ts` |
| Patient detail tab | `apps/web/src/components/CareRemindersPanel.tsx` + `scripts/apply_v3_frontend_routing.py` (wires it into `PatientDetailPage.tsx`) |
| Global page | `apps/web/src/pages/CareRemindersPage.tsx` + routing entry (same patcher) |
| Senior H5 | `scripts/apply_v3_public_form_page.py` — adds `GENERAL_MESSAGE` to `PublicFormPage.tsx` + senior CSS overrides |
| Package.json | `scripts/apply_v3_package_json.py` — adds `smoke:care-reminders` script |
| Smoke | `apps/api/scripts/smoke-care-reminders.js` — 12 assertions covering the 11 spec scenarios |
| Docs | `docs/care-reminders/README.md`, `docs/care-reminders/LOCAL_DEV.md` |

## Apply (from repo root)

```bash
ZIP="$HOME/Downloads/patient_engagement_care_reminders_v3_patch.zip"
TMP="/tmp/patient_engagement_care_reminders_v3_patch"
rm -rf "$TMP" && mkdir -p "$TMP" && unzip -q "$ZIP" -d "$TMP" && rsync -av "$TMP/" ./

# Patchers (all idempotent — safe to re-run)
python3 scripts/apply_v3_schema.py
python3 scripts/apply_v3_app_module.py
python3 scripts/apply_v3_env.py
python3 scripts/apply_v3_seed.py
python3 scripts/apply_v3_frontend_routing.py
python3 scripts/apply_v3_public_form_page.py
python3 scripts/apply_v3_package_json.py

cd apps/api
npx prisma generate
npx prisma migrate dev --name care_reminders_v3
node prisma/seed-all.js

# Restart Nest so module + env are picked up
npm run start:dev
# (new terminal)
cd apps/web && npm run dev

# Smoke (with API running):
cd apps/api && npm run smoke:care-reminders
```

## Expected smoke output

```
PASS login ADMIN
PASS 1. create medication schedule
PASS 2. create vital schedule
PASS 3a. worker runs and generates occurrences
PASS 11. worker rerun is a no-op (no dup occurrences)
PASS 4. send-now dispatches and creates form link
PASS 5. medication H5 submit OK
PASS    occurrence marked COMPLETED in same tx
PASS 6. duplicate submit blocked
PASS 7. missed occurrence detected
PASS 8. missed → ESCALATED + Task created
PASS 9. direct message creates GENERAL_MESSAGE form link
PASS 10a. patient ack succeeds
PASS 10b. PatientDirectMessage marked ACKNOWLEDGED
PASS 12a. nurse2 → demo-patient-001 schedules → 403
PASS 12b. nurse2 → create cross-tenant schedule → 403
PASS 12c. nurse2 → demo-patient-101 (own tenant) → 200
========== care-reminders smoke: 17 PASS / 0 FAIL ==========
```

## Manual UI checks

1. Log in as nurse (`nurse` / `nurse123`).
2. Open `/patients/demo-patient-001`. There's now a **慢病提醒** tab — long-term
   plans, today list, missed list, message composer, history.
3. Click left-nav **慢病提醒中心** to see the tenant-wide overview at `/care-reminders`.
4. Open one of the demo form links in a private window — for the GENERAL_MESSAGE
   demo (`demo-direct-msg-001`) you should see a senior-friendly single-button
   page with 我已知晓.

## Decisions worth knowing

1. **Worker uses `setInterval`, not `@nestjs/schedule`.** Project convention,
   matches `IntermediatePollerService` and `GatewayPromotionWorkerService`.
2. **Single-instance only.** No leader election. Run >1 Nest replicas with
   `CARE_REMINDER_WORKER_ENABLED=true` on at most one of them.
3. **Edits don't rewrite history.** Changing schedule times only affects
   ungenerated future occurrences. PENDING/SENT/MISSED rows are immutable.
4. **`send-now` reuses existing link.** If you click it twice in a row on a
   PENDING occurrence, second call sees SENT and returns `{ reused: true }`.
5. **Submit handlers complete occurrences in the same tx as the business write.**
   Failed downstream write → both rollback together.
6. **Idempotency.** `@@unique([scheduleId, dueAt])` + `createMany({ skipDuplicates: true })`.
   Worker re-runs are no-ops.
7. **Escalation is race-safe.** Worker creates Task first, then atomically
   attaches via `markEscalated`. If the atomic claim loses to another worker,
   the orphan Task is deleted.

## Limitations (not built; documented in README.md)

- Real WeChat dispatch path stays the same as v2.1.
- SMS is still mock-only (carried over).
- No calendar exceptions / one-off shifts.
- No weekly/monthly recurrence math beyond `scheduledDays`.
- Multi-instance worker safety needs PG advisory lock or Bull queue.
