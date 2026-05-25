#!/usr/bin/env bash
# ---------------------------------------------------------------
# 样例：通过 FHIR R4 接口推送一条 Patient 资源
#
# 用法：
#   API_URL=http://localhost:3000 API_KEY=dev_gateway_key_change_in_prod \
#     bash docs/gateway/samples/curl-fhir-patient.sh
# ---------------------------------------------------------------
set -euo pipefail

: "${API_URL:=http://localhost:3000}"
: "${API_KEY:=dev_gateway_key_change_in_prod}"

curl -sS -X POST "${API_URL}/gateway/fhir/Patient" \
  -H "Content-Type: application/json" \
  -H "X-Gateway-Api-Key: ${API_KEY}" \
  -d '{
    "resourceType": "Patient",
    "id": "fhir-patient-001",
    "meta": { "lastUpdated": "2026-05-22T08:00:00+08:00", "versionId": "1" },
    "identifier": [
      { "system": "urn:oid:1.2.156.10011.1.1.2", "value": "MZ20260520001", "type": { "text": "mrn" } },
      { "system": "urn:oid:1.2.156.10011.1.3.189", "value": "11010119800101****", "type": { "text": "idcard" } }
    ],
    "name": [{ "family": "李", "given": ["海洋"] }],
    "gender": "male",
    "birthDate": "1980-01-01",
    "telecom": [{ "system": "phone", "value": "13800000001" }]
  }' | jq .
