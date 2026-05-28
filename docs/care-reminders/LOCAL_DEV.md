# Care Reminders v3 — local dev

## env vars

```
# apps/api/.env
CARE_REMINDER_WORKER_ENABLED=true
CARE_REMINDER_WORKER_INTERVAL_MS=300000   # 5 minutes
CARE_REMINDER_WORKER_HORIZON_DAYS=3
```

`apply_v3_env.py` adds these defaults.

## Run the worker manually

For dev/test you can drive the worker explicitly instead of waiting 5 minutes:

```bash
curl -X POST http://localhost:3000/care-reminders/worker/run-once \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
```

Returns: `{ generated, dispatched, dispatchFailed, missed, escalated }`.

The smoke test uses this endpoint so the test is deterministic regardless of
interval settings.

## Worker status

```bash
curl http://localhost:3000/care-reminders/worker/status \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
```

Shows whether it's running, `inFlight`, last run summary.

## Inspecting occurrences

```bash
# Today (±24h) across the user's tenant
curl http://localhost:3000/care-reminders/today \
  -H "Authorization: Bearer $TOKEN" | jq .

# Recent missed/escalated
curl http://localhost:3000/care-reminders/missed \
  -H "Authorization: Bearer $TOKEN" | jq .

# For a specific patient
curl http://localhost:3000/care-reminders/patients/demo-patient-001/occurrences \
  -H "Authorization: Bearer $TOKEN" | jq .
```

## Testing the senior H5

After seed + worker:

1. Find the form link URL via `/patient-engagement/messages?patientId=demo-patient-001`
   in the API; or look at the demo direct message:
   ```bash
   curl http://localhost:3000/care-reminders/patients/demo-patient-001/messages \
     -H "Authorization: Bearer $TOKEN" | jq '.[0].formLinkId'
   ```
2. Resolve the plaintext token from the matching `PatientFormLink` row in your DB
   (the smoke test does this automatically). Or just open the H5 from the link
   you copied via the nurse UI.
3. The H5 will load `/wx/form/<token>`. For GENERAL_MESSAGE, you'll see a single
   large 我已知晓 button (if `requiresAck=true`).

## Mucking with seed state

The seed plants:
- 4 schedules (med + BP for demo-patient-001, glucose for demo-patient-003, med for demo-patient-101)
- 4 sample occurrences (PENDING / COMPLETED / MISSED ×2)
- 1 PatientDirectMessage (`demo-direct-msg-001`, requiresAck=true)

The PENDING one (`demo-care-occ-pending-001`) has `dueAt = now + 1h`, so it
should fall inside the reminder window for the smoke `send-now` test.

To reset between smoke runs (DB-level):
```sql
DELETE FROM "CareReminderOccurrence";
DELETE FROM "CareReminderSchedule";
DELETE FROM "PatientDirectMessage";
```
Then re-run `node prisma/seed-all.js`.
