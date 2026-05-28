# patient_engagement_hospital_wechat_v2_1_patch

Follow-up to v2. Fixes 6 issues from code review:

| # | Issue | Fix |
| - | --- | --- |
| 1 | HospitalWechatAccountPage existed but no route/nav | `scripts/apply_pev2_1_app_tsx_routing.py` |
| 2 | OAuth callback redirected to `__after_oauth__` (invalid token) | State now AES-GCM-encrypts plaintext token → redirect to real `/wx/form/{token}` |
| 3 | Real WeChat API was stubbed | `wechat-official-account.service.ts` — access_token cache, send_template with 40001 retry, sns/oauth2 code exchange, error code mapping |
| 4 | `testAccessToken` failed on demo because placeholder ciphertext can't decrypt | Mock-first short-circuit BEFORE decrypt |
| 5 | WeChat send failure → no SMS fallback (only "no openId" fell back) | `patient-engagement.service.ts` — on FAILED + phone exists, create SMS row and dispatch; report `fallbackFrom` |
| 6 | Cross-tenant isolation never actually exercised in smoke | Seed adds `demo-tenant-002` + `nurse-002` + `demo-patient-101`; smoke does 4 cross-tenant checks |

## Apply

From the repo root:

```bash
ZIP="$HOME/Downloads/patient_engagement_hospital_wechat_v2_1_patch.zip"
TMP="/tmp/patient_engagement_hospital_wechat_v2_1_patch"
rm -rf "$TMP" && mkdir -p "$TMP" && unzip -q "$ZIP" -d "$TMP" && rsync -av "$TMP/" ./

python3 scripts/apply_pev2_1_app_tsx_routing.py
python3 scripts/apply_pev2_1_seed_second_tenant.py

cd apps/api
node prisma/seed-all.js      # re-seed to insert nurse-002 + demo-tenant-002 + demo-patient-101
npm run start:dev             # or just restart your running dev server

# new terminal:
cd apps/web && npm run dev    # routing change is picked up by Vite HMR

# smoke:
cd apps/api && npm run smoke:patient-engagement
```

No new Prisma migration is required — v2.1 reuses the v2 schema.

## What's in the zip

```
scripts/
  apply_pev2_1_app_tsx_routing.py             # idempotent
  apply_pev2_1_seed_second_tenant.py          # idempotent
apps/api/src/patient-engagement/
  wechat-official-account.service.ts          # full replacement — real WeChat HTTP
  hospital-wechat-account.service.ts          # full replacement — mock-first testAccessToken
  public-form.controller.ts                   # full replacement — OAuth state w/ plaintext token
  patient-engagement.service.ts               # full replacement — SMS fallback
apps/api/scripts/
  smoke-patient-engagement.js                 # full replacement — global fetch + cross-tenant
APPLY_V2_1.md
README_V2_1.md
```

## Expected smoke output

13 PASS / 1 PASS for nurse2 login (instead of v2's SKIP):

```
PASS login ADMIN
PASS GET demo HospitalWechatOfficialAccount
PASS   enabled + verified
PASS demo-patient-001 contact summary — has openId
PASS create+send questionnaire (AUTO) → WECHAT
PASS GET /public-forms/:token returns hospital block
PASS submit questionnaire
PASS duplicate submit blocked
PASS demo-patient-003 AUTO → SMS fallback
PASS send=false → MANUAL_COPY message exists
PASS MANUAL_COPY message visible in /messages with linkUrl

--- cross-tenant isolation (v2.1) ---
PASS login nurse2 (demo-tenant-002)
PASS nurse2 → demo-patient-001 contact-summary → 403
PASS nurse2 → create link for demo-patient-001 → 403
PASS nurse2 → demo-patient-101 (own tenant) → 200
PASS nurse2 → GET /hospital-wechat/account (own tenant)
PASS nurse2 → POST /hospital-wechat/account → 403 (NURSE write blocked)

========== smoke summary: 17 PASS / 0 FAIL ==========
```

## Manual verification

1. ADMIN logs in, sees **服务号配置** in left nav. Clicking it shows demo-tenant-001's config (masked).
2. From ADMIN, can also `GET /hospital-wechat/account?hospitalTenantId=demo-tenant-002` to inspect the second tenant.
3. nurse2 logs in (username `nurse2`, password `nurse123`) — sees no "服务号配置" item (role-gated to ADMIN only).
4. Open the OAuth flow against a real WeChat sandbox: `/api/patient-engagement/wechat/oauth/start?token=<plain>` → after WeChat redirects back, you land on `/wx/form/<plain>` with the form loaded and the patient's openId now bound to that hospital tenant.
