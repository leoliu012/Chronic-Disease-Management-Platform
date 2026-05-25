#!/usr/bin/env bash
# ---------------------------------------------------------------
# 样例：通过 FHIR R4 接口推送一个事务 Bundle（出院场景）
#   - 一个 Patient
#   - 一个 Encounter (住院)
#   - 一个 Condition (高血压 I10)
#   - 一个 Observation (空腹血糖 H 异常)
#   - 一个 MedicationRequest (氨氯地平)
#
# 用法：
#   API_URL=http://localhost:3000 API_KEY=dev_gateway_key_change_in_prod \
#     bash docs/gateway/samples/curl-fhir-bundle.sh
# ---------------------------------------------------------------
set -euo pipefail

: "${API_URL:=http://localhost:3000}"
: "${API_KEY:=dev_gateway_key_change_in_prod}"

curl -sS -X POST "${API_URL}/gateway/fhir/Bundle" \
  -H "Content-Type: application/json" \
  -H "X-Gateway-Api-Key: ${API_KEY}" \
  -d '{
    "resourceType": "Bundle",
    "id": "discharge-bundle-001",
    "type": "transaction",
    "meta": { "lastUpdated": "2026-05-22T10:30:00+08:00" },
    "entry": [
      {
        "resource": {
          "resourceType": "Patient",
          "id": "p-bundle-001",
          "identifier": [{ "system": "mrn", "value": "MZ20260520001" }],
          "name": [{ "family": "李", "given": ["海洋"] }],
          "gender": "male",
          "birthDate": "1980-01-01"
        }
      },
      {
        "resource": {
          "resourceType": "Encounter",
          "id": "enc-bundle-001",
          "status": "finished",
          "class": { "code": "IMP", "display": "inpatient" },
          "subject": { "reference": "Patient/p-bundle-001" },
          "period": { "start": "2026-05-18T09:00:00+08:00", "end": "2026-05-22T10:00:00+08:00" }
        }
      },
      {
        "resource": {
          "resourceType": "Condition",
          "id": "cond-bundle-001",
          "code": {
            "coding": [{ "system": "http://hl7.org/fhir/sid/icd-10", "code": "I10", "display": "Essential (primary) hypertension" }]
          },
          "subject": { "reference": "Patient/p-bundle-001" },
          "recordedDate": "2026-05-22T09:00:00+08:00"
        }
      },
      {
        "resource": {
          "resourceType": "Observation",
          "id": "obs-bundle-001",
          "status": "final",
          "code": {
            "coding": [{ "system": "http://loinc.org", "code": "1558-6", "display": "Fasting glucose" }]
          },
          "subject": { "reference": "Patient/p-bundle-001" },
          "effectiveDateTime": "2026-05-21T07:30:00+08:00",
          "valueQuantity": { "value": 8.7, "unit": "mmol/L" },
          "interpretation": [{ "coding": [{ "code": "H", "display": "High" }] }]
        }
      },
      {
        "resource": {
          "resourceType": "MedicationRequest",
          "id": "med-bundle-001",
          "status": "active",
          "intent": "order",
          "medicationCodeableConcept": { "text": "氨氯地平片 5mg" },
          "subject": { "reference": "Patient/p-bundle-001" },
          "authoredOn": "2026-05-22T09:30:00+08:00",
          "dosageInstruction": [{ "text": "一次1片, 一日1次" }]
        }
      }
    ]
  }' | jq .
