#!/usr/bin/env bash
# ---------------------------------------------------------------
# 样例：通过简化 HIS 业务事件接口推送一条出院事件
#
# 用法：
#   API_URL=http://localhost:3000 API_KEY=dev_gateway_key_change_in_prod \
#     bash docs/gateway/samples/curl-his-discharge.sh
# ---------------------------------------------------------------
set -euo pipefail

: "${API_URL:=http://localhost:3000}"
: "${API_KEY:=dev_gateway_key_change_in_prod}"

curl -sS -X POST "${API_URL}/gateway/his/events/discharge" \
  -H "Content-Type: application/json" \
  -H "X-Gateway-Api-Key: ${API_KEY}" \
  -d '{
    "eventId": "his-discharge-20260522-001",
    "patient": {
      "hospitalPatientId": "MZ20260520001",
      "idCardNo": "11010119800101****",
      "phone": "13800000001"
    },
    "dischargeTime": "2026-05-22T10:00:00+08:00",
    "admissionTime": "2026-05-18T09:00:00+08:00",
    "department": "心内科",
    "diagnosisIcd": "I10",
    "diagnosisText": "原发性高血压（II级 中危）",
    "summary": "血压控制平稳出院，建议门诊随访，继续口服氨氯地平5mg qd"
  }' | jq .
